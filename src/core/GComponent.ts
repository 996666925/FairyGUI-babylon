import { GObject } from './GObject.js';
import { Controller } from './Controller.js';
import { Margin } from './Margin.js';
import { ChildrenRenderOrder, ObjectType, OverflowType } from './FieldTypes.js';
import { Rect, Point } from './utils/Geometry.js';
import { EventType } from './event/Event.js';
import { newObject } from './ObjectFactory.js';
import { UIPackage } from './UIPackage.js';
import { PixelHitTest, ChildHitArea, type IHitTest } from './event/HitTest.js';
import { getRenderFactory, type IRenderObject } from './render/IRenderObject.js';
import { translateComponent } from './TranslationHelper.js';
import { createScrollPane, createTransition } from './Builtins.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { PackageItem } from './PackageItem.js';
import type { ScrollPane } from './ScrollPane.js';
import type { Transition } from './Transition.js';
import type { GGroup } from './GGroup.js';
import type { GButton } from './GButton.js';

/**
 * A container in the display list.
 *
 * Owns a `_container` render object that is a child of its own node; children
 * are parented there rather than directly on `_node`, so the pivot and margin
 * offsets can be applied to the whole child set at once.
 */
export class GComponent extends GObject {
    public hitArea?: IHitTest;

    private _sortingChildCount = 0;
    private _opaque = false;
    private _applyingController: Controller | null = null;
    private _maskContent: GObject | null = null;
    private _maskInverted = false;
    /** Set by `setupOverflow(Hidden)`; clips children to the content box. */
    private _clipsContent = false;

    protected _margin = new Margin();
    protected _trackBounds = false;
    protected _boundsChanged = false;
    protected _childrenRenderOrder: ChildrenRenderOrder = ChildrenRenderOrder.Ascent;
    protected _apexIndex = 0;

    public _buildingDisplayList = false;
    public _children: GObject[] = [];
    public _controllers: Controller[] = [];
    public _transitions: Transition[] = [];
    public _container: IRenderObject;
    public _scrollPane: ScrollPane | null = null;
    public _alignOffset = new Point();
    /** True when this component clips its content with an explicit mask object. */
    public _customMask = false;

    public constructor() {
        super();

        this._container = getRenderFactory().createObject();
        this._node.addChild(this._container);
    }

    /** The render object children are attached to. */
    public get displayListContainer(): IRenderObject {
        return this._container;
    }

    // ---- children --------------------------------------------------------

    public addChild(child: GObject): GObject {
        return this.addChildAt(child, this._children.length);
    }

    public addChildAt(child: GObject, index: number): GObject {
        if (!child)
            throw new Error('child is null');

        const numChildren = this._children.length;
        if (index < 0 || index > numChildren)
            throw new Error('Invalid child index');

        if (child.parent === this) {
            this.setChildIndex(child, index);
            return child;
        }

        child.removeFromParent();
        child._parent = this;

        const cnt = this._children.length;
        if (child.sortingOrder !== 0) {
            this._sortingChildCount++;
            index = this.getInsertPosForSortingChild(child);
        } else if (this._sortingChildCount > 0) {
            // Sorting children always sit at the end.
            if (index > cnt - this._sortingChildCount)
                index = cnt - this._sortingChildCount;
        }

        if (index === cnt)
            this._children.push(child);
        else
            this._children.splice(index, 0, child);

        this.onChildAdd(child, index);
        this.setBoundsChangedFlag();

        // The child is in the tree as of the line above, so whether it is live
        // can now be answered — and it may have arrived with a subtree of its own.
        child.checkEnabled();

        return child;
    }

    private getInsertPosForSortingChild(target: GObject): number {
        for (let i = 0; i < this._children.length; i++) {
            const child = this._children[i];
            if (child === target)
                continue;
            if (target.sortingOrder < child.sortingOrder)
                return i;
        }
        return this._children.length;
    }

    public removeChild(child: GObject, dispose = false): GObject {
        const index = this._children.indexOf(child);
        if (index !== -1)
            this.removeChildAt(index, dispose);
        return child;
    }

