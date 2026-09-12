import { GComponent } from './GComponent.js';
import { GObject } from './GObject.js';
import { GObjectPool } from './GObjectPool.js';
import { GButton } from './GButton.js';
import { UIPackage } from './UIPackage.js';
import {
    AlignType,
    ChildrenRenderOrder,
    ListLayoutType,
    ListSelectionMode,
    OverflowType,
    VertAlignType,
} from './FieldTypes.js';
import { Point, Rect } from './utils/Geometry.js';
import { EventType } from './event/Event.js';
import { scheduler } from './Scheduler.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { Event } from './event/Event.js';
import type { Controller } from './Controller.js';

/** An item's authored size; `cc.Size` in the reference. */
export interface ItemSize {
    width: number;
    height: number;
}

/** One slot in a virtual list, and the renderer currently occupying it. */
interface ItemInfo {
    width: number;
    height: number;
    obj?: GObject | null;
    updateFlag: number;
    selected?: boolean;
}

/** Scratch shared by the virtual-list position search, as in the reference. */
let s_n = 0;

/**
 * A list of items, laid out by the editor's rules and optionally virtualised.
 *
 * Items are recycled: `addItemFromPool` takes one from a `GObjectPool` keyed by
 * resource URL, `removeChildToPool` puts it back, and a virtual list keeps only
 * the rows in view, moving pooled renderers between slots as it scrolls. That
 * recycling path is the delicate part of this class.
 */
export class GList extends GComponent {
    /** Fills in one item's content. Required before a virtual list has items. */
    public itemRenderer: ((index: number, item: GObject) => void) | null = null;
    /** Supplies the resource URL for an item, so a list can mix item types. */
    public itemProvider: ((index: number) => string) | null = null;

    public scrollItemToViewOnClick = true;
    public foldInvisibleItems = false;

    private _layout: ListLayoutType = ListLayoutType.SingleColumn;
    private _lineCount = 0;
    private _columnCount = 0;
    private _lineGap = 0;
    private _columnGap = 0;
    private _defaultItem: string | null = null;
    private _autoResizeItem = true;
    private _selectionMode: ListSelectionMode = ListSelectionMode.Single;
    private _align: AlignType = AlignType.Left;
    private _verticalAlign: VertAlignType = VertAlignType.Top;
    private _selectionController: Controller | null = null;

    private _lastSelectedIndex = -1;
    private _pool = new GObjectPool();

    // ---- virtual list state -------------------------------------------------

    private _virtual = false;
    private _loop = false;
    private _numItems = 0;
    private _realNumItems = 0;
    /** Index, in `_virtualItems`, of the top-left item on screen. */
    private _firstIndex = 0;
    /** Items per line. */
    private _curLineItemCount = 0;
    /** Items per column; only Pagination uses both counts at once. */
    private _curLineItemCount2 = 0;
    private _itemSize: ItemSize | null = null;
    /** 0: clean, 1: content changed, 2: layout changed. */
    private _virtualListChanged = 0;
    private _virtualItems: ItemInfo[] = [];
    private _eventLocked = false;
    /** Marks which slots the current pass has already claimed. */
    private _itemInfoVer = 0;

    /**
     * A scheduler key of its own.
     *
     * The reference scheduled the virtual refresh on the same `GObjectPartner`
     * queue the component uses for its bounds refresh, keyed per callback;
     * `GObject.callLater` keys its single pending task on the object instead, so
     * the two would overwrite each other. This token keeps them apart.
     */
    private readonly _refreshOwner: object = {};

    /** Bound wrapper, because a bare method reference would lose `this`. */
    private readonly _refreshVirtualListBound = (): void => {
        this._refreshVirtualList();
    };

    public constructor() {
        super();

        this._trackBounds = true;
        this.opaque = true;
    }

    public dispose(): void {
        scheduler.cancel(this._refreshOwner);
        this._pool.clear();
        super.dispose();
    }

    // ---- layout --------------------------------------------------------------

    public get layout(): ListLayoutType {
        return this._layout;
    }

    public set layout(value: ListLayoutType) {
        if (this._layout !== value) {
            this._layout = value;
            this.setBoundsChangedFlag();
            if (this._virtual)
                this.setVirtualListChangedFlag(true);
        }
    }

    public get lineCount(): number {
        return this._lineCount;
    }

    public set lineCount(value: number) {
        if (this._lineCount !== value) {
            this._lineCount = value;
            this.setBoundsChangedFlag();
            if (this._virtual)
                this.setVirtualListChangedFlag(true);
        }
    }

    public get columnCount(): number {
        return this._columnCount;
    }

    public set columnCount(value: number) {
        if (this._columnCount !== value) {
            this._columnCount = value;
            this.setBoundsChangedFlag();
            if (this._virtual)
                this.setVirtualListChangedFlag(true);
        }
    }

    public get lineGap(): number {
        return this._lineGap;
    }

    public set lineGap(value: number) {
        if (this._lineGap !== value) {
            this._lineGap = value;
            this.setBoundsChangedFlag();
            if (this._virtual)
                this.setVirtualListChangedFlag(true);
        }
    }

    public get columnGap(): number {
        return this._columnGap;
    }

    public set columnGap(value: number) {
        if (this._columnGap !== value) {
            this._columnGap = value;
            this.setBoundsChangedFlag();
            if (this._virtual)
                this.setVirtualListChangedFlag(true);
        }
    }

    public get align(): AlignType {
        return this._align;
    }

    public set align(value: AlignType) {
        if (this._align !== value) {
            this._align = value;
            this.setBoundsChangedFlag();
            if (this._virtual)
                this.setVirtualListChangedFlag(true);
        }
    }

    public get verticalAlign(): VertAlignType {
        return this._verticalAlign;
    }

    public set verticalAlign(value: VertAlignType) {
        if (this._verticalAlign !== value) {
            this._verticalAlign = value;
            this.setBoundsChangedFlag();
            if (this._virtual)
                this.setVirtualListChangedFlag(true);
        }
    }

    /** The size every item is laid out at, in a virtual list. */
    public get virtualItemSize(): ItemSize | null {
        return this._itemSize;
    }

    public set virtualItemSize(value: ItemSize) {
        if (this._virtual) {
            if (this._itemSize == null)
                this._itemSize = { width: 0, height: 0 };
            this._itemSize.width = value.width;
            this._itemSize.height = value.height;
            this.setVirtualListChangedFlag(true);
        }
    }

    public get defaultItem(): string | null {
        return this._defaultItem;
    }

    public set defaultItem(val: string | null) {
        this._defaultItem = UIPackage.normalizeURL(val as string);
    }

    public get autoResizeItem(): boolean {
        return this._autoResizeItem;
    }

    public set autoResizeItem(value: boolean) {
        if (this._autoResizeItem !== value) {
            this._autoResizeItem = value;
            this.setBoundsChangedFlag();
            if (this._virtual)
                this.setVirtualListChangedFlag(true);
        }
    }

    public get selectionMode(): ListSelectionMode {
        return this._selectionMode;
    }

    public set selectionMode(value: ListSelectionMode) {
        this._selectionMode = value;
    }

    public get selectionController(): Controller | null {
        return this._selectionController;
    }

    public set selectionController(value: Controller | null) {
        this._selectionController = value;
    }

    public get itemPool(): GObjectPool {
        return this._pool;
    }

    // ---- item pooling --------------------------------------------------------

    public getFromPool(url?: string | null): GObject | null {
        if (!url)
            url = this._defaultItem;

        const obj = this._pool.getObject(url);
        if (obj)
            obj.visible = true;
        return obj;
    }

    public returnToPool(obj: GObject): void {
        this._pool.returnObject(obj);
    }

    public addChildAt(child: GObject, index: number): GObject {
        super.addChildAt(child, index);

        if (child instanceof GButton) {
            child.selected = false;
            child.changeStateOnClick = false;
        }
        child.on(EventType.CLICK, this.onClickItem, this);

        return child;
    }

    public addItem(url?: string | null): GObject {
        if (!url)
            url = this._defaultItem;
        // `createObjectFromURL` answers null for an unknown URL, which
        // `addChild` rejects — the reference failed the same way.
        return this.addChild(UIPackage.createObjectFromURL(url!)!);
    }

    public addItemFromPool(url?: string | null): GObject {
        return this.addChild(this.getFromPool(url)!);
    }

    public removeChildAt(index: number, dispose = false): GObject {
        const child = super.removeChildAt(index, dispose);
        if (!dispose)
            child.off(EventType.CLICK, this.onClickItem, this);

        return child;
    }

    public removeChildToPoolAt(index: number): void {
        const child = super.removeChildAt(index);
        this.returnToPool(child);
    }

    public removeChildToPool(child: GObject): void {
        super.removeChild(child);
        this.returnToPool(child);
    }

    public removeChildrenToPool(beginIndex = 0, endIndex = -1): void {
        if (endIndex < 0 || endIndex >= this._children.length)
            endIndex = this._children.length - 1;

        for (let i = beginIndex; i <= endIndex; ++i)
            this.removeChildToPoolAt(beginIndex);
    }

    // ---- selection -----------------------------------------------------------

