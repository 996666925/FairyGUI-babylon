import { RelationType } from './FieldTypes.js';
import { EventType } from './event/Event.js';
import type { Event } from './event/Event.js';
import type { GObject } from './GObject.js';
import type { Relations } from './Relations.js';

/** One configured relation between an owner and a target. */
export class RelationDef {
    public percent = false;
    public type = 0;
    /** `0` for the horizontal axis, `1` for vertical. */
    public axis = 0;

    public copyFrom(source: RelationDef): void {
        this.percent = source.percent;
        this.type = source.type;
        this.axis = source.axis;
    }
}

function hasHorizontalAxis(relationType: number): boolean {
    return relationType <= RelationType.Right_Right
        || relationType === RelationType.Width
        || (relationType >= RelationType.LeftExt_Left && relationType <= RelationType.RightExt_Right);
}

/**
 * All relation definitions between one owner and one target.
 *
 * Listens to the target's coordinate and size events and adjusts the owner to
 * keep the configured edges aligned. `Relations.handling` guards against the
 * owner's own adjustment feeding back as a new target change.
 */
export class RelationItem {
    private _owner: GObject;
    private _target: GObject | null = null;
    private _defs: RelationDef[] = [];
    private _targetX = 0;
    private _targetY = 0;
    private _targetWidth = 0;
    private _targetHeight = 0;

    public constructor(owner: GObject) {
        this._owner = owner;
    }

    public get owner(): GObject {
        return this._owner;
    }

    public get target(): GObject | null {
        return this._target;
    }

    public set target(value: GObject | null) {
        if (this._target === value)
            return;
        if (this._target)
            this.releaseRefTarget(this._target);
        this._target = value;
        if (this._target)
            this.addRefTarget(this._target);
    }

    public add(relationType: number, usePercent = false): void {
        if (relationType === RelationType.Size) {
            this.add(RelationType.Width, usePercent);
            this.add(RelationType.Height, usePercent);
            return;
        }
        // Adding a relation that already exists is a no-op.
        for (const def of this._defs) {
            if (def.type === relationType)
                return;
        }
        this.internalAdd(relationType, usePercent);
    }

    /** Like `add`, but permits duplicates — used when decoding package data. */
    public internalAdd(relationType: number, usePercent = false): void {
        if (relationType === RelationType.Size) {
            this.internalAdd(RelationType.Width, usePercent);
            this.internalAdd(RelationType.Height, usePercent);
            return;
        }

        const info = new RelationDef();
        info.percent = usePercent;
        info.type = relationType;
        info.axis = hasHorizontalAxis(relationType) ? 0 : 1;
        this._defs.push(info);
    }

    public remove(relationType: number): void {
        if (relationType === RelationType.Size) {
            this.remove(RelationType.Width);
            this.remove(RelationType.Height);
            return;
        }
        for (let i = 0; i < this._defs.length; i++) {
            if (this._defs[i].type === relationType) {
                this._defs.splice(i, 1);
                break;
            }
        }
    }

    public copyFrom(source: RelationItem): void {
        this.target = source.target;

        this._defs.length = 0;
        for (const src of source._defs) {
            const info = new RelationDef();
            info.copyFrom(src);
            this._defs.push(info);
        }
    }

    public dispose(): void {
        if (this._target) {
            this.releaseRefTarget(this._target);
            this._target = null;
        }
        this._defs.length = 0;
    }

    public get isEmpty(): boolean {
        return this._defs.length === 0;
    }