    public removeChildAt(index: number, dispose = false): GObject {
        if (index < 0 || index >= this.numChildren)
            throw new Error('Invalid child index');

        const child = this._children[index];
        child._parent = null;

        if (child.sortingOrder !== 0)
            this._sortingChildCount--;

        this._children.splice(index, 1);
        child.group = null;
        this._container.removeChild(child.node);
        // Detached, so nothing under it is live any more.
        child.checkEnabled();

        if (this._childrenRenderOrder === ChildrenRenderOrder.Arch)
            this.callLater(() => this.buildNativeDisplayList());

        if (dispose)
            child.dispose();

        this.setBoundsChangedFlag();
        return child;
    }

    public removeChildren(beginIndex = 0, endIndex = -1, dispose = false): void {
        if (endIndex < 0 || endIndex >= this.numChildren)
            endIndex = this.numChildren - 1;

        for (let i = beginIndex; i <= endIndex; ++i)
            this.removeChildAt(beginIndex, dispose);
    }

    public getChildAt(index: number): GObject {
        if (index < 0 || index >= this.numChildren)
            throw new Error('Invalid child index');
        return this._children[index];
    }

    public getChild(name: string): GObject | null {
        for (const child of this._children) {
            if (child.name === name)
                return child;
        }
        return null;
    }

    /** Resolves a dotted path such as `"panel.body.title"`. */
    public getChildByPath(path: string): GObject | null {
        const arr = path.split('.');
        const cnt = arr.length;
        let gcom: GComponent = this;
        let obj: GObject | null = null;

        for (let i = 0; i < cnt; ++i) {
            obj = gcom.getChild(arr[i]);
            if (!obj)
                break;

            if (i !== cnt - 1) {
                const next = obj as GComponent;
                // Duck-typed: a non-container cannot be descended into.
                if (typeof next.getChild !== 'function') {
                    obj = null;
                    break;
                }
                gcom = next;
            }
        }

        return obj;
    }

    public getVisibleChild(name: string): GObject | null {
        for (const child of this._children) {
            if (child._finalVisible && child.name === name)
                return child;
        }
        return null;
    }

    public getChildInGroup(name: string, group: GGroup): GObject | null {
        for (const child of this._children) {
            if (child.group === group && child.name === name)
                return child;
        }
        return null;
    }

    public getChildById(id: string): GObject | null {
        for (const child of this._children) {
            if (child._id === id)
                return child;
        }
        return null;
    }

    public getChildIndex(child: GObject): number {
        return this._children.indexOf(child);
    }

    public setChildIndex(child: GObject, index: number): void {
        const oldIndex = this._children.indexOf(child);
        if (oldIndex === -1)
            throw new Error('Not a child of this container');

        // Sorting children position themselves; an explicit index has no effect.
        if (child.sortingOrder !== 0)
            return;

        const cnt = this._children.length;
        if (this._sortingChildCount > 0) {
            if (index > cnt - this._sortingChildCount - 1)
                index = cnt - this._sortingChildCount - 1;
        }

        this._setChildIndex(child, oldIndex, index);
    }

    public setChildIndexBefore(child: GObject, index: number): number {
        const oldIndex = this._children.indexOf(child);
        if (oldIndex === -1)
            throw new Error('Not a child of this container');

        if (child.sortingOrder !== 0)
            return oldIndex;

        const cnt = this._children.length;
        if (this._sortingChildCount > 0) {
            if (index > cnt - this._sortingChildCount - 1)
                index = cnt - this._sortingChildCount - 1;
        }

        if (oldIndex < index)
            return this._setChildIndex(child, oldIndex, index - 1);
        return this._setChildIndex(child, oldIndex, index);
    }

    private _setChildIndex(child: GObject, oldIndex: number, index: number): number {
        const cnt = this._children.length;
        if (index > cnt)
            index = cnt;

        if (oldIndex === index)
            return oldIndex;

        this._children.splice(oldIndex, 1);
        this._children.splice(index, 0, child);

        if (this._childrenRenderOrder === ChildrenRenderOrder.Ascent)
            this._container.setChildIndex(child.node, index);
        else if (this._childrenRenderOrder === ChildrenRenderOrder.Descent)
            this._container.setChildIndex(child.node, cnt - index);
        else
            this.callLater(() => this.buildNativeDisplayList());

        this.setBoundsChangedFlag();
        return index;
    }

