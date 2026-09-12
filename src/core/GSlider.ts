import { GComponent } from './GComponent.js';
import { GObject } from './GObject.js';
import { ProgressTitleType } from './FieldTypes.js';
import { ToolSet } from './utils/ToolSet.js';
import { EventType } from './event/Event.js';
import { Point } from './utils/Geometry.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { Event } from './event/Event.js';

/** Scratch for pointer-to-local conversions, so dragging allocates nothing. */
const sVec2 = new Point();

/**
 * A drag slider.
 *
 * `bar`/`bar_v` is the filled track and `grip` is the handle: dragging the grip
 * moves the value, and — when `changeOnClick` is on — a click on the track
 * jumps the grip to the pointer. Unlike `GProgressBar` the bar is always sized
 * rather than filled, because the grip has to travel along it.
 */
export class GSlider extends GComponent {
    private _min = 0;
    private _max = 100;
    private _value = 50;
    private _titleType: ProgressTitleType = ProgressTitleType.Percent;
    private _reverse = false;
    private _wholeNumbers = false;

    private _titleObject: GObject | null = null;
    private _barObjectH: GObject | null = null;
    private _barObjectV: GObject | null = null;
    private _barMaxWidth = 0;
    private _barMaxHeight = 0;
    private _barMaxWidthDelta = 0;
    private _barMaxHeightDelta = 0;
    private _gripObject: GObject | null = null;
    private _clickPos = new Point();
    private _clickPercent = 0;
    private _barStartX = 0;
    private _barStartY = 0;

    /** Whether a click on the track moves the grip. */
    public changeOnClick = true;
    /** Whether the grip can be dragged. */
    public canDrag = true;

    public get titleType(): ProgressTitleType {
        return this._titleType;
    }

    public set titleType(value: ProgressTitleType) {
        if (this._titleType === value)
            return;
        this._titleType = value;
        // The Cocos reference stored the new type without refreshing, so the
        // title kept its old format until some unrelated change forced a
        // redraw. `GProgressBar` refreshes here; this now matches it.
        this.update();
    }

    public get wholeNumbers(): boolean {
        return this._wholeNumbers;
    }

    public set wholeNumbers(value: boolean) {
        if (this._wholeNumbers !== value) {
            this._wholeNumbers = value;
            this.update();
        }
    }

    public get min(): number {
        return this._min;
    }

    public set min(value: number) {
        if (this._min !== value) {
            this._min = value;
            this.update();
        }
    }

    public get max(): number {
        return this._max;
    }

    public set max(value: number) {
        if (this._max !== value) {
            this._max = value;
            this.update();
        }
    }

    public get value(): number {
        return this._value;
    }

    public set value(value: number) {
        if (this._value !== value) {
            this._value = value;
            this.update();
        }
    }

    public update(): void {
        this.updateWithPercent((this._value - this._min) / (this._max - this._min));
    }

    private updateWithPercent(percent: number, manual = false): void {
        percent = ToolSet.clamp01(percent);
        if (manual) {
            let newValue = ToolSet.clamp(this._min + (this._max - this._min) * percent, this._min, this._max);
            if (this._wholeNumbers) {
                newValue = Math.round(newValue);
                percent = ToolSet.clamp01((newValue - this._min) / (this._max - this._min));
            }

            if (newValue !== this._value) {
                this._value = newValue;
                this.emit(EventType.STATUS_CHANGED, this);
            }
        }

        if (this._titleObject) {
            switch (this._titleType) {
                case ProgressTitleType.Percent:
                    this._titleObject.text = Math.floor(percent * 100) + '%';
                    break;

                case ProgressTitleType.ValueAndMax:
                    this._titleObject.text = this._value + '/' + this._max;
                    break;

                case ProgressTitleType.Value:
                    this._titleObject.text = '' + this._value;
                    break;

                case ProgressTitleType.Max:
                    this._titleObject.text = '' + this._max;
                    break;
            }
        }

        const fullWidth = this.width - this._barMaxWidthDelta;
        const fullHeight = this.height - this._barMaxHeightDelta;
        if (!this._reverse) {
            if (this._barObjectH)
                this._barObjectH.width = Math.round(fullWidth * percent);
            if (this._barObjectV)
                this._barObjectV.height = Math.round(fullHeight * percent);
        } else {
            if (this._barObjectH) {
                this._barObjectH.width = Math.round(fullWidth * percent);
                this._barObjectH.x = this._barStartX + (fullWidth - this._barObjectH.width);
            }
            if (this._barObjectV) {
                this._barObjectV.height = Math.round(fullHeight * percent);
                this._barObjectV.y = this._barStartY + (fullHeight - this._barObjectV.height);
            }
        }
    }