    /**
     * Nudges the owner to compensate for its own resize, for the relations whose
     * meaning is "keep this edge where it was".
     */
    public applyOnSelfResized(dWidth: number, dHeight: number, applyPivot: boolean): void {
        const ox = this._owner.x;
        const oy = this._owner.y;

        for (const info of this._defs) {
            switch (info.type) {
                case RelationType.Center_Center:
                    this._owner.x -= (0.5 - (applyPivot ? this._owner.pivotX : 0)) * dWidth;
                    break;
                case RelationType.Right_Center:
                case RelationType.Right_Left:
                case RelationType.Right_Right:
                    this._owner.x -= (1 - (applyPivot ? this._owner.pivotX : 0)) * dWidth;
                    break;

                case RelationType.Middle_Middle:
                    this._owner.y -= (0.5 - (applyPivot ? this._owner.pivotY : 0)) * dHeight;
                    break;
                case RelationType.Bottom_Middle:
                case RelationType.Bottom_Top:
                case RelationType.Bottom_Bottom:
                    this._owner.y -= (1 - (applyPivot ? this._owner.pivotY : 0)) * dHeight;
                    break;
            }
        }

        this.reportOffset(ox, oy);
    }

    /** Feeds a position delta back into gears and the parent's transitions. */
    private reportOffset(ox: number, oy: number): void {
        if (ox === this._owner.x && oy === this._owner.y)
            return;

        const dx = this._owner.x - ox;
        const dy = this._owner.y - oy;

        this._owner.updateGearFromRelations(1, dx, dy);

        const transitions = this._owner.parent?._transitions;
        if (transitions && transitions.length > 0) {
            for (const t of transitions)
                t.updateFromRelations(this._owner.id, dx, dy);
        }
    }

    private applyOnXYChanged(info: RelationDef, dx: number, dy: number): void {
        let tmp: number;

        switch (info.type) {
            case RelationType.Left_Left:
            case RelationType.Left_Center:
            case RelationType.Left_Right:
            case RelationType.Center_Center:
            case RelationType.Right_Left:
            case RelationType.Right_Center:
            case RelationType.Right_Right:
                this._owner.x += dx;
                break;

            case RelationType.Top_Top:
            case RelationType.Top_Middle:
            case RelationType.Top_Bottom:
            case RelationType.Middle_Middle:
            case RelationType.Bottom_Top:
            case RelationType.Bottom_Middle:
            case RelationType.Bottom_Bottom:
                this._owner.y += dy;
                break;

            case RelationType.Width:
            case RelationType.Height:
                break;

            case RelationType.LeftExt_Left:
            case RelationType.LeftExt_Right:
                if (this._owner !== this._target!.parent) {
                    tmp = this._owner.xMin;
                    this._owner.width = this._owner._rawWidth - dx;
                    this._owner.xMin = tmp + dx;
                } else {
                    this._owner.width = this._owner._rawWidth - dx;
                }
                break;

            case RelationType.RightExt_Left:
            case RelationType.RightExt_Right:
                if (this._owner !== this._target!.parent) {
                    tmp = this._owner.xMin;
                    this._owner.width = this._owner._rawWidth + dx;
                    this._owner.xMin = tmp;
                } else {
                    this._owner.width = this._owner._rawWidth + dx;
                }
                break;

            case RelationType.TopExt_Top:
            case RelationType.TopExt_Bottom:
                if (this._owner !== this._target!.parent) {
                    tmp = this._owner.yMin;
                    this._owner.height = this._owner._rawHeight - dy;
                    this._owner.yMin = tmp + dy;
                } else {
                    this._owner.height = this._owner._rawHeight - dy;
                }
                break;

            case RelationType.BottomExt_Top:
            case RelationType.BottomExt_Bottom:
                if (this._owner !== this._target!.parent) {
                    tmp = this._owner.yMin;
                    this._owner.height = this._owner._rawHeight + dy;
                    this._owner.yMin = tmp;
                } else {
                    this._owner.height = this._owner._rawHeight + dy;
                }
                break;
        }
    }