    public get selectedIndex(): number {
        let i: number;
        if (this._virtual) {
            for (i = 0; i < this._realNumItems; i++) {
                const ii = this._virtualItems[i];
                if ((ii.obj instanceof GButton && ii.obj.selected) || (!ii.obj && ii.selected)) {
                    if (this._loop)
                        return i % this._numItems;
                    return i;
                }
            }
        } else {
            const cnt = this._children.length;
            for (i = 0; i < cnt; i++) {
                const obj = this._children[i];
                if (obj instanceof GButton && obj.selected)
                    return i;
            }
        }

        return -1;
    }

    public set selectedIndex(value: number) {
        if (value >= 0 && value < this.numItems) {
            if (this._selectionMode !== ListSelectionMode.Single)
                this.clearSelection();
            this.addSelection(value);
        } else
            this.clearSelection();
    }

    public getSelection(result?: number[]): number[] {
        if (!result)
            result = [];
        let i: number;
        if (this._virtual) {
            for (i = 0; i < this._realNumItems; i++) {
                const ii = this._virtualItems[i];
                if ((ii.obj instanceof GButton && ii.obj.selected) || (!ii.obj && ii.selected)) {
                    let j = i;
                    if (this._loop) {
                        j = i % this._numItems;
                        if (result.indexOf(j) !== -1)
                            continue;
                    }
                    result.push(j);
                }
            }
        } else {
            const cnt = this._children.length;
            for (i = 0; i < cnt; i++) {
                const obj = this._children[i];
                if (obj instanceof GButton && obj.selected)
                    result.push(i);
            }
        }
        return result;
    }

    public addSelection(index: number, scrollItToView?: boolean): void {
        if (this._selectionMode === ListSelectionMode.None)
            return;

        this.checkVirtualList();

        if (this._selectionMode === ListSelectionMode.Single)
            this.clearSelection();

        if (scrollItToView)
            this.scrollToView(index);

        this._lastSelectedIndex = index;
        let obj: GObject | null = null;
        if (this._virtual) {
            const ii = this._virtualItems[index];
            if (ii.obj)
                obj = ii.obj;
            ii.selected = true;
        } else
            obj = this.getChildAt(index);

        if (obj instanceof GButton && !obj.selected) {
            obj.selected = true;
            this.updateSelectionController(index);
        }
    }

    public removeSelection(index: number): void {
        if (this._selectionMode === ListSelectionMode.None)
            return;

        let obj: GObject | null = null;
        if (this._virtual) {
            const ii = this._virtualItems[index];
            if (ii.obj)
                obj = ii.obj;
            ii.selected = false;
        } else
            obj = this.getChildAt(index);

        if (obj instanceof GButton)
            obj.selected = false;
    }

    public clearSelection(): void {
        let i: number;
        if (this._virtual) {
            for (i = 0; i < this._realNumItems; i++) {
                const ii = this._virtualItems[i];
                if (ii.obj instanceof GButton)
                    ii.obj.selected = false;
                ii.selected = false;
            }
        } else {
            const cnt = this._children.length;
            for (i = 0; i < cnt; i++) {
                const obj = this._children[i];
                if (obj instanceof GButton)
                    obj.selected = false;
            }
        }
    }

    private clearSelectionExcept(g: GObject): void {
        let i: number;
        if (this._virtual) {
            for (i = 0; i < this._realNumItems; i++) {
                const ii = this._virtualItems[i];
                if (ii.obj !== g) {
                    if (ii.obj instanceof GButton)
                        ii.obj.selected = false;
                    ii.selected = false;
                }
            }
        } else {
            const cnt = this._children.length;
            for (i = 0; i < cnt; i++) {
                const obj = this._children[i];
                if (obj instanceof GButton && obj !== g)
                    obj.selected = false;
            }
        }
    }

    public selectAll(): void {
        this.checkVirtualList();

        let last = -1;
        let i: number;
        if (this._virtual) {
            for (i = 0; i < this._realNumItems; i++) {
                const ii = this._virtualItems[i];
                if (ii.obj instanceof GButton && !ii.obj.selected) {
                    ii.obj.selected = true;
                    last = i;
                }
                ii.selected = true;
            }
        } else {
            const cnt = this._children.length;
            for (i = 0; i < cnt; i++) {
                const obj = this._children[i];
                if (obj instanceof GButton && !obj.selected) {
                    obj.selected = true;
                    last = i;
                }
            }
        }

        if (last !== -1)
            this.updateSelectionController(last);
    }

    public selectNone(): void {
        this.clearSelection();
    }

    public selectReverse(): void {
        this.checkVirtualList();

        let last = -1;
        let i: number;
        if (this._virtual) {
            for (i = 0; i < this._realNumItems; i++) {
                const ii = this._virtualItems[i];
                if (ii.obj instanceof GButton) {
                    ii.obj.selected = !ii.obj.selected;
                    if (ii.obj.selected)
                        last = i;
                }
                ii.selected = !ii.selected;
            }
        } else {
            const cnt = this._children.length;
            for (i = 0; i < cnt; i++) {
                const obj = this._children[i];
                if (obj instanceof GButton) {
                    obj.selected = !obj.selected;
                    if (obj.selected)
                        last = i;
                }
            }
        }

        if (last !== -1)
            this.updateSelectionController(last);
    }

    /** Moves the selection one step in `dir`: 1 up, 3 right, 5 down, 7 left. */
    public handleArrowKey(dir: number): void {
        let index = this.selectedIndex;
        if (index === -1)
            return;

        let current: GObject;
        let obj: GObject;
        let k = 0;
        let i = 0;
        let cnt = 0;

        switch (dir) {
            case 1: // up
                if (this._layout === ListLayoutType.SingleColumn || this._layout === ListLayoutType.FlowVertical) {
                    index--;
                    if (index >= 0) {
                        this.clearSelection();
                        this.addSelection(index, true);
                    }
                } else if (this._layout === ListLayoutType.FlowHorizontal || this._layout === ListLayoutType.Pagination) {
                    current = this._children[index];
                    k = 0;
                    for (i = index - 1; i >= 0; i--) {
                        obj = this._children[i];
                        if (obj.y !== current.y) {
                            current = obj;
                            break;
                        }
                        k++;
                    }
                    for (; i >= 0; i--) {
                        obj = this._children[i];
                        if (obj.y !== current.y) {
                            this.clearSelection();
                            this.addSelection(i + k + 1, true);
                            break;
                        }
                    }
                }
                break;

            case 3: // right
                if (this._layout === ListLayoutType.SingleRow || this._layout === ListLayoutType.FlowHorizontal
                    || this._layout === ListLayoutType.Pagination) {
                    index++;
                    if (index < this._children.length) {
                        this.clearSelection();
                        this.addSelection(index, true);
                    }
                } else if (this._layout === ListLayoutType.FlowVertical) {
                    current = this._children[index];
                    k = 0;
                    cnt = this._children.length;
                    for (i = index + 1; i < cnt; i++) {
                        obj = this._children[i];
                        if (obj.x !== current.x) {
                            current = obj;
                            break;
                        }
                        k++;
                    }
                    for (; i < cnt; i++) {
                        obj = this._children[i];
                        if (obj.x !== current.x) {
                            this.clearSelection();
                            this.addSelection(i - k - 1, true);
                            break;
                        }
                    }
                }
                break;

            case 5: // down
                if (this._layout === ListLayoutType.SingleColumn || this._layout === ListLayoutType.FlowVertical) {
                    index++;
                    if (index < this._children.length) {
                        this.clearSelection();
                        this.addSelection(index, true);
                    }
                } else if (this._layout === ListLayoutType.FlowHorizontal || this._layout === ListLayoutType.Pagination) {
                    current = this._children[index];
                    k = 0;
                    cnt = this._children.length;
                    for (i = index + 1; i < cnt; i++) {
                        obj = this._children[i];
                        if (obj.y !== current.y) {
                            current = obj;
                            break;
                        }
                        k++;
                    }
                    for (; i < cnt; i++) {
                        obj = this._children[i];
                        if (obj.y !== current.y) {
                            this.clearSelection();
                            this.addSelection(i - k - 1, true);
                            break;
                        }
                    }
                }
                break;

            case 7: // left
                if (this._layout === ListLayoutType.SingleRow || this._layout === ListLayoutType.FlowHorizontal
                    || this._layout === ListLayoutType.Pagination) {
                    index--;
                    if (index >= 0) {
                        this.clearSelection();
                        this.addSelection(index, true);
                    }
                } else if (this._layout === ListLayoutType.FlowVertical) {
                    current = this._children[index];
                    k = 0;
                    for (i = index - 1; i >= 0; i--) {
                        obj = this._children[i];
                        if (obj.x !== current.x) {
                            current = obj;
                            break;
                        }
                        k++;
                    }
                    for (; i >= 0; i--) {
                        obj = this._children[i];
                        if (obj.x !== current.x) {
                            this.clearSelection();
                            this.addSelection(i + k + 1, true);
                            break;
                        }
                    }
                }
                break;
        }
    }

    private onClickItem(evt: Event): void {
        if (this._scrollPane && this._scrollPane.isDragged)
            return;

        // `dispatchEvent` puts the listening `GObject` on `currentTarget`; the
        // reference read the node and recovered the object from it.
        const item = evt.currentTarget as GObject;
        this.setSelectionOnEvent(item, evt);

        if (this._scrollPane && this.scrollItemToViewOnClick)
            this._scrollPane.scrollToView(item, true);

        this.dispatchItemEvent(item, evt);
    }