    public swapChildren(child1: GObject, child2: GObject): void {
        const index1 = this._children.indexOf(child1);
        const index2 = this._children.indexOf(child2);
        if (index1 === -1 || index2 === -1)
            throw new Error('Not a child of this container');
        this.swapChildrenAt(index1, index2);
    }

    public swapChildrenAt(index1: number, index2: number): void {
        const child1 = this._children[index1];
        const child2 = this._children[index2];
        this.setChildIndex(child1, index2);
        this.setChildIndex(child2, index1);
    }

    public get numChildren(): number {
        return this._children.length;
    }

    public isAncestorOf(child: GObject | null): boolean {
        if (!child)
            return false;

        let p: GComponent | null = child.parent;
        while (p) {
            if (p === this)
                return true;
            p = p.parent;
        }
        return false;
    }

    // ---- controllers -----------------------------------------------------

    public addController(controller: Controller): void {
        this._controllers.push(controller);
        controller.parent = this;
        this.applyController(controller);
    }

    public getControllerAt(index: number): Controller {
        return this._controllers[index];
    }

    public getController(name: string): Controller | null {
        for (const c of this._controllers) {
            if (c.name === name)
                return c;
        }
        return null;
    }

    public removeController(c: Controller): void {
        const index = this._controllers.indexOf(c);
        if (index === -1)
            throw new Error('controller not exists');

        c.parent = null as unknown as GComponent;
        this._controllers.splice(index, 1);

        for (const child of this._children)
            child.handleControllerChanged(c);
    }

    public get controllers(): Controller[] {
        return this._controllers;
    }

    public applyController(c: Controller): void {
        this._applyingController = c;
        for (const child of this._children)
            child.handleControllerChanged(c);
        this._applyingController = null;
        c.runActions();
    }

    public applyAllControllers(): void {
        for (const c of this._controllers)
            this.applyController(c);
    }

    /**
     * Lifts the selected radio button above its siblings, so its "on" state
     * draws last. Called by `GButton` when a radio becomes selected.
     */
    public adjustRadioGroupDepth(obj: GObject, c: Controller): void {
        let myIndex = -1;
        let maxIndex = -1;

        for (let i = 0; i < this._children.length; i++) {
            const child = this._children[i];
            if (child === obj) {
                myIndex = i;
            } else if (typeof (child as GButton).relatedController !== 'undefined'
                && (child as GButton).relatedController === c) {
                if (i > maxIndex)
                    maxIndex = i;
            }
        }

        if (myIndex < maxIndex) {
            if (this._applyingController)
                this._children[maxIndex].handleControllerChanged(this._applyingController);
            this.swapChildrenAt(myIndex, maxIndex);
        }
    }

    // ---- transitions -----------------------------------------------------

    public getTransitionAt(index: number): Transition {
        return this._transitions[index];
    }

    public getTransition(transName: string): Transition | null {
        for (const trans of this._transitions) {
            if (trans.name === transName)
                return trans;
        }
        return null;
    }

    // ---- layout ----------------------------------------------------------

    public isChildInView(child: GObject): boolean {
        if (this._container.scrollRect) {
            return child.x + child.width >= 0 && child.x <= this.width
                && child.y + child.height >= 0 && child.y <= this.height;
        } else if (this._scrollPane) {
            return this._scrollPane.isChildInView(child);
        }
        return true;
    }

    public getFirstChildInView(): number {
        for (let i = 0; i < this._children.length; ++i) {
            if (this.isChildInView(this._children[i]))
                return i;
        }
        return -1;
    }

    public get scrollPane(): ScrollPane | null {
        return this._scrollPane;
    }

    public get opaque(): boolean {
        return this._opaque;
    }

    public set opaque(value: boolean) {
        this._opaque = value;
    }

    public get margin(): Margin {
        return this._margin;
    }

    public set margin(value: Margin) {
        this._margin.copy(value);
        this.handleSizeChanged();
    }

    public get childrenRenderOrder(): ChildrenRenderOrder {
        return this._childrenRenderOrder;
    }

    public set childrenRenderOrder(value: ChildrenRenderOrder) {
        if (this._childrenRenderOrder !== value) {
            this._childrenRenderOrder = value;
            this.buildNativeDisplayList();
        }
    }

