import { GComponent } from './GComponent.js';
import { GObject } from './GObject.js';
import { FillMethod, ObjectPropID, ProgressTitleType } from './FieldTypes.js';
import { ToolSet } from './utils/ToolSet.js';
import { GTween } from './tween/GTween.js';
import { EaseType } from './tween/EaseType.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { GTweener } from './tween/GTweener.js';

/**
 * A progress bar.
 *
 * The bar is an ordinary child named `bar` (horizontal) or `bar_v` (vertical);
 * its size is driven from the value, unless the child can fill itself — an
 * image with a `FillMethod` — in which case the fill amount is animated and the
 * child's box is left alone. A child named `title` shows the value in one of
 * four formats, and `ani` is stepped through like a flipbook.
 */
export class GProgressBar extends GComponent {
    private _min = 0;
    private _max = 100;
    private _value = 50;
    private _titleType: ProgressTitleType = ProgressTitleType.Percent;
    private _reverse = false;

    private _titleObject: GObject | null = null;
    private _aniObject: GObject | null = null;
    private _barObjectH: GObject | null = null;
    private _barObjectV: GObject | null = null;
    private _barMaxWidth = 0;
    private _barMaxHeight = 0;
    private _barMaxWidthDelta = 0;
    private _barMaxHeightDelta = 0;
    private _barStartX = 0;
    private _barStartY = 0;

    public get titleType(): ProgressTitleType {
        return this._titleType;
    }

    public set titleType(value: ProgressTitleType) {
        if (this._titleType !== value) {
            this._titleType = value;
            this.update(this._value);
        }
    }

    public get min(): number {
        return this._min;
    }

    public set min(value: number) {
        if (this._min !== value) {
            this._min = value;
            this.update(this._value);
        }
    }

    public get max(): number {
        return this._max;
    }

    public set max(value: number) {
        if (this._max !== value) {
            this._max = value;
            this.update(this._value);
        }
    }

    public get value(): number {
        return this._value;
    }

    public set value(value: number) {
        if (this._value !== value) {
            GTween.kill(this, false, this.update);

            this._value = value;
            this.update(value);
        }
    }

    /** Animates the value to `value` over `duration` seconds. */
    public tweenValue(value: number, duration: number): GTweener {
        let oldValue: number;

        const tweener = GTween.getTween(this, this.update);
        if (tweener) {
            oldValue = tweener.value.x;
            tweener.kill();
        } else
            oldValue = this._value;

        this._value = value;
        return GTween.to(oldValue, this._value, duration).setTarget(this, this.update).setEase(EaseType.Linear);
    }

    public update(newValue: number): void {
        const percent = ToolSet.clamp01((newValue - this._min) / (this._max - this._min));
        if (this._titleObject) {
            switch (this._titleType) {
                case ProgressTitleType.Percent:
                    this._titleObject.text = Math.floor(percent * 100) + '%';
                    break;

                case ProgressTitleType.ValueAndMax:
                    this._titleObject.text = Math.floor(newValue) + '/' + Math.floor(this._max);
                    break;

                case ProgressTitleType.Value:
                    this._titleObject.text = '' + Math.floor(newValue);
                    break;

                case ProgressTitleType.Max:
                    this._titleObject.text = '' + Math.floor(this._max);
                    break;
            }
        }

        const fullWidth = this.width - this._barMaxWidthDelta;
        const fullHeight = this.height - this._barMaxHeightDelta;
        if (!this._reverse) {
            if (this._barObjectH) {
                if (!this.setFillAmount(this._barObjectH, percent))
                    this._barObjectH.width = Math.round(fullWidth * percent);
            }
            if (this._barObjectV) {
                if (!this.setFillAmount(this._barObjectV, percent))
                    this._barObjectV.height = Math.round(fullHeight * percent);
            }
        } else {
            if (this._barObjectH) {
                if (!this.setFillAmount(this._barObjectH, 1 - percent)) {
                    this._barObjectH.width = Math.round(fullWidth * percent);
                    this._barObjectH.x = this._barStartX + (fullWidth - this._barObjectH.width);
                }
            }
            if (this._barObjectV) {
                if (!this.setFillAmount(this._barObjectV, 1 - percent)) {
                    this._barObjectV.height = Math.round(fullHeight * percent);
                    this._barObjectV.y = this._barStartY + (fullHeight - this._barObjectV.height);
                }
            }
        }
        if (this._aniObject)
            this._aniObject.setProp(ObjectPropID.Frame, Math.floor(percent * 100));
    }

    /**
     * Fills `bar` through `fillMethod`/`fillAmount` if it supports them.
     *
     * The reference tested `bar instanceof GImage || bar instanceof GLoader`;
     * `GLoader` belongs to another module, so the capability is probed directly
     * — only an image-shaped widget declares `fillMethod`.
     */
    private setFillAmount(bar: GObject, percent: number): boolean {
        const fillable = bar as unknown as { fillMethod?: FillMethod; fillAmount?: number };
        if (typeof fillable.fillMethod === 'number' && fillable.fillMethod !== FillMethod.None) {
            fillable.fillAmount = percent;
            return true;
        }
        return false;
    }

    protected constructExtension(buffer: ByteBuffer): void {
        buffer.seek(0, 6);

        this._titleType = buffer.readByte();
        this._reverse = buffer.readBool();

        this._titleObject = this.getChild('title');
        this._barObjectH = this.getChild('bar');
        this._barObjectV = this.getChild('bar_v');
        this._aniObject = this.getChild('ani');

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
    }

    protected handleSizeChanged(): void {
        super.handleSizeChanged();

        if (this._barObjectH)
            this._barMaxWidth = this.width - this._barMaxWidthDelta;
        if (this._barObjectV)
            this._barMaxHeight = this.height - this._barMaxHeightDelta;
        if (!this._underConstruct)
            this.update(this._value);
    }

    public setup_afterAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_afterAdd(buffer, beginPos);

        if (!buffer.seek(beginPos, 6)) {
            this.update(this._value);
            return;
        }

        if (buffer.readByte() !== (this.packageItem!.objectType as number)) {
            this.update(this._value);
            return;
        }

        this._value = buffer.readInt();
        this._max = buffer.readInt();
        if (buffer.version >= 2)
            this._min = buffer.readInt();

        this.update(this._value);
    }
}