    protected dispatchItemEvent(item: GObject, evt: Event): void {
        this.emit(EventType.CLICK_ITEM, item, evt);
    }

    private setSelectionOnEvent(item: GObject, evt: Event): void {
        if (!(item instanceof GButton) || this._selectionMode === ListSelectionMode.None)
            return;

        let dontChangeLastIndex = false;
        const index = this.childIndexToItemIndex(this.getChildIndex(item));

        if (this._selectionMode === ListSelectionMode.Single) {
            if (!item.selected) {
                this.clearSelectionExcept(item);
                item.selected = true;
            }
        } else {
            if (evt.isShiftDown) {
                if (!item.selected) {
                    if (this._lastSelectedIndex !== -1) {
                        let min = Math.min(this._lastSelectedIndex, index);
                        let max = Math.max(this._lastSelectedIndex, index);
                        max = Math.min(max, this.numItems - 1);
                        let i: number;
                        if (this._virtual) {
                            for (i = min; i <= max; i++) {
                                const ii = this._virtualItems[i];
                                if (ii.obj instanceof GButton)
                                    ii.obj.selected = true;
                                ii.selected = true;
                            }
                        } else {
                            for (i = min; i <= max; i++) {
                                const obj = this.getChildAt(i);
                                if (obj instanceof GButton)
                                    obj.selected = true;
                            }
                        }

                        dontChangeLastIndex = true;
                    } else {
                        item.selected = true;
                    }
                }
            } else if (evt.isCtrlDown || this._selectionMode === ListSelectionMode.Multiple_SingleClick) {
                item.selected = !item.selected;
            } else {
                if (!item.selected) {
                    this.clearSelectionExcept(item);
                    item.selected = true;
                } else
                    this.clearSelectionExcept(item);
            }
        }

        if (!dontChangeLastIndex)
            this._lastSelectedIndex = index;

        if (item.selected)
            this.updateSelectionController(index);
    }

    // ---- sizing --------------------------------------------------------------

    public resizeToFit(itemCount: number = Number.POSITIVE_INFINITY, minSize = 0): void {
        this.ensureBoundsCorrect();

        const curCount = this.numItems;
        if (itemCount > curCount)
            itemCount = curCount;

        if (this._virtual) {
            const lineCount = Math.ceil(itemCount / this._curLineItemCount);
            if (this._layout === ListLayoutType.SingleColumn || this._layout === ListLayoutType.FlowHorizontal)
                this.viewHeight = lineCount * this._itemSize!.height + Math.max(0, lineCount - 1) * this._lineGap;
            else
                this.viewWidth = lineCount * this._itemSize!.width + Math.max(0, lineCount - 1) * this._columnGap;
        } else if (itemCount === 0) {
            if (this._layout === ListLayoutType.SingleColumn || this._layout === ListLayoutType.FlowHorizontal)
                this.viewHeight = minSize;
            else
                this.viewWidth = minSize;
        } else {
            let i = itemCount - 1;
            let obj: GObject | null = null;
            while (i >= 0) {
                obj = this.getChildAt(i);
                if (!this.foldInvisibleItems || obj.visible)
                    break;
                i--;
            }
            if (i < 0) {
                if (this._layout === ListLayoutType.SingleColumn || this._layout === ListLayoutType.FlowHorizontal)
                    this.viewHeight = minSize;
                else
                    this.viewWidth = minSize;
            } else {
                let size = 0;
                if (this._layout === ListLayoutType.SingleColumn || this._layout === ListLayoutType.FlowHorizontal) {
                    size = obj!.y + obj!.height;
                    if (size < minSize)
                        size = minSize;
                    this.viewHeight = size;
                } else {
                    size = obj!.x + obj!.width;
                    if (size < minSize)
                        size = minSize;
                    this.viewWidth = size;
                }
            }
        }
    }

    public getMaxItemWidth(): number {
        const cnt = this._children.length;
        let max = 0;
        for (let i = 0; i < cnt; i++) {
            const child = this.getChildAt(i);
            if (child.width > max)
                max = child.width;
        }
        return max;
    }

    protected handleSizeChanged(): void {
        super.handleSizeChanged();

        this.setBoundsChangedFlag();
        if (this._virtual)
            this.setVirtualListChangedFlag(true);
    }

    public handleControllerChanged(c: Controller): void {
        super.handleControllerChanged(c);

        if (this._selectionController === c)
            this.selectedIndex = c.selectedIndex;
    }

    private updateSelectionController(index: number): void {
        if (this._selectionController && !this._selectionController.changing
            && index < this._selectionController.pageCount) {
            const c = this._selectionController;
            this._selectionController = null;
            c.selectedIndex = index;
            this._selectionController = c;
        }
    }

    /** Snaps a scroll offset to the nearest item boundary. */
    public getSnappingPosition(xValue: number, yValue: number, resultPoint?: Point): Point {
        if (this._virtual) {
            const result = resultPoint ?? new Point();
            let saved: number;
            let index: number;
            if (this._layout === ListLayoutType.SingleColumn || this._layout === ListLayoutType.FlowHorizontal) {
                saved = yValue;
                s_n = yValue;
                index = this.getIndexOnPos1(false);
                yValue = s_n;
                if (index < this._virtualItems.length && saved - yValue > this._virtualItems[index].height / 2
                    && index < this._realNumItems)
                    yValue += this._virtualItems[index].height + this._lineGap;
            } else if (this._layout === ListLayoutType.SingleRow || this._layout === ListLayoutType.FlowVertical) {
                saved = xValue;
                s_n = xValue;
                index = this.getIndexOnPos2(false);
                xValue = s_n;
                if (index < this._virtualItems.length && saved - xValue > this._virtualItems[index].width / 2
                    && index < this._realNumItems)
                    xValue += this._virtualItems[index].width + this._columnGap;
            } else {
                saved = xValue;
                s_n = xValue;
                index = this.getIndexOnPos3(false);
                xValue = s_n;
                if (index < this._virtualItems.length && saved - xValue > this._virtualItems[index].width / 2
                    && index < this._realNumItems)
                    xValue += this._virtualItems[index].width + this._columnGap;
            }

            result.x = xValue;
            result.y = yValue;
            return result;
        }

        return super.getSnappingPosition(xValue, yValue, resultPoint);
    }

    public scrollToView(index: number, ani?: boolean, setFirst?: boolean): void {
        if (this._virtual) {
            if (this._numItems === 0)
                return;

            this.checkVirtualList();

            if (index >= this._virtualItems.length)
                throw new RangeError('Invalid child index: ' + index + '>' + this._virtualItems.length);

            if (this._loop)
                index = Math.floor(this._firstIndex / this._numItems) * this._numItems + index;

            let rect: Rect;
            const ii = this._virtualItems[index];
            let pos = 0;
            let i: number;
            if (this._layout === ListLayoutType.SingleColumn || this._layout === ListLayoutType.FlowHorizontal) {
                for (i = this._curLineItemCount - 1; i < index; i += this._curLineItemCount)
                    pos += this._virtualItems[i].height + this._lineGap;
                rect = new Rect(0, pos, this._itemSize!.width, ii.height);
            } else if (this._layout === ListLayoutType.SingleRow || this._layout === ListLayoutType.FlowVertical) {
                for (i = this._curLineItemCount - 1; i < index; i += this._curLineItemCount)
                    pos += this._virtualItems[i].width + this._columnGap;
                rect = new Rect(pos, 0, ii.width, this._itemSize!.height);
            } else {
                const page = index / (this._curLineItemCount * this._curLineItemCount2);
                rect = new Rect(
                    page * this.viewWidth + (index % this._curLineItemCount) * (ii.width + this._columnGap),
                    (index / this._curLineItemCount) % this._curLineItemCount2 * (ii.height + this._lineGap),
                    ii.width, ii.height,
                );
            }

            if (this._scrollPane)
                this._scrollPane.scrollToView(rect, ani, setFirst);
        } else {
            // `GComponent.getChildAt` throws on an out-of-range index here,
            // where the reference's returned null and fell through; the bounds
            // test keeps a stray scroll request from throwing.
            const obj = index >= 0 && index < this._children.length ? this.getChildAt(index) : null;
            if (obj) {
                if (this._scrollPane)
                    this._scrollPane.scrollToView(obj, ani, setFirst);
                else if (this.parent && this.parent.scrollPane)
                    this.parent.scrollPane.scrollToView(obj, ani, setFirst);
            }
        }
    }

    public getFirstChildInView(): number {
        return this.childIndexToItemIndex(super.getFirstChildInView());
    }

    public childIndexToItemIndex(index: number): number {
        if (!this._virtual)
            return index;

        if (this._layout === ListLayoutType.Pagination) {
            for (let i = this._firstIndex; i < this._realNumItems; i++) {
                if (this._virtualItems[i].obj) {
                    index--;
                    if (index < 0)
                        return i;
                }
            }

            return index;
        }

        index += this._firstIndex;
        if (this._loop && this._numItems > 0)
            index = index % this._numItems;

        return index;
    }

    public itemIndexToChildIndex(index: number): number {
        if (!this._virtual)
            return index;

        if (this._layout === ListLayoutType.Pagination)
            return this.getChildIndex(this._virtualItems[index].obj!);

        if (this._loop && this._numItems > 0) {
            const j = this._firstIndex % this._numItems;
            if (index >= j)
                index = index - j;
            else
                index = this._numItems - j + index;
        } else
            index -= this._firstIndex;

        return index;
    }