    public get apexIndex(): number {
        return this._apexIndex;
    }

    public set apexIndex(value: number) {
        if (this._apexIndex !== value) {
            this._apexIndex = value;
            if (this._childrenRenderOrder === ChildrenRenderOrder.Arch)
                this.buildNativeDisplayList();
        }
    }

    // ---- masks -----------------------------------------------------------

    public get mask(): GObject | null {
        return this._maskContent;
    }

    public set mask(value: GObject | null) {
        this.setMask(value, false);
    }

    /**
     * Uses `value`'s silhouette to clip this component's content.
     *
     * The render object carries the mask rather than a nested node, so there is
     * no extra container to keep in sync when the mask moves or resizes — the
     * backend follows the mask object's own transform.
     */
    public setMask(value: GObject | null, inverted: boolean): void {
        if (this._maskContent) {
            this._maskContent.off(EventType.XY_CHANGED, this.onMaskContentChanged, this);
            this._maskContent.off(EventType.SIZE_CHANGED, this.onMaskContentChanged, this);
            this._maskContent.visible = true;
        }

        this._maskContent = value;

        if (value) {
            // Only shapes can mask; other objects have no usable silhouette.
            if (!isMaskable(value))
                return;

            this._maskInverted = inverted;
            value.visible = false;
            value.on(EventType.XY_CHANGED, this.onMaskContentChanged, this);
            value.on(EventType.SIZE_CHANGED, this.onMaskContentChanged, this);
            this.onMaskContentChanged();
        } else {
            this._customMask = false;
            this._container.mask = null;
            this._container.maskInverted = false;
            this._container.setPosition(this._pivotCorrectX, this._pivotCorrectY);
        }
    }

    private onMaskContentChanged = (): void => {
        if (!this._maskContent)
            return;

        this._customMask = true;
        this._container.mask = this._maskContent.node;
        this._container.maskInverted = this._maskInverted;
        this._container.setPosition(this._pivotCorrectX, this._pivotCorrectY);
    };

    /** Offset from the node's origin to the content box's top-left corner. */
    public get _pivotCorrectX(): number {
        return -this.pivotX * this._width + this._margin.left;
    }

    public get _pivotCorrectY(): number {
        return -this.pivotY * this._height + this._margin.top;
    }

    public get baseUserData(): string | null {
        const buffer = this.packageItem!.rawData!;
        buffer.seek(0, 4);
        return buffer.readS();
    }

    // ---- protected hooks -------------------------------------------------

    protected setupScroll(buffer: ByteBuffer): void {
        this._scrollPane = createScrollPane(this);
        this._scrollPane.setup(buffer);
    }

    protected setupOverflow(overflow: OverflowType): void {
        if (overflow === OverflowType.Hidden)
            this._clipsContent = true;

        if (!this._margin.isNone())
            this.handleSizeChanged();
        else
            this.updateScrollRect();
    }

    /** Keeps the container's clip rect in step with the content box. */
    private updateScrollRect(): void {
        if (this._scrollPane || this._customMask || !this._clipsContent)
            return;

        const w = this.width - this._margin.left - this._margin.right;
        const h = this.height - this._margin.top - this._margin.bottom;
        if (this._container.scrollRect)
            this._container.scrollRect.setTo(0, 0, w, h);
        else
            this._container.scrollRect = new Rect(0, 0, w, h);
    }

    protected handleSizeChanged(): void {
        super.handleSizeChanged();

        this.setContainerPosition();

        if (this._scrollPane)
            this._scrollPane.onOwnerSizeChanged();
        else
            this._container.setContentSize(this.viewWidth, this.viewHeight);

        this.updateScrollRect();
    }

    private setContainerPosition(): void {
        if (this._customMask)
            this._container.setPosition(this._pivotCorrectX, this._pivotCorrectY);
        else if (!this._scrollPane)
            this._container.setPosition(this._pivotCorrectX + this._alignOffset.x, this._pivotCorrectY + this._alignOffset.y);
    }

    protected onMoved(): void {
        this.setContainerPosition();
    }

