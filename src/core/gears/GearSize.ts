import { GTween } from '../tween/GTween.js';
import { UIPackage } from '../UIPackage.js';
import { GearBase, GearIndex, registerGear } from './GearBase.js';
import type { ByteBuffer } from '../utils/ByteBuffer.js';
import type { GObject } from '../GObject.js';
import type { GTweener } from '../tween/GTweener.js';

interface Value {
    width: number;
    height: number;
    scaleX: number;
    scaleY: number;
}

/**
 * Drives the owner's size and scale from the controller's selected page.
 *
 * A page stores both, and the tween interpolates both in one `to4`; the user
 * data flag records which half actually differs, so a page that only changes
 * the scale does not rewrite the size every frame.
 */
export class GearSize extends GearBase {
    private _storage: Record<string, Value> = {};
    private _default: Value = { width: 0, height: 0, scaleX: 1, scaleY: 1 };

    public constructor(owner: GObject) {
        super(owner);
    }

    protected init(): void {
        this._default = {
            width: this._owner.width,
            height: this._owner.height,
            scaleX: this._owner.scaleX,
            scaleY: this._owner.scaleY,
        };
        this._storage = {};
    }

    protected addStatus(pageId: string | null, buffer: ByteBuffer): void {
        let gv: Value;
        if (pageId == null)
            gv = this._default;
        else
            this._storage[pageId] = gv = { width: 0, height: 0, scaleX: 1, scaleY: 1 };

        gv.width = buffer.readInt();
        gv.height = buffer.readInt();
        gv.scaleX = buffer.readFloat();
        gv.scaleY = buffer.readFloat();
    }

    public apply(): void {
        let gv: Value = this._storage[this._controller!.selectedPageId!];
        if (!gv)
            gv = this._default;

        if (this._tweenConfig && this._tweenConfig.tween && !UIPackage._constructing && !GearBase.disableAllTweenEffect) {
            if (this._tweenConfig._tweener) {
                if (this._tweenConfig._tweener.endValue.x != gv.width || this._tweenConfig._tweener.endValue.y != gv.height
                    || this._tweenConfig._tweener.endValue.z != gv.scaleX || this._tweenConfig._tweener.endValue.w != gv.scaleY) {
                    this._tweenConfig._tweener.kill(true);
                    this._tweenConfig._tweener = null;
                } else {
                    return;
                }
            }

            const a: boolean = gv.width != this._owner.width || gv.height != this._owner.height;
            const b: boolean = gv.scaleX != this._owner.scaleX || gv.scaleY != this._owner.scaleY;
            if (a || b) {
                if (this._owner.checkGearController(0, this._controller!))
                    this._tweenConfig._displayLockToken = this._owner.addDisplayLock();

                this._tweenConfig._tweener = GTween.to4(this._owner.width, this._owner.height, this._owner.scaleX, this._owner.scaleY, gv.width, gv.height, gv.scaleX, gv.scaleY, this._tweenConfig.duration)
                    .setDelay(this._tweenConfig.delay)
                    .setEase(this._tweenConfig.easeType)
                    .setUserData((a ? 1 : 0) + (b ? 2 : 0))
                    .setTarget(this)
                    .onUpdate(this.__tweenUpdate, this)
                    .onComplete(this.__tweenComplete, this);
            }
        } else {
            this._owner._gearLocked = true;
            this._owner.setSize(gv.width, gv.height, this._owner.gearXY.controller == this._controller);
            this._owner.setScale(gv.scaleX, gv.scaleY);
            this._owner._gearLocked = false;
        }
    }

    private __tweenUpdate(tweener: GTweener): void {
        const flag: number = tweener.userData;
        this._owner._gearLocked = true;
        if ((flag & 1) != 0)
            this._owner.setSize(tweener.value.x, tweener.value.y, this._owner.checkGearController(1, this._controller!));
        if ((flag & 2) != 0)
            this._owner.setScale(tweener.value.z, tweener.value.w);
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
            this._storage[this._controller!.selectedPageId!] = gv = { width: 0, height: 0, scaleX: 1, scaleY: 1 };

        gv.width = this._owner.width;
        gv.height = this._owner.height;
        gv.scaleX = this._owner.scaleX;
        gv.scaleY = this._owner.scaleY;
    }

    public updateFromRelations(dx: number, dy: number): void {
        if (this._controller == null || this._storage == null)
            return;

        for (const key in this._storage) {
            const gv: Value = this._storage[key];
            gv.width += dx;
            gv.height += dy;
        }
        this._default.width += dx;
        this._default.height += dy;

        this.updateState();
    }
}

registerGear(GearIndex.Size, GearSize);
