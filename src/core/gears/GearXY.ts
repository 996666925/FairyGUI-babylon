import { GTween } from '../tween/GTween.js';
import { UIPackage } from '../UIPackage.js';
import { GearBase, GearIndex, registerGear } from './GearBase.js';
import type { ByteBuffer } from '../utils/ByteBuffer.js';
import type { GObject } from '../GObject.js';
import type { GTweener } from '../tween/GTweener.js';

interface Value {
    x: number;
    y: number;
    px: number;
    py: number;
}

/**
 * Drives the owner's position from the controller's selected page.
 *
 * Alongside the absolute point, each page stores the same point as a fraction
 * of the parent (`px`/`py`), used when the editor saved the gear in percent
 * mode.
 */
export class GearXY extends GearBase {
    public positionsInPercent = false;

    private _storage: Record<string, Value> = {};
    private _default: Value = { x: 0, y: 0, px: 0, py: 0 };

    public constructor(owner: GObject) {
        super(owner);
    }

    protected init(): void {
        this._default = {
            x: this._owner.x,
            y: this._owner.y,
            px: this._owner.x / this._owner.parent!.width,
            py: this._owner.y / this._owner.parent!.height,
        };
        this._storage = {};
    }

    protected addStatus(pageId: string | null, buffer: ByteBuffer): void {
        let gv: Value;
        if (pageId == null)
            gv = this._default;
        else
            this._storage[pageId] = gv = { x: 0, y: 0, px: 0, py: 0 };
        gv.x = buffer.readInt();
        gv.y = buffer.readInt();
    }

    public addExtStatus(pageId: string | null, buffer: ByteBuffer): void {
        let gv: Value;
        if (pageId == null)
            gv = this._default;
        else
            gv = this._storage[pageId];
        gv.px = buffer.readFloat();
        gv.py = buffer.readFloat();
    }

    /** Reads the percent positions stored after the per-page payload in v2+. */
    protected readExtra(buffer: ByteBuffer, cnt: number): void {
        if (buffer.readBool()) {
            this.positionsInPercent = true;
            for (let i = 0; i < cnt; i++) {
                const page = buffer.readS();
                if (page == null)
                    continue;

                this.addExtStatus(page, buffer);
            }

            if (buffer.readBool())
                this.addExtStatus(null, buffer);
        }
    }

    public apply(): void {
        let gv: Value = this._storage[this._controller!.selectedPageId!];
        if (!gv)
            gv = this._default;

        let ex: number;
        let ey: number;

        if (this.positionsInPercent && this._owner.parent) {
            ex = gv.px * this._owner.parent.width;
            ey = gv.py * this._owner.parent.height;
        } else {
            ex = gv.x;
            ey = gv.y;
        }

        if (this._tweenConfig && this._tweenConfig.tween && !UIPackage._constructing && !GearBase.disableAllTweenEffect) {
            if (this._tweenConfig._tweener) {
                if (this._tweenConfig._tweener.endValue.x != ex || this._tweenConfig._tweener.endValue.y != ey) {
                    this._tweenConfig._tweener.kill(true);
                    this._tweenConfig._tweener = null;
                } else {
                    return;
                }
            }

            const ox: number = this._owner.x;
            const oy: number = this._owner.y;

            if (ox != ex || oy != ey) {
                if (this._owner.checkGearController(0, this._controller!))
                    this._tweenConfig._displayLockToken = this._owner.addDisplayLock();

                this._tweenConfig._tweener = GTween.to2(ox, oy, ex, ey, this._tweenConfig.duration)
                    .setDelay(this._tweenConfig.delay)
                    .setEase(this._tweenConfig.easeType)
                    .setTarget(this)
                    .onUpdate(this.__tweenUpdate, this)
                    .onComplete(this.__tweenComplete, this);
            }
        } else {
            this._owner._gearLocked = true;
            this._owner.setPosition(ex, ey);
            this._owner._gearLocked = false;
        }
    }

    private __tweenUpdate(tweener: GTweener): void {
        this._owner._gearLocked = true;
        this._owner.setPosition(tweener.value.x, tweener.value.y);
        this._owner._gearLocked = false;
    }

    private __tweenComplete(): void {
        if (this._tweenConfig!._displayLockToken != 0) {
            this._owner.releaseDisplayLock(this._tweenConfig!._displayLockToken);
            this._tweenConfig!._displayLockToken = 0;
        }
        this._tweenConfig!._tweener = null;
    }

    public updateState(): void {
        let gv: Value = this._storage[this._controller!.selectedPageId!];
        if (!gv)
            this._storage[this._controller!.selectedPageId!] = gv = { x: 0, y: 0, px: 0, py: 0 };

        gv.x = this._owner.x;
        gv.y = this._owner.y;
        gv.px = this._owner.x / this._owner.parent!.width;
        gv.py = this._owner.y / this._owner.parent!.height;
    }

    public updateFromRelations(dx: number, dy: number): void {
        if (this._controller == null || this._storage == null || this.positionsInPercent)
            return;

        for (const key in this._storage) {
            const pt: Value = this._storage[key];
            pt.x += dx;
            pt.y += dy;
        }
        this._default.x += dx;
        this._default.y += dy;

        this.updateState();
    }
}

registerGear(GearIndex.XY, GearXY);
