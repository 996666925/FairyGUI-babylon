import { GTween } from '../tween/GTween.js';
import { UIPackage } from '../UIPackage.js';
import { GearBase, GearIndex, registerGear } from './GearBase.js';
import type { ByteBuffer } from '../utils/ByteBuffer.js';
import type { GObject } from '../GObject.js';
import type { GTweener } from '../tween/GTweener.js';

interface Value {
    alpha: number;
    rotation: number;
    grayed: boolean;
    touchable: boolean;
}

/**
 * Drives the owner's transparency and rotation from the controller's selected
 * page, plus its grayed and touchable flags.
 *
 * Only alpha and rotation are tweened; the two flags are set outright at the
 * start of every `apply`, so a page change cannot leave the owner in a state
 * where it is invisible to input but still fading.
 */
export class GearLook extends GearBase {
    private _storage: Record<string, Value> = {};
    private _default: Value = { alpha: 1, rotation: 0, grayed: false, touchable: true };

    public constructor(owner: GObject) {
        super(owner);
    }

    protected init(): void {
        this._default = {
            alpha: this._owner.alpha,
            rotation: this._owner.rotation,
            grayed: this._owner.grayed,
            touchable: this._owner.touchable,
        };
        this._storage = {};
    }

    protected addStatus(pageId: string | null, buffer: ByteBuffer): void {
        let gv: Value;
        if (pageId == null)
            gv = this._default;
        else
            this._storage[pageId] = gv = { alpha: 1, rotation: 0, grayed: false, touchable: true };

        gv.alpha = buffer.readFloat();
        gv.rotation = buffer.readFloat();
        gv.grayed = buffer.readBool();
        gv.touchable = buffer.readBool();
    }

    public apply(): void {
        let gv: Value = this._storage[this._controller!.selectedPageId!];
        if (!gv)
            gv = this._default;

        if (this._tweenConfig && this._tweenConfig.tween && !UIPackage._constructing && !GearBase.disableAllTweenEffect) {
            this._owner._gearLocked = true;
            this._owner.grayed = gv.grayed;
            this._owner.touchable = gv.touchable;
            this._owner._gearLocked = false;
            if (this._tweenConfig._tweener) {
                if (this._tweenConfig._tweener.endValue.x != gv.alpha || this._tweenConfig._tweener.endValue.y != gv.rotation) {
                    this._tweenConfig._tweener.kill(true);
                    this._tweenConfig._tweener = null;
                } else {
                    return;
                }
            }

            const a: boolean = gv.alpha != this._owner.alpha;
            const b: boolean = gv.rotation != this._owner.rotation;
            if (a || b) {
                if (this._owner.checkGearController(0, this._controller!))
                    this._tweenConfig._displayLockToken = this._owner.addDisplayLock();

                this._tweenConfig._tweener = GTween.to2(this._owner.alpha, this._owner.rotation, gv.alpha, gv.rotation, this._tweenConfig.duration)
                    .setDelay(this._tweenConfig.delay)
                    .setEase(this._tweenConfig.easeType)
                    .setUserData((a ? 1 : 0) + (b ? 2 : 0))
                    .setTarget(this)
                    .onUpdate(this.__tweenUpdate, this)
                    .onComplete(this.__tweenComplete, this);
            }
        } else {
            this._owner._gearLocked = true;
            this._owner.grayed = gv.grayed;
            this._owner.touchable = gv.touchable;
            this._owner.alpha = gv.alpha;
            this._owner.rotation = gv.rotation;
            this._owner._gearLocked = false;
        }
    }

    private __tweenUpdate(tweener: GTweener): void {
        const flag: number = tweener.userData;
        this._owner._gearLocked = true;
        if ((flag & 1) != 0)
            this._owner.alpha = tweener.value.x;
        if ((flag & 2) != 0)
            this._owner.rotation = tweener.value.y;
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
            this._storage[this._controller!.selectedPageId!] = gv = { alpha: 1, rotation: 0, grayed: false, touchable: true };

        gv.alpha = this._owner.alpha;
        gv.rotation = this._owner.rotation;
        gv.grayed = this._owner.grayed;
        gv.touchable = this._owner.touchable;
    }
}

registerGear(GearIndex.Look, GearLook);