    private applyOnSizeChanged(info: RelationDef): void {
        const target = this._target!;
        let pos = 0;
        let pivot = 0;
        // Stays 0 when a percentage relation has no previous extent to divide
        // by, which zeroes the adjustment rather than leaving it unchanged.
        let delta = 0;
        let v: number;
        let tmp: number;

        if (info.axis === 0) {
            if (target !== this._owner.parent) {
                pos = target.x;
                if (target.pivotAsAnchor)
                    pivot = target.pivotX;
            }
            if (info.percent) {
                if (this._targetWidth !== 0)
                    delta = target._width / this._targetWidth;
            } else {
                delta = target._width - this._targetWidth;
            }
        } else {
            if (target !== this._owner.parent) {
                pos = target.y;
                if (target.pivotAsAnchor)
                    pivot = target.pivotY;
            }
            if (info.percent) {
                if (this._targetHeight !== 0)
                    delta = target._height / this._targetHeight;
            } else {
                delta = target._height - this._targetHeight;
            }
        }

        switch (info.type) {
            case RelationType.Left_Left:
                if (info.percent)
                    this._owner.xMin = pos + (this._owner.xMin - pos) * delta;
                else if (pivot !== 0)
                    this._owner.x += delta * -pivot;
                break;
            case RelationType.Left_Center:
                if (info.percent)
                    this._owner.xMin = pos + (this._owner.xMin - pos) * delta;
                else
                    this._owner.x += delta * (0.5 - pivot);
                break;
            case RelationType.Left_Right:
                if (info.percent)
                    this._owner.xMin = pos + (this._owner.xMin - pos) * delta;
                else
                    this._owner.x += delta * (1 - pivot);
                break;
            case RelationType.Center_Center:
                if (info.percent)
                    this._owner.xMin = pos + (this._owner.xMin + this._owner._rawWidth * 0.5 - pos) * delta - this._owner._rawWidth * 0.5;
                else
                    this._owner.x += delta * (0.5 - pivot);
                break;
            case RelationType.Right_Left:
                if (info.percent)
                    this._owner.xMin = pos + (this._owner.xMin + this._owner._rawWidth - pos) * delta - this._owner._rawWidth;
                else if (pivot !== 0)
                    this._owner.x += delta * -pivot;
                break;
            case RelationType.Right_Center:
                if (info.percent)
                    this._owner.xMin = pos + (this._owner.xMin + this._owner._rawWidth - pos) * delta - this._owner._rawWidth;
                else
                    this._owner.x += delta * (0.5 - pivot);
                break;
            case RelationType.Right_Right:
                if (info.percent)
                    this._owner.xMin = pos + (this._owner.xMin + this._owner._rawWidth - pos) * delta - this._owner._rawWidth;
                else
                    this._owner.x += delta * (1 - pivot);
                break;

            case RelationType.Top_Top:
                if (info.percent)
                    this._owner.yMin = pos + (this._owner.yMin - pos) * delta;
                else if (pivot !== 0)
                    this._owner.y += delta * -pivot;
                break;
            case RelationType.Top_Middle:
                if (info.percent)
                    this._owner.yMin = pos + (this._owner.yMin - pos) * delta;
                else
                    this._owner.y += delta * (0.5 - pivot);
                break;
            case RelationType.Top_Bottom:
                if (info.percent)
                    this._owner.yMin = pos + (this._owner.yMin - pos) * delta;
                else
                    this._owner.y += delta * (1 - pivot);
                break;
            case RelationType.Middle_Middle:
                if (info.percent)
                    this._owner.yMin = pos + (this._owner.yMin + this._owner._rawHeight * 0.5 - pos) * delta - this._owner._rawHeight * 0.5;
                else
                    this._owner.y += delta * (0.5 - pivot);
                break;
            case RelationType.Bottom_Top:
                if (info.percent)
                    this._owner.yMin = pos + (this._owner.yMin + this._owner._rawHeight - pos) * delta - this._owner._rawHeight;
                else if (pivot !== 0)
                    this._owner.y += delta * -pivot;
                break;
            case RelationType.Bottom_Middle:
                if (info.percent)
                    this._owner.yMin = pos + (this._owner.yMin + this._owner._rawHeight - pos) * delta - this._owner._rawHeight;
                else
                    this._owner.y += delta * (0.5 - pivot);
                break;
            case RelationType.Bottom_Bottom:
                if (info.percent)
                    this._owner.yMin = pos + (this._owner.yMin + this._owner._rawHeight - pos) * delta - this._owner._rawHeight;
                else
                    this._owner.y += delta * (1 - pivot);
                break;

            case RelationType.Width:
                if (this._owner._underConstruct && this._owner === target.parent)
                    v = this._owner.sourceWidth - target.initWidth;
                else
                    v = this._owner._rawWidth - this._targetWidth;
                if (info.percent)
                    v = v * delta;
                if (target === this._owner.parent) {
                    if (this._owner.pivotAsAnchor) {
                        tmp = this._owner.xMin;
                        this._owner.setSize(target._width + v, this._owner._rawHeight, true);
                        this._owner.xMin = tmp;
                    } else {
                        this._owner.setSize(target._width + v, this._owner._rawHeight, true);
                    }
                } else {
                    this._owner.width = target._width + v;
                }
                break;

            case RelationType.Height:
                if (this._owner._underConstruct && this._owner === target.parent)
                    v = this._owner.sourceHeight - target.initHeight;
                else
                    v = this._owner._rawHeight - this._targetHeight;
                if (info.percent)
                    v = v * delta;
                if (target === this._owner.parent) {
                    if (this._owner.pivotAsAnchor) {
                        tmp = this._owner.yMin;
                        this._owner.setSize(this._owner._rawWidth, target._height + v, true);
                        this._owner.yMin = tmp;
                    } else {
                        this._owner.setSize(this._owner._rawWidth, target._height + v, true);
                    }
                } else {
                    this._owner.height = target._height + v;
                }
                break;

            case RelationType.LeftExt_Left:
                tmp = this._owner.xMin;
                v = info.percent ? pos + (tmp - pos) * delta - tmp : delta * -pivot;
                this._owner.width = this._owner._rawWidth - v;
                this._owner.xMin = tmp + v;
                break;
            case RelationType.LeftExt_Right:
                tmp = this._owner.xMin;
                v = info.percent ? pos + (tmp - pos) * delta - tmp : delta * (1 - pivot);
                this._owner.width = this._owner._rawWidth - v;
                this._owner.xMin = tmp + v;
                break;
            case RelationType.RightExt_Left:
                tmp = this._owner.xMin;
                v = info.percent
                    ? pos + (tmp + this._owner._rawWidth - pos) * delta - (tmp + this._owner._rawWidth)
                    : delta * -pivot;
                this._owner.width = this._owner._rawWidth + v;
                this._owner.xMin = tmp;
                break;
            case RelationType.RightExt_Right:
                tmp = this._owner.xMin;
                if (info.percent) {
                    if (this._owner === target.parent) {
                        if (this._owner._underConstruct) {
                            this._owner.width = pos + target._width - target._width * pivot
                                + (this._owner.sourceWidth - pos - target.initWidth + target.initWidth * pivot) * delta;
                        } else {
                            this._owner.width = pos + (this._owner._rawWidth - pos) * delta;
                        }
                    } else {
                        v = pos + (tmp + this._owner._rawWidth - pos) * delta - (tmp + this._owner._rawWidth);
                        this._owner.width = this._owner._rawWidth + v;
                        this._owner.xMin = tmp;
                    }
                } else {
                    if (this._owner === target.parent) {
                        if (this._owner._underConstruct)
                            this._owner.width = this._owner.sourceWidth + (target._width - target.initWidth) * (1 - pivot);
                        else
                            this._owner.width = this._owner._rawWidth + delta * (1 - pivot);
                    } else {
                        v = delta * (1 - pivot);
                        this._owner.width = this._owner._rawWidth + v;
                        this._owner.xMin = tmp;
                    }
                }
                break;

            case RelationType.TopExt_Top:
                tmp = this._owner.yMin;
                v = info.percent ? pos + (tmp - pos) * delta - tmp : delta * -pivot;
                this._owner.height = this._owner._rawHeight - v;
                this._owner.yMin = tmp + v;
                break;
            case RelationType.TopExt_Bottom:
                tmp = this._owner.yMin;
                v = info.percent ? pos + (tmp - pos) * delta - tmp : delta * (1 - pivot);
                this._owner.height = this._owner._rawHeight - v;
                this._owner.yMin = tmp + v;
                break;
            case RelationType.BottomExt_Top:
                tmp = this._owner.yMin;
                v = info.percent
                    ? pos + (tmp + this._owner._rawHeight - pos) * delta - (tmp + this._owner._rawHeight)
                    : delta * -pivot;
                this._owner.height = this._owner._rawHeight + v;
                this._owner.yMin = tmp;
                break;
            case RelationType.BottomExt_Bottom:
                tmp = this._owner.yMin;
                if (info.percent) {
                    if (this._owner === target.parent) {
                        if (this._owner._underConstruct) {
                            this._owner.height = pos + target._height - target._height * pivot
                                + (this._owner.sourceHeight - pos - target.initHeight + target.initHeight * pivot) * delta;
                        } else {
                            this._owner.height = pos + (this._owner._rawHeight - pos) * delta;
                        }
                    } else {
                        v = pos + (tmp + this._owner._rawHeight - pos) * delta - (tmp + this._owner._rawHeight);
                        this._owner.height = this._owner._rawHeight + v;
                        this._owner.yMin = tmp;
                    }
                } else {
                    if (this._owner === target.parent) {
                        if (this._owner._underConstruct)
                            this._owner.height = this._owner.sourceHeight + (target._height - target.initHeight) * (1 - pivot);
                        else
                            this._owner.height = this._owner._rawHeight + delta * (1 - pivot);
                    } else {
                        v = delta * (1 - pivot);
                        this._owner.height = this._owner._rawHeight + v;
                        this._owner.yMin = tmp;
                    }
                }
                break;
        }
    }