    protected handleGrayedChanged(): void {
        const c = this.getController('grayed');
        if (c) {
            c.selectedIndex = this.grayed ? 1 : 0;
            return;
        }

        for (const child of this._children)
            child.grayed = this.grayed;
    }

    public handleControllerChanged(c: Controller): void {
        super.handleControllerChanged(c);
        this._scrollPane?.handleControllerChanged(c);
    }

    protected _hitTest(pt: Point, globalPt: Point): GObject | null {
        if (this._maskContent) {
            // A mask keeps whatever its shape covers; an inverted one keeps
            // whatever the shape *misses*. Getting the second case backwards
            // leaves a guide layer swallowing the very click its highlight is
            // cut out for: the hole shows the button underneath, but the layer
            // still answers for it.
            const covered = this._maskContent.hitTest(globalPt, false) !== null;
            if (covered === this._maskInverted)
                return null;
        }

        if (this.hitArea) {
            if (!this.hitArea.hitTest(pt, globalPt))
                return null;
        } else if (this._container.scrollRect) {
            // Clicks outside the clipped region never reach the children.
            const clip = this._container.scrollRect;
            if (pt.x < clip.x || pt.y < clip.y || pt.x >= clip.xMax || pt.y >= clip.yMax)
                return null;
        }

        if (this._scrollPane) {
            const target = this._scrollPane.hitTest(pt, globalPt);
            if (!target)
                return null;
            if (target !== this)
                return target;
        }

        // Front to back: the last child drawn is the first to receive a click.
        for (let i = this._children.length - 1; i >= 0; i--) {
            const child = this._children[i];
            if (this._maskContent === child || child._touchDisabled)
                continue;

            const target = child.hitTest(globalPt);
            if (target)
                return target;
        }

        if (this._opaque && (this.hitArea
            || (pt.x >= 0 && pt.y >= 0 && pt.x < this._width && pt.y < this._height)))
            return this;

        return null;
    }

    // ---- display list ----------------------------------------------------

    private onChildAdd(child: GObject, index: number): void {
        this._container.addChild(child.node);
        child.node.visible = child._finalVisible;

        if (this._buildingDisplayList)
            return;

        const cnt = this._children.length;
        if (this._childrenRenderOrder === ChildrenRenderOrder.Ascent)
            this._container.setChildIndex(child.node, index);
        else if (this._childrenRenderOrder === ChildrenRenderOrder.Descent)
            this._container.setChildIndex(child.node, cnt - index);
        else
            this.callLater(() => this.buildNativeDisplayList());
    }

    /** Re-orders the container's children to match `_childrenRenderOrder`. */
    public buildNativeDisplayList(): void {
        const cnt = this._children.length;
        if (cnt === 0)
            return;

        switch (this._childrenRenderOrder) {
            case ChildrenRenderOrder.Ascent: {
                let j = 0;
                for (let i = 0; i < cnt; i++)
                    this._container.setChildIndex(this._children[i].node, j++);
                break;
            }
            case ChildrenRenderOrder.Descent: {
                let j = 0;
                for (let i = cnt - 1; i >= 0; i--)
                    this._container.setChildIndex(this._children[i].node, j++);
                break;
            }
            case ChildrenRenderOrder.Arch: {
                let j = 0;
                for (let i = 0; i < this._apexIndex; i++)
                    this._container.setChildIndex(this._children[i].node, j++);
                for (let i = cnt - 1; i >= this._apexIndex; i--)
                    this._container.setChildIndex(this._children[i].node, j++);
                break;
            }
        }
    }

    // ---- bounds ----------------------------------------------------------

    public setBoundsChangedFlag(): void {
        if (!this._scrollPane && !this._trackBounds)
            return;

        if (!this._boundsChanged) {
            this._boundsChanged = true;
            this.callLater(() => this.refresh());
        }
    }

    private refresh(): void {
        if (!this._boundsChanged)
            return;

        for (const child of this._children)
            child.ensureSizeCorrect();

        this.updateBounds();
    }

    public ensureBoundsCorrect(): void {
        for (const child of this._children)
            child.ensureSizeCorrect();

        if (this._boundsChanged)
            this.updateBounds();
    }