    // ---- virtual list --------------------------------------------------------

    public setVirtual(): void {
        this._setVirtual(false);
    }

    /** Turns the list virtual, and makes it wrap around endlessly. */
    public setVirtualAndLoop(): void {
        this._setVirtual(true);
    }

    private _setVirtual(loop: boolean): void {
        if (this._virtual)
            return;

        if (!this._scrollPane)
            throw new Error('Virtual list must be scrollable!');

        if (loop) {
            if (this._layout === ListLayoutType.FlowHorizontal || this._layout === ListLayoutType.FlowVertical)
                throw new Error('Loop list is not supported for FlowHorizontal or FlowVertical layout!');

            this._scrollPane.bouncebackEffect = false;
        }

        this._virtual = true;
        this._loop = loop;
        this._virtualItems = [];
        this.removeChildrenToPool();

        if (this._itemSize == null) {
            this._itemSize = { width: 0, height: 0 };
            const obj = this.getFromPool(null);
            if (!obj)
                throw new Error('Virtual List must have a default list item resource.');

            this._itemSize.width = obj.width;
            this._itemSize.height = obj.height;
            this.returnToPool(obj);
        }

        if (this._layout === ListLayoutType.SingleColumn || this._layout === ListLayoutType.FlowHorizontal) {
            this._scrollPane.scrollStep = this._itemSize.height;
            if (this._loop)
                this._scrollPane._loop = 2;
        } else {
            this._scrollPane.scrollStep = this._itemSize.width;
            if (this._loop)
                this._scrollPane._loop = 1;
        }

        this.on(EventType.SCROLL, this.__scrolled, this);
        this.setVirtualListChangedFlag(true);
    }

    /**
     * The number of items.
     *
     * For a real list this builds or removes renderers; for a virtual one it
     * only records the count and lets the refresh create the visible ones.
     */
    public get numItems(): number {
        if (this._virtual)
            return this._numItems;
        return this._children.length;
    }

    public set numItems(value: number) {
        if (this._virtual) {
            if (this.itemRenderer == null)
                throw new Error('Set itemRenderer first!');

            this._numItems = value;
            if (this._loop)
                this._realNumItems = this._numItems * 6; // six copies make the loop seamless
            else
                this._realNumItems = this._numItems;

            // `_virtualItems` only ever grows; slots past the end are handed
            // back instead of being discarded.
            const oldCount = this._virtualItems.length;
            if (this._realNumItems > oldCount) {
                for (let i = oldCount; i < this._realNumItems; i++) {
                    const ii: ItemInfo = {
                        width: this._itemSize!.width,
                        height: this._itemSize!.height,
                        updateFlag: 0,
                    };

                    this._virtualItems.push(ii);
                }
            } else {
                for (let i = this._realNumItems; i < oldCount; i++)
                    this._virtualItems[i].selected = false;
            }

            if (this._virtualListChanged !== 0)
                scheduler.cancel(this._refreshOwner);

            this._refreshVirtualList();
        } else {
            const cnt = this._children.length;
            let i: number;
            if (value > cnt) {
                for (i = cnt; i < value; i++) {
                    if (this.itemProvider == null)
                        this.addItemFromPool();
                    else
                        this.addItemFromPool(this.itemProvider(i));
                }
            } else {
                this.removeChildrenToPool(value, cnt);
            }
            if (this.itemRenderer != null) {
                for (i = 0; i < value; i++)
                    this.itemRenderer(i, this.getChildAt(i));
            }
        }
    }

    /** Marks the virtual list dirty, to be rebuilt on the next tick. */
    public refreshVirtualList(): void {
        this.setVirtualListChangedFlag(false);
    }

    private checkVirtualList(): void {
        if (this._virtualListChanged !== 0) {
            this._refreshVirtualList();
            scheduler.cancel(this._refreshOwner);
        }
    }

    private setVirtualListChangedFlag(layoutChanged: boolean): void {
        if (layoutChanged)
            this._virtualListChanged = 2;
        else if (this._virtualListChanged === 0)
            this._virtualListChanged = 1;

        scheduler.callLater(this._refreshOwner, this._refreshVirtualListBound);
    }

    private _refreshVirtualList(): void {
        const layoutChanged = this._virtualListChanged === 2;
        this._virtualListChanged = 0;
        this._eventLocked = true;

        if (layoutChanged) {
            if (this._layout === ListLayoutType.SingleColumn || this._layout === ListLayoutType.SingleRow)
                this._curLineItemCount = 1;
            else if (this._layout === ListLayoutType.FlowHorizontal) {
                if (this._columnCount > 0)
                    this._curLineItemCount = this._columnCount;
                else {
                    this._curLineItemCount = Math.floor(
                        (this._scrollPane!.viewWidth + this._columnGap) / (this._itemSize!.width + this._columnGap));
                    if (this._curLineItemCount <= 0)
                        this._curLineItemCount = 1;
                }
            } else if (this._layout === ListLayoutType.FlowVertical) {
                if (this._lineCount > 0)
                    this._curLineItemCount = this._lineCount;
                else {
                    this._curLineItemCount = Math.floor(
                        (this._scrollPane!.viewHeight + this._lineGap) / (this._itemSize!.height + this._lineGap));
                    if (this._curLineItemCount <= 0)
                        this._curLineItemCount = 1;
                }
            } else { // pagination
                if (this._columnCount > 0)
                    this._curLineItemCount = this._columnCount;
                else {
                    this._curLineItemCount = Math.floor(
                        (this._scrollPane!.viewWidth + this._columnGap) / (this._itemSize!.width + this._columnGap));
                    if (this._curLineItemCount <= 0)
                        this._curLineItemCount = 1;
                }

                if (this._lineCount > 0)
                    this._curLineItemCount2 = this._lineCount;
                else {
                    this._curLineItemCount2 = Math.floor(
                        (this._scrollPane!.viewHeight + this._lineGap) / (this._itemSize!.height + this._lineGap));
                    if (this._curLineItemCount2 <= 0)
                        this._curLineItemCount2 = 1;
                }
            }
        }

        let ch = 0;
        let cw = 0;
        if (this._realNumItems > 0) {
            let i: number;
            const len = Math.ceil(this._realNumItems / this._curLineItemCount) * this._curLineItemCount;
            const len2 = Math.min(this._curLineItemCount, this._realNumItems);
            if (this._layout === ListLayoutType.SingleColumn || this._layout === ListLayoutType.FlowHorizontal) {
                for (i = 0; i < len; i += this._curLineItemCount)
                    ch += this._virtualItems[i].height + this._lineGap;
                if (ch > 0)
                    ch -= this._lineGap;

                if (this._autoResizeItem)
                    cw = this._scrollPane!.viewWidth;
                else {
                    for (i = 0; i < len2; i++)
                        cw += this._virtualItems[i].width + this._columnGap;
                    if (cw > 0)
                        cw -= this._columnGap;
                }
            } else if (this._layout === ListLayoutType.SingleRow || this._layout === ListLayoutType.FlowVertical) {
                for (i = 0; i < len; i += this._curLineItemCount)
                    cw += this._virtualItems[i].width + this._columnGap;
                if (cw > 0)
                    cw -= this._columnGap;

                if (this._autoResizeItem)
                    ch = this._scrollPane!.viewHeight;
                else {
                    for (i = 0; i < len2; i++)
                        ch += this._virtualItems[i].height + this._lineGap;
                    if (ch > 0)
                        ch -= this._lineGap;
                }
            } else {
                const pageCount = Math.ceil(len / (this._curLineItemCount * this._curLineItemCount2));
                cw = pageCount * this.viewWidth;
                ch = this.viewHeight;
            }
        }

        this.handleAlign(cw, ch);
        this._scrollPane!.setContentSize(cw, ch);

        this._eventLocked = false;

        this.handleScroll(true);
    }

    private __scrolled(): void {
        this.handleScroll(false);
    }

    private getIndexOnPos1(forceUpdate: boolean): number {
        if (this._realNumItems < this._curLineItemCount) {
            s_n = 0;
            return 0;
        }

        let i: number;
        let pos2: number;
        let pos3: number;

        if (this.numChildren > 0 && !forceUpdate) {
            pos2 = this.getChildAt(0).y;
            if (pos2 > s_n) {
                for (i = this._firstIndex - this._curLineItemCount; i >= 0; i -= this._curLineItemCount) {
                    pos2 -= (this._virtualItems[i].height + this._lineGap);
                    if (pos2 <= s_n) {
                        s_n = pos2;
                        return i;
                    }
                }

                s_n = 0;
                return 0;
            } else {
                for (i = this._firstIndex; i < this._realNumItems; i += this._curLineItemCount) {
                    pos3 = pos2 + this._virtualItems[i].height + this._lineGap;
                    if (pos3 > s_n) {
                        s_n = pos2;
                        return i;
                    }
                    pos2 = pos3;
                }

                s_n = pos2;
                return this._realNumItems - this._curLineItemCount;
            }
        } else {
            pos2 = 0;
            for (i = 0; i < this._realNumItems; i += this._curLineItemCount) {
                pos3 = pos2 + this._virtualItems[i].height + this._lineGap;
                if (pos3 > s_n) {
                    s_n = pos2;
                    return i;
                }
                pos2 = pos3;
            }

            s_n = pos2;
            return this._realNumItems - this._curLineItemCount;
        }
    }