    private addRefTarget(target: GObject): void {
        // The parent's own movement is already covered by the size relations,
        // so only non-parent targets need coordinate tracking.
        if (target !== this._owner.parent)
            target.on(EventType.XY_CHANGED, this.__targetXYChanged, this);
        target.on(EventType.SIZE_CHANGED, this.__targetSizeChanged, this);
        target.on(EventType.SIZE_DELAY_CHANGE, this.__targetSizeWillChange, this);

        this._targetX = target.x;
        this._targetY = target.y;
        this._targetWidth = target._width;
        this._targetHeight = target._height;
    }

    private releaseRefTarget(target: GObject): void {
        if (target.disposed)
            return;
        target.off(EventType.XY_CHANGED, this.__targetXYChanged, this);
        target.off(EventType.SIZE_CHANGED, this.__targetSizeChanged, this);
        target.off(EventType.SIZE_DELAY_CHANGE, this.__targetSizeWillChange, this);
    }

    private __targetXYChanged = (_evt: Event): void => {
        const relations: Relations = this._owner.relations;
        if (relations.handling != null || (this._owner.group && this._owner.group._updating)) {
            this._targetX = this._target!.x;
            this._targetY = this._target!.y;
            return;
        }

        relations.handling = this._target;

        const ox = this._owner.x;
        const oy = this._owner.y;
        const dx = this._target!.x - this._targetX;
        const dy = this._target!.y - this._targetY;

        for (const info of this._defs)
            this.applyOnXYChanged(info, dx, dy);

        this._targetX = this._target!.x;
        this._targetY = this._target!.y;
        this.reportOffset(ox, oy);

        relations.handling = null;
    };

    private __targetSizeChanged = (_evt: Event): void => {
        if (this._owner.relations.handling != null)
            return;

        const relations = this._owner.relations;
        relations.handling = this._target;

        const ox = this._owner.x;
        const oy = this._owner.y;
        const ow = this._owner._rawWidth;
        const oh = this._owner._rawHeight;

        for (const info of this._defs)
            this.applyOnSizeChanged(info);

        this._targetWidth = this._target!._width;
        this._targetHeight = this._target!._height;

        this.reportOffset(ox, oy);

        if (ow !== this._owner._rawWidth || oh !== this._owner._rawHeight)
            this._owner.updateGearFromRelations(2, this._owner._rawWidth - ow, this._owner._rawHeight - oh);

        relations.handling = null;
    };

    private __targetSizeWillChange = (_evt: Event): void => {
        this._owner.relations.sizeDirty = true;
    };
}
