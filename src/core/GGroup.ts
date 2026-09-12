import { GObject } from './GObject.js';
import { GroupLayoutType } from './FieldTypes.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';

/**
 * A layout group.
 *
 * A group is not a container: its members stay children of the enclosing
 * component and are linked to it by `GObject.group`. The group therefore has no
 * rendering of its own — it exists to lay its members out, to size itself to
 * their extent, and to propagate visibility and alpha down to them.
 */
export class GGroup extends GObject {
    private _layout: GroupLayoutType = GroupLayoutType.None;
    private _lineGap = 0;
    private _columnGap = 0;
    private _excludeInvisibles = false;
    private _autoSizeDisabled = false;
    private _mainGridIndex = -1;
    private _mainGridMinSize = 50;

    private _boundsChanged = false;
    private _percentReady = false;
    private _mainChildIndex = -1;
    private _totalSize = 0;
    private _numChildren = 0;

    /**
     * Re-entrancy guard. Bit 1 is set while positions are being written, bit 2
     * while sizes are — the reference's convention, kept so the guarded
     * branches read the same.
     */
    public _updating = 0;

    public constructor() {
        super();
        this._touchDisabled = true;
    }

    public get layout(): GroupLayoutType {
        return this._layout;
    }

    public set layout(value: GroupLayoutType) {
        if (this._layout !== value) {
            this._layout = value;
            this.setBoundsChangedFlag();
        }
    }

    public get lineGap(): number {
        return this._lineGap;
    }

    public set lineGap(value: number) {
        if (this._lineGap !== value) {
            this._lineGap = value;
            this.setBoundsChangedFlag(true);
        }
    }

    public get columnGap(): number {
        return this._columnGap;
    }

    public set columnGap(value: number) {
        if (this._columnGap !== value) {
            this._columnGap = value;
            this.setBoundsChangedFlag(true);
        }
    }

    public get excludeInvisibles(): boolean {
        return this._excludeInvisibles;
    }

    public set excludeInvisibles(value: boolean) {
        if (this._excludeInvisibles !== value) {
            this._excludeInvisibles = value;
            this.setBoundsChangedFlag();
        }
    }

    public get autoSizeDisabled(): boolean {
        return this._autoSizeDisabled;
    }

    public set autoSizeDisabled(value: boolean) {
        this._autoSizeDisabled = value;
    }

    public get mainGridMinSize(): number {
        return this._mainGridMinSize;
    }

    public set mainGridMinSize(value: number) {
        if (this._mainGridMinSize !== value) {
            this._mainGridMinSize = value;
            this.setBoundsChangedFlag();
        }
    }

    public get mainGridIndex(): number {
        return this._mainGridIndex;
    }

    public set mainGridIndex(value: number) {
        if (this._mainGridIndex !== value) {
            this._mainGridIndex = value;
            this.setBoundsChangedFlag();
        }
    }

    /**
     * Marks the group's extent as stale.
     *
     * @param positionChangedOnly when true, members moved rather than resized,
     *   so their relative proportions are still valid.
     */
    public setBoundsChangedFlag(positionChangedOnly = false): void {
        if (this._updating !== 0 || !this._parent)
            return;

        if (!positionChangedOnly)
            this._percentReady = false;

        if (!this._boundsChanged) {
            this._boundsChanged = true;
            if (this._layout !== GroupLayoutType.None)
                this.callLater(() => this.ensureBoundsCorrect());
        }
    }

    public ensureSizeCorrect(): void {
        if (!this._parent || !this._boundsChanged || this._layout === GroupLayoutType.None)
            return;

        this._boundsChanged = false;
        if (this._autoSizeDisabled) {
            this.resizeChildren(0, 0);
        } else {
            this.handleLayout();
            this.updateBounds();
        }
    }

    public ensureBoundsCorrect(): void {
        if (!this._parent || !this._boundsChanged)
            return;

        this._boundsChanged = false;
        if (this._layout === GroupLayoutType.None) {
            this.updateBounds();
        } else if (this._autoSizeDisabled) {
            this.resizeChildren(0, 0);
        } else {
            this.handleLayout();
            this.updateBounds();
        }
    }