    private getIndexOnPos2(forceUpdate: boolean): number {
        if (this._realNumItems < this._curLineItemCount) {
            s_n = 0;
            return 0;
        }

        let i: number;
        let pos2: number;
        let pos3: number;

        if (this.numChildren > 0 && !forceUpdate) {
            pos2 = this.getChildAt(0).x;
            if (pos2 > s_n) {
                for (i = this._firstIndex - this._curLineItemCount; i >= 0; i -= this._curLineItemCount) {
                    pos2 -= (this._virtualItems[i].width + this._columnGap);
                    if (pos2 <= s_n) {
                        s_n = pos2;
                        return i;
                    }
                }

                s_n = 0;
                return 0;
            } else {
                for (i = this._firstIndex; i < this._realNumItems; i += this._curLineItemCount) {
                    pos3 = pos2 + this._virtualItems[i].width + this._columnGap;
                    if (pos3 > s_n) {
                        s_n = pos2;
                        return i;
                    }
                    pos2 = pos3;
                }

                s_n = pos2;
                return this._realNumItems - this._curLineItemCount;
            }
        } else {
            pos2 = 0;
            for (i = 0; i < this._realNumItems; i += this._curLineItemCount) {
                pos3 = pos2 + this._virtualItems[i].width + this._columnGap;
                if (pos3 > s_n) {
                    s_n = pos2;
                    return i;
                }
                pos2 = pos3;
            }

            s_n = pos2;
            return this._realNumItems - this._curLineItemCount;
        }
    }

    private getIndexOnPos3(_forceUpdate: boolean): number {
        if (this._realNumItems < this._curLineItemCount) {
            s_n = 0;
            return 0;
        }

        const viewWidth = this.viewWidth;
        const page = Math.floor(s_n / viewWidth);
        const startIndex = page * (this._curLineItemCount * this._curLineItemCount2);
        let pos2 = page * viewWidth;
        let pos3: number;
        for (let i = 0; i < this._curLineItemCount; i++) {
            pos3 = pos2 + this._virtualItems[startIndex + i].width + this._columnGap;
            if (pos3 > s_n) {
                s_n = pos2;
                return startIndex + i;
            }
            pos2 = pos3;
        }

        s_n = pos2;
        return startIndex + this._curLineItemCount - 1;
    }

    private handleScroll(forceUpdate: boolean): void {
        if (this._eventLocked)
            return;

        if (this._layout === ListLayoutType.SingleColumn || this._layout === ListLayoutType.FlowHorizontal) {
            let enterCounter = 0;
            while (this.handleScroll1(forceUpdate)) {
                enterCounter++;
                forceUpdate = false;
                if (enterCounter > 20) {
                    console.log('fairygui: list will never be filled as the item renderer function always returns a different size.');
                    break;
                }
            }
            this.handleArchOrder1();
        } else if (this._layout === ListLayoutType.SingleRow || this._layout === ListLayoutType.FlowVertical) {
            let enterCounter = 0;
            while (this.handleScroll2(forceUpdate)) {
                enterCounter++;
                forceUpdate = false;
                if (enterCounter > 20) {
                    console.log('fairygui: list will never be filled as the item renderer function always returns a different size.');
                    break;
                }
            }
            this.handleArchOrder2();
        } else {
            this.handleScroll3(forceUpdate);
        }

        this._boundsChanged = false;
    }

    private handleScroll1(forceUpdate: boolean): boolean {
        let pos = this._scrollPane!.scrollingPosY;
        let max = pos + this._scrollPane!.viewHeight;
        // "Scroll to the very end, however large the content turns out to be."
        const end = max === this._scrollPane!.contentHeight;

        // Find the first item at the current position.
        s_n = pos;
        const newFirstIndex = this.getIndexOnPos1(forceUpdate);
        pos = s_n;
        if (newFirstIndex === this._firstIndex && !forceUpdate)
            return false;

        const oldFirstIndex = this._firstIndex;
        this._firstIndex = newFirstIndex;
        let curIndex = newFirstIndex;
        const forward = oldFirstIndex > newFirstIndex;
        let childCount = this.numChildren;
        const lastIndex = oldFirstIndex + childCount - 1;
        let reuseIndex = forward ? lastIndex : oldFirstIndex;
        let curX = 0;
        let curY = pos;
        let needRender: boolean;
        let deltaSize = 0;
        let firstItemDeltaSize = 0;
        let url = this._defaultItem;
        let ii: ItemInfo;
        let ii2: ItemInfo;
        let i: number;
        let j: number;
        const partSize = (this._scrollPane!.viewWidth - this._columnGap * (this._curLineItemCount - 1)) / this._curLineItemCount;

        this._itemInfoVer++;

        while (curIndex < this._realNumItems && (end || curY < max)) {
            ii = this._virtualItems[curIndex];

            if (!ii.obj || forceUpdate) {
                if (this.itemProvider != null) {
                    url = this.itemProvider(curIndex % this._numItems);
                    if (url == null)
                        url = this._defaultItem;
                    url = UIPackage.normalizeURL(url as string);
                }

                if (ii.obj && ii.obj.resourceURL !== url) {
                    if (ii.obj instanceof GButton)
                        ii.selected = ii.obj.selected;
                    this.removeChildToPool(ii.obj);
                    ii.obj = null;
                }
            }

            if (!ii.obj) {
                // Look for the best renderer to reuse, so that as few items as
                // possible are built or re-rendered by this pass.
                if (forward) {
                    for (j = reuseIndex; j >= oldFirstIndex; j--) {
                        ii2 = this._virtualItems[j];
                        if (ii2.obj && ii2.updateFlag !== this._itemInfoVer && ii2.obj.resourceURL === url) {
                            if (ii2.obj instanceof GButton)
                                ii2.selected = ii2.obj.selected;
                            ii.obj = ii2.obj;
                            ii2.obj = null;
                            if (j === reuseIndex)
                                reuseIndex--;
                            break;
                        }
                    }
                } else {
                    for (j = reuseIndex; j <= lastIndex; j++) {
                        ii2 = this._virtualItems[j];
                        if (ii2.obj && ii2.updateFlag !== this._itemInfoVer && ii2.obj.resourceURL === url) {
                            if (ii2.obj instanceof GButton)
                                ii2.selected = ii2.obj.selected;
                            ii.obj = ii2.obj;
                            ii2.obj = null;
                            if (j === reuseIndex)
                                reuseIndex++;
                            break;
                        }
                    }
                }

                if (ii.obj) {
                    this.setChildIndex(ii.obj, forward ? curIndex - newFirstIndex : this.numChildren);
                } else {
                    ii.obj = this._pool.getObject(url);
                    if (forward)
                        this.addChildAt(ii.obj!, curIndex - newFirstIndex);
                    else
                        this.addChild(ii.obj!);
                }
                if (ii.obj instanceof GButton)
                    ii.obj.selected = ii.selected ?? false;

                needRender = true;
            } else
                needRender = forceUpdate;

            if (needRender) {
                if (this._autoResizeItem && (this._layout === ListLayoutType.SingleColumn || this._columnCount > 0))
                    ii.obj!.setSize(partSize, ii.obj!.height, true);

                this.itemRenderer!(curIndex % this._numItems, ii.obj!);
                if (curIndex % this._curLineItemCount === 0) {
                    deltaSize += Math.ceil(ii.obj!.height) - ii.height;
                    if (curIndex === newFirstIndex && oldFirstIndex > newFirstIndex) {
                        // Scrolling down: a resized first item shifts everything
                        // below it, so compensate or the view jumps.
                        firstItemDeltaSize = Math.ceil(ii.obj!.height) - ii.height;
                    }
                }
                ii.width = Math.ceil(ii.obj!.width);
                ii.height = Math.ceil(ii.obj!.height);
            }

            ii.updateFlag = this._itemInfoVer;
            ii.obj!.setPosition(curX, curY);
            if (curIndex === newFirstIndex) // one extra so the edge never shows through
                max += ii.height;

            curX += ii.width + this._columnGap;

            if (curIndex % this._curLineItemCount === this._curLineItemCount - 1) {
                curX = 0;
                curY += ii.height + this._lineGap;
            }
            curIndex++;
        }

        for (i = 0; i < childCount; i++) {
            ii = this._virtualItems[oldFirstIndex + i];
            if (ii.updateFlag !== this._itemInfoVer && ii.obj) {
                if (ii.obj instanceof GButton)
                    ii.selected = ii.obj.selected;
                this.removeChildToPool(ii.obj);
                ii.obj = null;
            }
        }

        childCount = this._children.length;
        for (i = 0; i < childCount; i++) {
            const obj = this._virtualItems[newFirstIndex + i].obj!;
            if (this._children[i] !== obj)
                this.setChildIndex(obj, i);
        }

        if (deltaSize !== 0 || firstItemDeltaSize !== 0)
            this._scrollPane!.changeContentSizeOnScrolling(0, deltaSize, 0, firstItemDeltaSize);

        // The last page is not full, so another pass may still add items.
        if (curIndex > 0 && this.numChildren > 0 && this._container.positionY <= 0
            && this.getChildAt(0).y > -this._container.positionY)
            return true;

        return false;
    }

