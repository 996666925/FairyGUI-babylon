import { ObjectPropID } from '../FieldTypes.js';
import { GearBase, GearIndex, registerGear } from './GearBase.js';
import type { ByteBuffer } from '../utils/ByteBuffer.js';
import type { GObject } from '../GObject.js';

interface Value {
    playing: boolean;
    frame: number;
}

/**
 * Drives a movie clip's playing state and current frame from the controller's
 * selected page.
 *
 * Both halves come in through the same two object-property slots, so this gear
 * works for any widget that maps `ObjectPropID.Playing` / `.Frame` onto
 * something meaningful.
 */
export class GearAnimation extends GearBase {
    private _storage: Record<string, Value> = {};
    private _default: Value = { playing: false, frame: 0 };

    public constructor(owner: GObject) {
        super(owner);
    }

    protected init(): void {
        this._default = {
            playing: this._owner.getProp(ObjectPropID.Playing) as boolean,
            frame: this._owner.getProp(ObjectPropID.Frame) as number,
        };
        this._storage = {};
    }

    protected addStatus(pageId: string | null, buffer: ByteBuffer): void {
        let gv: Value;
        if (pageId == null)
            gv = this._default;
        else
            this._storage[pageId] = gv = { playing: false, frame: 0 };
        gv.playing = buffer.readBool();
        gv.frame = buffer.readInt();
    }

    public apply(): void {
        this._owner._gearLocked = true;

        let gv: Value = this._storage[this._controller!.selectedPageId!];
        if (!gv)
            gv = this._default;

        this._owner.setProp(ObjectPropID.Playing, gv.playing);
        this._owner.setProp(ObjectPropID.Frame, gv.frame);

        this._owner._gearLocked = false;
    }

    public updateState(): void {
        let gv: Value = this._storage[this._controller!.selectedPageId!];
        if (!gv)
            this._storage[this._controller!.selectedPageId!] = gv = { playing: false, frame: 0 };

        gv.playing = this._owner.getProp(ObjectPropID.Playing) as boolean;
        gv.frame = this._owner.getProp(ObjectPropID.Frame) as number;
    }
}

registerGear(GearIndex.Animation, GearAnimation);