    protected updateBounds(): void {
        let ax = 0;
        let ay = 0;
        let aw = 0;
        let ah = 0;

        if (this._children.length > 0) {
            let ar = Number.NEGATIVE_INFINITY;
            let ab = Number.NEGATIVE_INFINITY;
            ax = Number.POSITIVE_INFINITY;
            ay = Number.POSITIVE_INFINITY;

            for (const child of this._children) {
                if (child.x < ax)
                    ax = child.x;
                if (child.y < ay)
                    ay = child.y;
                if (child.x + child.actualWidth > ar)
                    ar = child.x + child.actualWidth;
                if (child.y + child.actualHeight > ab)
                    ab = child.y + child.actualHeight;
            }
            aw = ar - ax;
            ah = ab - ay;
        }

        this.setBounds(ax, ay, aw, ah);
    }

    public setBounds(ax: number, ay: number, aw: number, ah = 0): void {
        this._boundsChanged = false;
        this._scrollPane?.setContentSize(Math.round(ax + aw), Math.round(ay + ah));
    }

    public get viewWidth(): number {
        if (this._scrollPane)
            return this._scrollPane.viewWidth;
        return this.width - this._margin.left - this._margin.right;
    }

    public set viewWidth(value: number) {
        if (this._scrollPane)
            this._scrollPane.viewWidth = value;
        else
            this.width = value + this._margin.left + this._margin.right;
    }

    public get viewHeight(): number {
        if (this._scrollPane)
            return this._scrollPane.viewHeight;
        return this.height - this._margin.top - this._margin.bottom;
    }

    public set viewHeight(value: number) {
        if (this._scrollPane)
            this._scrollPane.viewHeight = value;
        else
            this.height = value + this._margin.top + this._margin.bottom;
    }

    /** Snaps a scroll offset to the nearest child boundary. */
    public getSnappingPosition(xValue: number, yValue: number, resultPoint?: Point): Point {
        const resultPoint2 = resultPoint ?? new Point();
        const cnt = this._children.length;

        if (cnt === 0) {
            resultPoint2.setTo(0, 0);
            return resultPoint2;
        }

        this.ensureBoundsCorrect();

        let obj: GObject | null = null;
        let prev: GObject;
        let i = 0;

        if (yValue !== 0) {
            for (; i < cnt; i++) {
                obj = this._children[i];
                if (yValue < obj.y) {
                    if (i === 0) {
                        yValue = 0;
                        break;
                    }
                    prev = this._children[i - 1];
                    yValue = yValue < prev.y + prev.actualHeight / 2 ? prev.y : obj.y;
                    break;
                }
            }
            if (i === cnt && obj)
                yValue = obj.y;
        }

        if (xValue !== 0) {
            if (i > 0)
                i--;
            for (; i < cnt; i++) {
                obj = this._children[i];
                if (xValue < obj.x) {
                    if (i === 0) {
                        xValue = 0;
                        break;
                    }
                    prev = this._children[i - 1];
                    xValue = xValue < prev.x + prev.actualWidth / 2 ? prev.x : obj.x;
                    break;
                }
            }
            if (i === cnt && obj)
                xValue = obj.x;
        }

        resultPoint2.setTo(xValue, yValue);
        return resultPoint2;
    }

    /** Moves `child` when its `sortingOrder` changes. */
    public childSortingOrderChanged(child: GObject, oldValue: number, newValue = 0): void {
        if (newValue === 0) {
            this._sortingChildCount--;
            this.setChildIndex(child, this._children.length);
        } else {
            if (oldValue === 0)
                this._sortingChildCount++;

            const oldIndex = this._children.indexOf(child);
            const index = this.getInsertPosForSortingChild(child);
            if (oldIndex < index)
                this._setChildIndex(child, oldIndex, index - 1);
            else
                this._setChildIndex(child, oldIndex, index);
        }
    }

    // ---- construction ----------------------------------------------------

    public constructFromResource(): void {
        this.constructFromResource2(null, 0);
    }