    private handleScroll2(forceUpdate: boolean): boolean {
        let pos = this._scrollPane!.scrollingPosX;
        let max = pos + this._scrollPane!.viewWidth;
        const end = pos === this._scrollPane!.contentWidth;

        // Find the first item at the current position.
        s_n = pos;
        const newFirstIndex = this.getIndexOnPos2(forceUpdate);
        pos = s_n;
        if (newFirstIndex === this._firstIndex && !forceUpdate)
            return false;

        const oldFirstIndex = this._firstIndex;
        this._firstIndex = newFirstIndex;
        let curIndex = newFirstIndex;
        const forward = oldFirstIndex > newFirstIndex;
        let childCount = this.numChildren;
        const lastIndex = oldFirstIndex + childCount - 1;
        let reuseIndex = forward ? lastIndex : oldFirstIndex;
        let curX = pos;
        let curY = 0;
        let needRender: boolean;
        let deltaSize = 0;
        let firstItemDeltaSize = 0;
        let url = this._defaultItem;
        let ii: ItemInfo;
        let ii2: ItemInfo;
        let i: number;
        let j: number;
        const partSize = (this._scrollPane!.viewHeight - this._lineGap * (this._curLineItemCount - 1)) / this._curLineItemCount;

        this._itemInfoVer++;

        while (curIndex < this._realNumItems && (end || curX < max)) {
            ii = this._virtualItems[curIndex];

            if (!ii.obj || forceUpdate) {
                if (this.itemProvider != null) {
                    url = this.itemProvider(curIndex % this._numItems);
                    if (url == null)
                        url = this._defaultItem;
                    url = UIPackage.normalizeURL(url as string);
                }

                if (ii.obj && ii.obj.resourceURL !== url) {
                    if (ii.obj instanceof GButton)
                        ii.selected = ii.obj.selected;
                    this.removeChildToPool(ii.obj);
                    ii.obj = null;
                }
            }

            if (!ii.obj) {
                if (forward) {
                    for (j = reuseIndex; j >= oldFirstIndex; j--) {
                        ii2 = this._virtualItems[j];
                        if (ii2.obj && ii2.updateFlag !== this._itemInfoVer && ii2.obj.resourceURL === url) {
                            if (ii2.obj instanceof GButton)
                                ii2.selected = ii2.obj.selected;
                            ii.obj = ii2.obj;
                            ii2.obj = null;
                            if (j === reuseIndex)
                                reuseIndex--;
                            break;
                        }
                    }
                } else {
                    for (j = reuseIndex; j <= lastIndex; j++) {
                        ii2 = this._virtualItems[j];
                        if (ii2.obj && ii2.updateFlag !== this._itemInfoVer && ii2.obj.resourceURL === url) {
                            if (ii2.obj instanceof GButton)
                                ii2.selected = ii2.obj.selected;
                            ii.obj = ii2.obj;
                            ii2.obj = null;
                            if (j === reuseIndex)
                                reuseIndex++;
                            break;
                        }
                    }
                }

                if (ii.obj) {
                    this.setChildIndex(ii.obj, forward ? curIndex - newFirstIndex : this.numChildren);
                } else {
                    ii.obj = this._pool.getObject(url);
                    if (forward)
                        this.addChildAt(ii.obj!, curIndex - newFirstIndex);
                    else
                        this.addChild(ii.obj!);
                }
                if (ii.obj instanceof GButton)
                    ii.obj.selected = ii.selected ?? false;

                needRender = true;
            } else
                needRender = forceUpdate;

            if (needRender) {
                if (this._autoResizeItem && (this._layout === ListLayoutType.SingleRow || this._lineCount > 0))
                    ii.obj!.setSize(ii.obj!.width, partSize, true);

                this.itemRenderer!(curIndex % this._numItems, ii.obj!);
                if (curIndex % this._curLineItemCount === 0) {
                    deltaSize += Math.ceil(ii.obj!.width) - ii.width;
                    if (curIndex === newFirstIndex && oldFirstIndex > newFirstIndex) {
                        firstItemDeltaSize = Math.ceil(ii.obj!.width) - ii.width;
                    }
                }
                ii.width = Math.ceil(ii.obj!.width);
                ii.height = Math.ceil(ii.obj!.height);
            }

            ii.updateFlag = this._itemInfoVer;
            ii.obj!.setPosition(curX, curY);
            if (curIndex === newFirstIndex) // one extra so the edge never shows through
                max += ii.width;

            curY += ii.height + this._lineGap;

            if (curIndex % this._curLineItemCount === this._curLineItemCount - 1) {
                curY = 0;
                curX += ii.width + this._columnGap;
            }
            curIndex++;
        }

        for (i = 0; i < childCount; i++) {
            ii = this._virtualItems[oldFirstIndex + i];
            if (ii.updateFlag !== this._itemInfoVer && ii.obj) {
                if (ii.obj instanceof GButton)
                    ii.selected = ii.obj.selected;
                this.removeChildToPool(ii.obj);
                ii.obj = null;
            }
        }

        childCount = this._children.length;
        for (i = 0; i < childCount; i++) {
            const obj = this._virtualItems[newFirstIndex + i].obj!;
            if (this._children[i] !== obj)
                this.setChildIndex(obj, i);
        }

        if (deltaSize !== 0 || firstItemDeltaSize !== 0)
            this._scrollPane!.changeContentSizeOnScrolling(deltaSize, 0, firstItemDeltaSize, 0);

        if (curIndex > 0 && this.numChildren > 0 && this._container.positionX <= 0
            && this.getChildAt(0).x > -this._container.positionX)
            return true;

        return false;
    }

    private handleScroll3(forceUpdate: boolean): void {
        let pos = this._scrollPane!.scrollingPosX;

        // Find the first item at the current position.
        s_n = pos;
        const newFirstIndex = this.getIndexOnPos3(forceUpdate);
        pos = s_n;
        if (newFirstIndex === this._firstIndex && !forceUpdate)
            return;

        const oldFirstIndex = this._firstIndex;
        this._firstIndex = newFirstIndex;

        // Pagination does not support variable heights, so filling one page
        // completely is enough.

        let reuseIndex = oldFirstIndex;
        const virtualItemCount = this._virtualItems.length;
        const pageSize = this._curLineItemCount * this._curLineItemCount2;
        const startCol = newFirstIndex % this._curLineItemCount;
        const viewWidth = this.viewWidth;
        const page = Math.floor(newFirstIndex / pageSize);
        const startIndex = page * pageSize;
        const lastIndex = startIndex + pageSize * 2; // two pages, for safety
        let needRender: boolean;
        let i: number;
        let ii: ItemInfo;
        let ii2: ItemInfo;
        let col: number;
        let url = this._defaultItem;
        const partWidth = (this._scrollPane!.viewWidth - this._columnGap * (this._curLineItemCount - 1)) / this._curLineItemCount;
        const partHeight = (this._scrollPane!.viewHeight - this._lineGap * (this._curLineItemCount2 - 1)) / this._curLineItemCount2;

        this._itemInfoVer++;

        // Mark the items this pass will use.
        for (i = startIndex; i < lastIndex; i++) {
            if (i >= this._realNumItems)
                continue;

            col = i % this._curLineItemCount;
            if (i - startIndex < pageSize) {
                if (col < startCol)
                    continue;
            } else {
                if (col > startCol)
                    continue;
            }

            ii = this._virtualItems[i];
            ii.updateFlag = this._itemInfoVer;
        }

        let lastObj: GObject | null = null;
        let insertIndex = 0;
        for (i = startIndex; i < lastIndex; i++) {
            if (i >= this._realNumItems)
                continue;

            ii = this._virtualItems[i];
            if (ii.updateFlag !== this._itemInfoVer)
                continue;

            if (!ii.obj) {
                // Look for a renderer to reuse.
                while (reuseIndex < virtualItemCount) {
                    ii2 = this._virtualItems[reuseIndex];
                    if (ii2.obj && ii2.updateFlag !== this._itemInfoVer) {
                        if (ii2.obj instanceof GButton)
                            ii2.selected = ii2.obj.selected;
                        ii.obj = ii2.obj;
                        ii2.obj = null;
                        break;
                    }
                    reuseIndex++;
                }

                if (insertIndex === -1)
                    insertIndex = this.getChildIndex(lastObj!) + 1;

                if (!ii.obj) {
                    if (this.itemProvider != null) {
                        url = this.itemProvider(i % this._numItems);
                        if (url == null)
                            url = this._defaultItem;
                        url = UIPackage.normalizeURL(url as string);
                    }

                    ii.obj = this._pool.getObject(url);
                    this.addChildAt(ii.obj!, insertIndex);
                } else {
                    insertIndex = this.setChildIndexBefore(ii.obj, insertIndex);
                }
                insertIndex++;

                if (ii.obj instanceof GButton)
                    ii.obj.selected = ii.selected ?? false;

                needRender = true;
            } else {
                needRender = forceUpdate;
                insertIndex = -1;
                lastObj = ii.obj;
            }

            if (needRender) {
                if (this._autoResizeItem) {
                    if (this._curLineItemCount === this._columnCount && this._curLineItemCount2 === this._lineCount)
                        ii.obj!.setSize(partWidth, partHeight, true);
                    else if (this._curLineItemCount === this._columnCount)
                        ii.obj!.setSize(partWidth, ii.obj!.height, true);
                    else if (this._curLineItemCount2 === this._lineCount)
                        ii.obj!.setSize(ii.obj!.width, partHeight, true);
                }

                this.itemRenderer!(i % this._numItems, ii.obj!);
                ii.width = Math.ceil(ii.obj!.width);
                ii.height = Math.ceil(ii.obj!.height);
            }
        }

        // Lay the items out.
        let borderX = (startIndex / pageSize) * viewWidth;
        let xx = borderX;
        let yy = 0;
        let lineHeight = 0;
        for (i = startIndex; i < lastIndex; i++) {
            if (i >= this._realNumItems)
                continue;

            ii = this._virtualItems[i];
            if (ii.updateFlag === this._itemInfoVer)
                ii.obj!.setPosition(xx, yy);

            if (ii.height > lineHeight)
                lineHeight = ii.height;
            if (i % this._curLineItemCount === this._curLineItemCount - 1) {
                xx = borderX;
                yy += lineHeight + this._lineGap;
                lineHeight = 0;

                if (i === startIndex + pageSize - 1) {
                    borderX += viewWidth;
                    xx = borderX;
                    yy = 0;
                }
            } else
                xx += ii.width + this._columnGap;
        }

        // Release whatever is left over.
        for (i = reuseIndex; i < virtualItemCount; i++) {
            ii = this._virtualItems[i];
            if (ii.updateFlag !== this._itemInfoVer && ii.obj) {
                if (ii.obj instanceof GButton)
                    ii.selected = ii.obj.selected;
                this.removeChildToPool(ii.obj);
                ii.obj = null;
            }
        }
    }