    protected constructExtension(buffer: ByteBuffer): void {
        buffer.seek(0, 6);

        this._titleType = buffer.readByte();
        this._reverse = buffer.readBool();
        if (buffer.version >= 2) {
            this._wholeNumbers = buffer.readBool();
            this.changeOnClick = buffer.readBool();
        }

        this._titleObject = this.getChild('title');
        this._barObjectH = this.getChild('bar');
        this._barObjectV = this.getChild('bar_v');
        this._gripObject = this.getChild('grip');

        if (this._barObjectH) {
            this._barMaxWidth = this._barObjectH.width;
            this._barMaxWidthDelta = this.width - this._barMaxWidth;
            this._barStartX = this._barObjectH.x;
        }
        if (this._barObjectV) {
            this._barMaxHeight = this._barObjectV.height;
            this._barMaxHeightDelta = this.height - this._barMaxHeight;
            this._barStartY = this._barObjectV.y;
        }
        if (this._gripObject) {
            this._gripObject.on(EventType.TOUCH_BEGIN, this.onGripTouchBegin, this);
            this._gripObject.on(EventType.TOUCH_MOVE, this.onGripTouchMove, this);
        }

        this.on(EventType.TOUCH_BEGIN, this.onBarTouchBegin, this);
    }

    protected handleSizeChanged(): void {
        super.handleSizeChanged();

        if (this._barObjectH)
            this._barMaxWidth = this.width - this._barMaxWidthDelta;
        if (this._barObjectV)
            this._barMaxHeight = this.height - this._barMaxHeightDelta;
        if (!this._underConstruct)
            this.update();
    }

    public setup_afterAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_afterAdd(buffer, beginPos);

        if (!buffer.seek(beginPos, 6)) {
            this.update();
            return;
        }

        if (buffer.readByte() !== (this.packageItem!.objectType as number)) {
            this.update();
            return;
        }

        this._value = buffer.readInt();
        this._max = buffer.readInt();
        if (buffer.version >= 2)
            this._min = buffer.readInt();

        this.update();
    }

    private onGripTouchBegin(evt: Event): void {
        this.canDrag = true;
        evt.stopPropagation();
        evt.captureTouch();

        this._clickPos = this.globalToLocal(evt.pos.x, evt.pos.y);
        this._clickPercent = ToolSet.clamp01((this._value - this._min) / (this._max - this._min));
    }

    private onGripTouchMove(evt: Event): void {
        if (!this.canDrag)
            return;

        const pt = this.globalToLocal(evt.pos.x, evt.pos.y, sVec2);
        let deltaX = pt.x - this._clickPos.x;
        let deltaY = pt.y - this._clickPos.y;
        if (this._reverse) {
            deltaX = -deltaX;
            deltaY = -deltaY;
        }

        let percent: number;
        if (this._barObjectH)
            percent = this._clickPercent + deltaX / this._barMaxWidth;
        else
            percent = this._clickPercent + deltaY / this._barMaxHeight;
        this.updateWithPercent(percent, true);
    }

    private onBarTouchBegin(evt: Event): void {
        if (!this.changeOnClick)
            return;

        // The reference dereferenced the grip unconditionally here; a slider
        // published without one would throw on any click, so it is skipped.
        if (!this._gripObject)
            return;

        const pt = this._gripObject.globalToLocal(evt.pos.x, evt.pos.y, sVec2);
        let percent = ToolSet.clamp01((this._value - this._min) / (this._max - this._min));
        let delta = 0;
        if (this._barObjectH != null)
            delta = (pt.x - this._gripObject.width / 2) / this._barMaxWidth;
        if (this._barObjectV != null)
            delta = (pt.y - this._gripObject.height / 2) / this._barMaxHeight;
        if (this._reverse)
            percent -= delta;
        else
            percent += delta;
        this.updateWithPercent(percent, true);
    }
}