    /** Fits the group's own box around its members. */
    private updateBounds(): void {
        this.cancelCallLater();

        const parent = this._parent!;
        const cnt = parent.numChildren;
        let ax = Number.POSITIVE_INFINITY;
        let ay = Number.POSITIVE_INFINITY;
        let ar = Number.NEGATIVE_INFINITY;
        let ab = Number.NEGATIVE_INFINITY;
        let empty = true;

        for (let i = 0; i < cnt; i++) {
            const child = parent.getChildAt(i);
            if (child.group !== this || (this._excludeInvisibles && !child.internalVisible3))
                continue;

            if (child.xMin < ax)
                ax = child.xMin;
            if (child.yMin < ay)
                ay = child.yMin;
            if (child.xMin + child.width > ar)
                ar = child.xMin + child.width;
            if (child.yMin + child.height > ab)
                ab = child.yMin + child.height;
            empty = false;
        }

        let w = 0;
        let h = 0;
        if (!empty) {
            this._updating |= 1;
            this.setPosition(ax, ay);
            this._updating &= 2;

            w = ar - ax;
            h = ab - ay;
        }

        if ((this._updating & 2) === 0) {
            this._updating |= 2;
            this.setSize(w, h);
            this._updating &= 1;
        } else {
            this._updating &= 1;
            this.resizeChildren(this._width - w, this._height - h);
        }
    }

    /** Places members along the group's layout axis. */
    private handleLayout(): void {
        this._updating |= 1;

        const parent = this._parent!;
        const cnt = parent.numChildren;

        if (this._layout === GroupLayoutType.Horizontal) {
            let curX = this.x;
            for (let i = 0; i < cnt; i++) {
                const child = parent.getChildAt(i);
                if (child.group !== this)
                    continue;
                if (this._excludeInvisibles && !child.internalVisible3)
                    continue;

                child.xMin = curX;
                if (child.width !== 0)
                    curX += child.width + this._columnGap;
            }
        } else if (this._layout === GroupLayoutType.Vertical) {
            let curY = this.y;
            for (let i = 0; i < cnt; i++) {
                const child = parent.getChildAt(i);
                if (child.group !== this)
                    continue;
                if (this._excludeInvisibles && !child.internalVisible3)
                    continue;

                child.yMin = curY;
                if (child.height !== 0)
                    curY += child.height + this._lineGap;
            }
        }

        this._updating &= 2;
    }

    /** Called when the group itself moves; carries its members along. */
    protected onMoved(dx: number, dy: number): void {
        this.moveChildren(dx, dy);
    }

    /** Called when the group itself resizes; re-proportions its members. */
    protected onResized(dw: number, dh: number): void {
        this.resizeChildren(dw, dh);
    }

    public moveChildren(dx: number, dy: number): void {
        if ((this._updating & 1) !== 0 || !this._parent)
            return;

        this._updating |= 1;

        const parent = this._parent;
        const cnt = parent.numChildren;
        for (let i = 0; i < cnt; i++) {
            const child = parent.getChildAt(i);
            if (child.group === this)
                child.setPosition(child.x + dx, child.y + dy);
        }

        this._updating &= 2;
    }