    private handleArchOrder1(): void {
        if (this._childrenRenderOrder === ChildrenRenderOrder.Arch) {
            const mid = this._scrollPane!.posY + this.viewHeight / 2;
            let minDist = Number.POSITIVE_INFINITY;
            let apexIndex = 0;
            const cnt = this.numChildren;
            for (let i = 0; i < cnt; i++) {
                const obj = this.getChildAt(i);
                if (!this.foldInvisibleItems || obj.visible) {
                    const dist = Math.abs(mid - obj.y - obj.height / 2);
                    if (dist < minDist) {
                        minDist = dist;
                        apexIndex = i;
                    }
                }
            }
            this.apexIndex = apexIndex;
        }
    }

    private handleArchOrder2(): void {
        if (this._childrenRenderOrder === ChildrenRenderOrder.Arch) {
            const mid = this._scrollPane!.posX + this.viewWidth / 2;
            let minDist = Number.POSITIVE_INFINITY;
            let apexIndex = 0;
            const cnt = this.numChildren;
            for (let i = 0; i < cnt; i++) {
                const obj = this.getChildAt(i);
                if (!this.foldInvisibleItems || obj.visible) {
                    const dist = Math.abs(mid - obj.x - obj.width / 2);
                    if (dist < minDist) {
                        minDist = dist;
                        apexIndex = i;
                    }
                }
            }
            this.apexIndex = apexIndex;
        }
    }

    private handleAlign(contentWidth: number, contentHeight: number): void {
        let newOffsetX = 0;
        let newOffsetY = 0;

        if (contentHeight < this.viewHeight) {
            if (this._verticalAlign === VertAlignType.Middle)
                newOffsetY = Math.floor((this.viewHeight - contentHeight) / 2);
            else if (this._verticalAlign === VertAlignType.Bottom)
                newOffsetY = this.viewHeight - contentHeight;
        }

        if (contentWidth < this.viewWidth) {
            if (this._align === AlignType.Center)
                newOffsetX = Math.floor((this.viewWidth - contentWidth) / 2);
            else if (this._align === AlignType.Right)
                newOffsetX = this.viewWidth - contentWidth;
        }

        if (newOffsetX !== this._alignOffset.x || newOffsetY !== this._alignOffset.y) {
            this._alignOffset.x = newOffsetX;
            this._alignOffset.y = newOffsetY;
            if (this._scrollPane)
                this._scrollPane.adjustMaskContainer();
            else {
                // The reference subtracts `_alignOffset.y` here and adds it in
                // `GComponent.setContainerPosition`; kept as authored.
                this._container.setPosition(this._pivotCorrectX + this._alignOffset.x,
                    this._pivotCorrectY - this._alignOffset.y);
            }
        }
    }