    /**
     * Builds this component's children from its package payload.
     *
     * @param objectPool when present, children at `poolIndex + i` are reused
     *   instead of built — how `GList` recycles item renderers.
     */
    public constructFromResource2(objectPool: GObject[] | null, poolIndex: number): void {
        const contentItem = this.packageItem!.getBranch();

        if (!contentItem.decoded) {
            contentItem.decoded = true;
            translateComponent(contentItem);
        }

        const buffer = contentItem.rawData!;
        buffer.seek(0, 0);

        this._underConstruct = true;

        this.sourceWidth = buffer.readInt();
        this.sourceHeight = buffer.readInt();
        this.initWidth = this.sourceWidth;
        this.initHeight = this.sourceHeight;

        this.setSize(this.sourceWidth, this.sourceHeight);

        if (buffer.readBool()) {
            this.minWidth = buffer.readInt();
            this.maxWidth = buffer.readInt();
            this.minHeight = buffer.readInt();
            this.maxHeight = buffer.readInt();
        }

        if (buffer.readBool()) {
            const px = buffer.readFloat();
            const py = buffer.readFloat();
            this.setPivot(px, py, buffer.readBool());
        }

        if (buffer.readBool()) {
            this._margin.top = buffer.readInt();
            this._margin.bottom = buffer.readInt();
            this._margin.left = buffer.readInt();
            this._margin.right = buffer.readInt();
        }

        const overflow: number = buffer.readByte();
        if (overflow === OverflowType.Scroll) {
            const savedPos = buffer.position;
            buffer.seek(0, 7);
            this.setupScroll(buffer);
            buffer.position = savedPos;
        } else {
            this.setupOverflow(overflow);
        }

        if (buffer.readBool())
            buffer.skip(8);

        this._buildingDisplayList = true;

        // -- controllers --
        buffer.seek(0, 1);
        const controllerCount = buffer.readShort();
        for (let i = 0; i < controllerCount; i++) {
            let nextPos = buffer.readShort();
            nextPos += buffer.position;

            const controller = new Controller();
            this._controllers.push(controller);
            controller.parent = this;
            controller.setup(buffer);

            buffer.position = nextPos;
        }

        // -- children --
        buffer.seek(0, 2);
        const childCount = buffer.readShort();
        for (let i = 0; i < childCount; i++) {
            const dataLen = buffer.readShort();
            const curPos = buffer.position;
            let child: GObject | null;

            if (objectPool) {
                child = objectPool[poolIndex + i];
            } else {
                buffer.seek(curPos, 0);

                const type: ObjectType = buffer.readByte();
                const src = buffer.readS();
                const pkgId = buffer.readS();

                let pi: PackageItem | null = null;
                if (src != null) {
                    // A `pkgId` lets a component reference an item in another
                    // package; otherwise it resolves against its own.
                    const pkg = pkgId != null ? UIPackage.getById(pkgId) : contentItem.owner;
                    pi = pkg ? pkg.getItemById(src) ?? null : null;
                }

                if (pi) {
                    child = newObject(pi);
                    child?.constructFromResource();
                } else {
                    child = newObject(type);
                }
            }

            if (!child)
                throw new Error(`fairygui: could not build child ${i} of '${contentItem.name}'`);

            child._underConstruct = true;
            child.setup_beforeAdd(buffer, curPos);
            child._parent = this;
            this._container.addChild(child.node);
            this._children.push(child);

            buffer.position = curPos + dataLen;
        }

        // -- relations --
        buffer.seek(0, 3);
        this.relations.setup(buffer, true);

        buffer.seek(0, 2);
        buffer.skip(2);
        for (let i = 0; i < childCount; i++) {
            let nextPos = buffer.readShort();
            nextPos += buffer.position;

            buffer.seek(buffer.position, 3);
            this._children[i].relations.setup(buffer, false);

            buffer.position = nextPos;
        }

        // -- per-child trailing setup --
        buffer.seek(0, 2);
        buffer.skip(2);
        for (let i = 0; i < childCount; i++) {
            let nextPos = buffer.readShort();
            nextPos += buffer.position;

            const child = this._children[i];
            child.setup_afterAdd(buffer, buffer.position);
            child._underConstruct = false;

            buffer.position = nextPos;
        }

        // -- component-level properties --
        buffer.seek(0, 4);
        buffer.skip(2); // customData
        this._opaque = buffer.readBool();

        const maskId = buffer.readShort();
        if (maskId !== -1)
            this.setMask(this.getChildAt(maskId), buffer.readBool());

        const hitTestId = buffer.readS();
        const i1 = buffer.readInt();
        const i2 = buffer.readInt();

        if (hitTestId != null) {
            const pi = contentItem.owner.getItemById(hitTestId);
            if (pi?.hitTestData)
                this.hitArea = new PixelHitTest(pi.hitTestData, i1, i2);
        } else if (i1 !== 0 && i2 !== -1) {
            this.hitArea = new ChildHitArea(this.getChildAt(i2));
        }

        // -- transitions --
        buffer.seek(0, 5);
        const transitionCount = buffer.readShort();
        for (let i = 0; i < transitionCount; i++) {
            let nextPos = buffer.readShort();
            nextPos += buffer.position;

            const trans = createTransition(this);
            trans.setup(buffer);
            this._transitions.push(trans);

            buffer.position = nextPos;
        }

        this.applyAllControllers();

        this._buildingDisplayList = false;
        this._underConstruct = false;

        this.buildNativeDisplayList();
        this.setBoundsChangedFlag();

        if (contentItem.objectType !== ObjectType.Component)
            this.constructExtension(buffer);

        this.onConstruct();
    }