    /**
     * Re-proportions members to absorb a size change.
     *
     * Members keep their share of the group's main axis, so growing the group
     * grows each member in proportion. One member may be designated the "main
     * grid" and held at `mainGridMinSize` while the rest take up the slack.
     */
    public resizeChildren(dw: number, dh: number): void {
        if (this._layout === GroupLayoutType.None || (this._updating & 2) !== 0 || !this._parent)
            return;

        this._updating |= 2;
        const parent = this._parent;

        if (this._boundsChanged) {
            this._boundsChanged = false;
            if (!this._autoSizeDisabled) {
                this.updateBounds();
                return;
            }
        }

        const cnt = parent.numChildren;

        if (!this._percentReady) {
            this._percentReady = true;
            this._numChildren = 0;
            this._totalSize = 0;
            this._mainChildIndex = -1;

            let j = 0;
            for (let i = 0; i < cnt; i++) {
                const child = parent.getChildAt(i);
                if (child.group !== this)
                    continue;

                if (!this._excludeInvisibles || child.internalVisible3) {
                    if (j === this._mainGridIndex)
                        this._mainChildIndex = i;

                    this._numChildren++;
                    this._totalSize += this._layout === GroupLayoutType.Horizontal
                        ? child.width
                        : child.height;
                }
                j++;
            }

            if (this._mainChildIndex !== -1) {
                const child = parent.getChildAt(this._mainChildIndex);
                const mainSize = this._layout === GroupLayoutType.Horizontal ? child.width : child.height;
                this._totalSize += this._mainGridMinSize - mainSize;
                child._sizePercentInGroup = this._mainGridMinSize / this._totalSize;
            }

            for (let i = 0; i < cnt; i++) {
                const child = parent.getChildAt(i);
                if (child.group !== this || i === this._mainChildIndex)
                    continue;

                child._sizePercentInGroup = this._totalSize > 0
                    ? (this._layout === GroupLayoutType.Horizontal ? child.width : child.height) / this._totalSize
                    : 0;
            }
        }

        let remainSize = 0;
        let remainPercent = 1;
        let priorHandled = false;

        if (this._layout === GroupLayoutType.Horizontal) {
            remainSize = this.width - (this._numChildren - 1) * this._columnGap;
            if (this._mainChildIndex !== -1 && remainSize >= this._totalSize) {
                const child = parent.getChildAt(this._mainChildIndex);
                child.setSize(remainSize - (this._totalSize - this._mainGridMinSize), child._rawHeight + dh, true);
                remainSize -= child.width;
                remainPercent -= child._sizePercentInGroup;
                priorHandled = true;
            }

            let curX = this.x;
            for (let i = 0; i < cnt; i++) {
                const child = parent.getChildAt(i);
                if (child.group !== this)
                    continue;

                if (this._excludeInvisibles && !child.internalVisible3) {
                    child.setSize(child._rawWidth, child._rawHeight + dh, true);
                    continue;
                }

                if (!priorHandled || i !== this._mainChildIndex) {
                    child.setSize(
                        Math.round(child._sizePercentInGroup / remainPercent * remainSize),
                        child._rawHeight + dh, true,
                    );
                    remainPercent -= child._sizePercentInGroup;
                    remainSize -= child.width;
                }

                child.xMin = curX;
                if (child.width !== 0)
                    curX += child.width + this._columnGap;
            }
        } else {
            remainSize = this.height - (this._numChildren - 1) * this._lineGap;
            if (this._mainChildIndex !== -1 && remainSize >= this._totalSize) {
                const child = parent.getChildAt(this._mainChildIndex);
                child.setSize(child._rawWidth + dw, remainSize - (this._totalSize - this._mainGridMinSize), true);
                remainSize -= child.height;
                remainPercent -= child._sizePercentInGroup;
                priorHandled = true;
            }

            let curY = this.y;
            for (let i = 0; i < cnt; i++) {
                const child = parent.getChildAt(i);
                if (child.group !== this)
                    continue;

                if (this._excludeInvisibles && !child.internalVisible3) {
                    child.setSize(child._rawWidth + dw, child._rawHeight, true);
                    continue;
                }

                if (!priorHandled || i !== this._mainChildIndex) {
                    child.setSize(
                        child._rawWidth + dw,
                        Math.round(child._sizePercentInGroup / remainPercent * remainSize), true,
                    );
                    remainPercent -= child._sizePercentInGroup;
                    remainSize -= child.height;
                }

                child.yMin = curY;
                if (child.height !== 0)
                    curY += child.height + this._lineGap;
            }
        }

        this._updating &= 1;
    }

    protected handleAlphaChanged(): void {
        if (this._underConstruct || !this._parent)
            return;

        const parent = this._parent;
        const cnt = parent.numChildren;
        for (let i = 0; i < cnt; i++) {
            const child = parent.getChildAt(i);
            if (child.group === this)
                child.alpha = this.alpha;
        }
    }

    public handleVisibleChanged(): void {
        // The base implementation keeps this node's own `visible` truthful.
        // A group draws nothing and owns no children in the render tree, so
        // this is free — and it keeps `_finalVisible` consistent for hit
        // testing and for the members below.
        super.handleVisibleChanged();

        if (!this._parent)
            return;

        const parent = this._parent;
        const cnt = parent.numChildren;
        for (let i = 0; i < cnt; i++) {
            const child = parent.getChildAt(i);
            if (child.group === this)
                child.handleVisibleChanged();
        }
    }

    public setup_beforeAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_beforeAdd(buffer, beginPos);

        buffer.seek(beginPos, 5);

        this._layout = buffer.readByte();
        this._lineGap = buffer.readInt();
        this._columnGap = buffer.readInt();
        if (buffer.version >= 2) {
            this._excludeInvisibles = buffer.readBool();
            this._autoSizeDisabled = buffer.readBool();
            this._mainGridIndex = buffer.readShort();
        }
    }

    public setup_afterAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_afterAdd(buffer, beginPos);

        if (!this.visible)
            this.handleVisibleChanged();
    }
}