    protected updateBounds(): void {
        if (this._virtual)
            return;

        let child: GObject;
        let curX = 0;
        let curY = 0;
        let maxWidth = 0;
        let maxHeight = 0;
        let cw = 0;
        let ch = 0;
        let j = 0;
        let page = 0;
        let k = 0;
        let i: number;
        const cnt = this._children.length;
        let viewWidth = this.viewWidth;
        let viewHeight = this.viewHeight;
        let lineSize = 0;
        let lineStart = 0;
        let ratio = 0;

        if (this._layout === ListLayoutType.SingleColumn) {
            for (i = 0; i < cnt; i++) {
                child = this.getChildAt(i);
                if (this.foldInvisibleItems && !child.visible)
                    continue;

                if (curY !== 0)
                    curY += this._lineGap;
                child.y = curY;
                // A column is one wide, so x is always 0. Resetting it matters
                // only when the layout is switched on a populated list; the
                // reference left the previous layout's x behind.
                child.x = 0;
                if (this._autoResizeItem)
                    child.setSize(viewWidth, child.height, true);
                curY += Math.ceil(child.height);
                if (child.width > maxWidth)
                    maxWidth = child.width;
            }
            ch = curY;

            // A vertical scroll bar takes width from the items once it appears,
            // which may in turn stop it being needed — one pass is enough.
            if (ch <= viewHeight && this._autoResizeItem && this._scrollPane
                && this._scrollPane._displayInDemand && this._scrollPane.vtScrollBar) {
                viewWidth += this._scrollPane.vtScrollBar.width;
                for (i = 0; i < cnt; i++) {
                    child = this.getChildAt(i);
                    if (this.foldInvisibleItems && !child.visible)
                        continue;

                    child.setSize(viewWidth, child.height, true);
                    if (child.width > maxWidth)
                        maxWidth = child.width;
                }
            }

            cw = Math.ceil(maxWidth);
        } else if (this._layout === ListLayoutType.SingleRow) {
            for (i = 0; i < cnt; i++) {
                child = this.getChildAt(i);
                if (this.foldInvisibleItems && !child.visible)
                    continue;

                if (curX !== 0)
                    curX += this._columnGap;
                child.x = curX;
                // A row is one tall, so y is always 0. See the note in the
                // SingleColumn branch — the reference left it stale here too.
                child.y = 0;
                if (this._autoResizeItem)
                    child.setSize(child.width, viewHeight, true);
                curX += Math.ceil(child.width);
                if (child.height > maxHeight)
                    maxHeight = child.height;
            }
            cw = curX;

            if (cw <= viewWidth && this._autoResizeItem && this._scrollPane
                && this._scrollPane._displayInDemand && this._scrollPane.hzScrollBar) {
                viewHeight += this._scrollPane.hzScrollBar.height;
                for (i = 0; i < cnt; i++) {
                    child = this.getChildAt(i);
                    if (this.foldInvisibleItems && !child.visible)
                        continue;

                    child.setSize(child.width, viewHeight, true);
                    if (child.height > maxHeight)
                        maxHeight = child.height;
                }
            }

            ch = Math.ceil(maxHeight);
        } else if (this._layout === ListLayoutType.FlowHorizontal) {
            if (this._autoResizeItem && this._columnCount > 0) {
                for (i = 0; i < cnt; i++) {
                    child = this.getChildAt(i);
                    if (this.foldInvisibleItems && !child.visible)
                        continue;

                    lineSize += child.sourceWidth;
                    j++;
                    if (j === this._columnCount || i === cnt - 1) {
                        ratio = (viewWidth - lineSize - (j - 1) * this._columnGap) / lineSize;
                        curX = 0;
                        for (j = lineStart; j <= i; j++) {
                            child = this.getChildAt(j);
                            if (this.foldInvisibleItems && !child.visible)
                                continue;

                            child.setPosition(curX, curY);

                            if (j < i) {
                                child.setSize(child.sourceWidth + Math.round(child.sourceWidth * ratio), child.height, true);
                                curX += Math.ceil(child.width) + this._columnGap;
                            } else {
                                child.setSize(viewWidth - curX, child.height, true);
                            }
                            if (child.height > maxHeight)
                                maxHeight = child.height;
                        }
                        // new line
                        curY += Math.ceil(maxHeight) + this._lineGap;
                        maxHeight = 0;
                        j = 0;
                        lineStart = i + 1;
                        lineSize = 0;
                    }
                }
                ch = curY + Math.ceil(maxHeight);
                cw = viewWidth;
            } else {
                for (i = 0; i < cnt; i++) {
                    child = this.getChildAt(i);
                    if (this.foldInvisibleItems && !child.visible)
                        continue;

                    if (curX !== 0)
                        curX += this._columnGap;

                    if (this._columnCount !== 0 && j >= this._columnCount
                        || this._columnCount === 0 && curX + child.width > viewWidth && maxHeight !== 0) {
                        // new line
                        curX = 0;
                        curY += Math.ceil(maxHeight) + this._lineGap;
                        maxHeight = 0;
                        j = 0;
                    }
                    child.setPosition(curX, curY);
                    curX += Math.ceil(child.width);
                    if (curX > maxWidth)
                        maxWidth = curX;
                    if (child.height > maxHeight)
                        maxHeight = child.height;
                    j++;
                }
                ch = curY + Math.ceil(maxHeight);
                cw = Math.ceil(maxWidth);
            }
        } else if (this._layout === ListLayoutType.FlowVertical) {
            if (this._autoResizeItem && this._lineCount > 0) {
                for (i = 0; i < cnt; i++) {
                    child = this.getChildAt(i);
                    if (this.foldInvisibleItems && !child.visible)
                        continue;

                    lineSize += child.sourceHeight;
                    j++;
                    if (j === this._lineCount || i === cnt - 1) {
                        ratio = (viewHeight - lineSize - (j - 1) * this._lineGap) / lineSize;
                        curY = 0;
                        for (j = lineStart; j <= i; j++) {
                            child = this.getChildAt(j);
                            if (this.foldInvisibleItems && !child.visible)
                                continue;

                            child.setPosition(curX, curY);

                            if (j < i) {
                                child.setSize(child.width, child.sourceHeight + Math.round(child.sourceHeight * ratio), true);
                                curY += Math.ceil(child.height) + this._lineGap;
                            } else {
                                child.setSize(child.width, viewHeight - curY, true);
                            }
                            if (child.width > maxWidth)
                                maxWidth = child.width;
                        }
                        // new line
                        curX += Math.ceil(maxWidth) + this._columnGap;
                        maxWidth = 0;
                        j = 0;
                        lineStart = i + 1;
                        lineSize = 0;
                    }
                }
                cw = curX + Math.ceil(maxWidth);
                ch = viewHeight;
            } else {
                for (i = 0; i < cnt; i++) {
                    child = this.getChildAt(i);
                    if (this.foldInvisibleItems && !child.visible)
                        continue;

                    if (curY !== 0)
                        curY += this._lineGap;

                    if (this._lineCount !== 0 && j >= this._lineCount
                        || this._lineCount === 0 && curY + child.height > viewHeight && maxWidth !== 0) {
                        curY = 0;
                        curX += Math.ceil(maxWidth) + this._columnGap;
                        maxWidth = 0;
                        j = 0;
                    }
                    child.setPosition(curX, curY);
                    curY += Math.ceil(child.height);
                    if (curY > maxHeight)
                        maxHeight = curY;
                    if (child.width > maxWidth)
                        maxWidth = child.width;
                    j++;
                }
                cw = curX + Math.ceil(maxWidth);
                ch = Math.ceil(maxHeight);
            }
        } else { // pagination
            let eachHeight = 0;
            if (this._autoResizeItem && this._lineCount > 0)
                eachHeight = Math.floor((viewHeight - (this._lineCount - 1) * this._lineGap) / this._lineCount);

            if (this._autoResizeItem && this._columnCount > 0) {
                for (i = 0; i < cnt; i++) {
                    child = this.getChildAt(i);
                    if (this.foldInvisibleItems && !child.visible)
                        continue;

                    if (j === 0 && (this._lineCount !== 0 && k >= this._lineCount
                        || this._lineCount === 0 && curY + (this._lineCount > 0 ? eachHeight : child.height) > viewHeight)) {
                        // new page
                        page++;
                        curY = 0;
                        k = 0;
                    }

                    lineSize += child.sourceWidth;
                    j++;
                    if (j === this._columnCount || i === cnt - 1) {
                        ratio = (viewWidth - lineSize - (j - 1) * this._columnGap) / lineSize;
                        curX = 0;
                        for (j = lineStart; j <= i; j++) {
                            child = this.getChildAt(j);
                            if (this.foldInvisibleItems && !child.visible)
                                continue;

                            child.setPosition(page * viewWidth + curX, curY);

                            if (j < i) {
                                child.setSize(child.sourceWidth + Math.round(child.sourceWidth * ratio),
                                    this._lineCount > 0 ? eachHeight : child.height, true);
                                curX += Math.ceil(child.width) + this._columnGap;
                            } else {
                                child.setSize(viewWidth - curX, this._lineCount > 0 ? eachHeight : child.height, true);
                            }
                            if (child.height > maxHeight)
                                maxHeight = child.height;
                        }
                        // new line
                        curY += Math.ceil(maxHeight) + this._lineGap;
                        maxHeight = 0;
                        j = 0;
                        lineStart = i + 1;
                        lineSize = 0;

                        k++;
                    }
                }
            } else {
                for (i = 0; i < cnt; i++) {
                    child = this.getChildAt(i);
                    if (this.foldInvisibleItems && !child.visible)
                        continue;

                    if (curX !== 0)
                        curX += this._columnGap;

                    if (this._autoResizeItem && this._lineCount > 0)
                        child.setSize(child.width, eachHeight, true);

                    if (this._columnCount !== 0 && j >= this._columnCount
                        || this._columnCount === 0 && curX + child.width > viewWidth && maxHeight !== 0) {
                        // new line
                        curX = 0;
                        curY += Math.ceil(maxHeight) + this._lineGap;
                        maxHeight = 0;
                        j = 0;
                        k++;

                        if (this._lineCount !== 0 && k >= this._lineCount
                            || this._lineCount === 0 && curY + child.height > viewHeight && maxWidth !== 0) { // new page
                            page++;
                            curY = 0;
                            k = 0;
                        }
                    }
                    child.setPosition(page * viewWidth + curX, curY);
                    curX += Math.ceil(child.width);
                    if (curX > maxWidth)
                        maxWidth = curX;
                    if (child.height > maxHeight)
                        maxHeight = child.height;
                    j++;
                }
            }
            ch = page > 0 ? viewHeight : curY + Math.ceil(maxHeight);
            cw = (page + 1) * viewWidth;
        }

        this.handleAlign(cw, ch);
        this.setBounds(0, 0, cw, ch);
    }

    public setup_beforeAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_beforeAdd(buffer, beginPos);

        buffer.seek(beginPos, 5);

        this._layout = buffer.readByte();
        this._selectionMode = buffer.readByte();
        this._align = buffer.readByte();
        this._verticalAlign = buffer.readByte();
        this._lineGap = buffer.readShort();
        this._columnGap = buffer.readShort();
        this._lineCount = buffer.readShort();
        this._columnCount = buffer.readShort();
        this._autoResizeItem = buffer.readBool();
        this._childrenRenderOrder = buffer.readByte();
        this._apexIndex = buffer.readShort();

        if (buffer.readBool()) {
            this._margin.top = buffer.readInt();
            this._margin.bottom = buffer.readInt();
            this._margin.left = buffer.readInt();
            this._margin.right = buffer.readInt();
        }

        const overflow: number = buffer.readByte();
        if (overflow === OverflowType.Scroll) {
            const savedPos = buffer.position;
            buffer.seek(beginPos, 7);
            this.setupScroll(buffer);
            buffer.position = savedPos;
        } else
            this.setupOverflow(overflow);

        if (buffer.readBool()) // clipSoftness
            buffer.skip(8);

        if (buffer.version >= 2) {
            this.scrollItemToViewOnClick = buffer.readBool();
            this.foldInvisibleItems = buffer.readBool();
        }

        buffer.seek(beginPos, 8);

        this._defaultItem = buffer.readS();
        this.readItems(buffer);
    }

    protected readItems(buffer: ByteBuffer): void {
        const cnt = buffer.readShort();
        for (let i = 0; i < cnt; i++) {
            let nextPos = buffer.readShort();
            nextPos += buffer.position;

            let str = buffer.readS();
            if (str == null) {
                str = this._defaultItem;
                if (!str) {
                    buffer.position = nextPos;
                    continue;
                }
            }

            const obj = this.getFromPool(str);
            if (obj) {
                this.addChild(obj);
                this.setupItem(buffer, obj);
            }

            buffer.position = nextPos;
        }
    }

    protected setupItem(buffer: ByteBuffer, obj: GObject): void {
        let str = buffer.readS();
        if (str != null)
            obj.text = str;
        str = buffer.readS();
        if (str != null && obj instanceof GButton)
            obj.selectedTitle = str;
        str = buffer.readS();
        if (str != null)
            obj.icon = str;
        str = buffer.readS();
        if (str != null && obj instanceof GButton)
            obj.selectedIcon = str;
        str = buffer.readS();
        if (str != null)
            obj.name = str;

        if (obj instanceof GComponent) {
            const cnt = buffer.readShort();
            for (let i = 0; i < cnt; i++) {
                const cc = obj.getController(buffer.readS() as string);
                str = buffer.readS();
                if (cc)
                    cc.selectedPageId = str;
            }

            if (buffer.version >= 2) {
                const cnt2 = buffer.readShort();
                for (let i = 0; i < cnt2; i++) {
                    const target = buffer.readS();
                    const propertyId = buffer.readShort();
                    const value = buffer.readS();
                    const obj2 = obj.getChildByPath(target as string);
                    if (obj2)
                        obj2.setProp(propertyId, value);
                }
            }
        }
    }

    public setup_afterAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_afterAdd(buffer, beginPos);

        buffer.seek(beginPos, 6);

        const i = buffer.readShort();
        if (i !== -1)
            this._selectionController = this.parent!.getControllerAt(i);
    }
}