    /** Subclasses decode their own extra payload here. */
    protected constructExtension(_buffer: ByteBuffer): void {
    }

    protected onConstruct(): void {
    }

    public setup_afterAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_afterAdd(buffer, beginPos);

        buffer.seek(beginPos, 4);

        const pageController = buffer.readShort();
        if (pageController !== -1 && this._scrollPane)
            this._scrollPane.pageController = this._parent!.getControllerAt(pageController);

        const cnt = buffer.readShort();
        for (let i = 0; i < cnt; i++) {
            const c = this.getController(buffer.readS() as string);
            const pageId = buffer.readS();
            if (c)
                c.selectedPageId = pageId;
        }

        if (buffer.version >= 2) {
            const cnt2 = buffer.readShort();
            for (let i = 0; i < cnt2; i++) {
                const target = buffer.readS();
                const propertyId = buffer.readShort();
                const value = buffer.readS();
                const obj = target != null ? this.getChildByPath(target) : null;
                if (obj)
                    obj.setProp(propertyId, value);
            }
        }
    }

    /**
     * Ticks the subtree.
     *
     * `GRoot.update` reaches only its own children, so the walk has to continue
     * here. A widget's `onUpdate` is where a movie clip advances and a loader
     * animates; a list's scroll pane throws its momentum and springs back from
     * an overscroll. None of that happens without this.
     *
     * The pane is ticked explicitly because it is not a child — it is a
     * collaborator that lives on this component — so the walk below would never
     * reach it.
     */
    public override onUpdate(dt: number): void {
        super.onUpdate(dt);

        this._scrollPane?.update(dt);

        for (const child of this._children)
            child.onUpdate(dt);
    }

    /**
     * Flips liveness for the whole subtree, not just this component.
     *
     * A component's children are live exactly when it is, so whatever moved the
     * parent — being added to a root, being hidden — moves them too. That is
     * what the engine did for free in the reference, where each node's `active`
     * flag carried the change down the scene graph.
     */
    public override checkEnabled(): boolean {
        const changed = super.checkEnabled();
        if (changed) {
            for (const child of this._children)
                child.checkEnabled();
        }
        return changed;
    }

    protected onEnable(): void {
        for (const t of this._transitions)
            t.onEnable();
    }

    protected onDisable(): void {
        for (const t of this._transitions)
            t.onDisable();
    }

    public dispose(): void {
        for (const t of this._transitions)
            t.dispose();
        this._transitions.length = 0;

        for (const c of this._controllers)
            c.dispose();
        this._controllers.length = 0;

        this._scrollPane?.destroy();
        this._scrollPane = null;

        for (let i = this._children.length - 1; i >= 0; --i) {
            const obj = this._children[i];
            obj._parent = null; // avoid a removeFromParent call during teardown
            obj.dispose();
        }
        this._children.length = 0;

        this._boundsChanged = false;
        super.dispose();
    }
}

function isMaskable(obj: GObject): boolean {
    // Only image- and graph-shaped objects have a silhouette the backend can
    // rasterise into a stencil.
    return obj.isShapeMask;
}
