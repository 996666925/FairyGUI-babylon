import { Color } from '../utils/Color.js';
import { ObjectPropID } from '../FieldTypes.js';
import { GearBase, GearIndex, registerGear } from './GearBase.js';
import type { ByteBuffer } from '../utils/ByteBuffer.js';
import type { GObject } from '../GObject.js';

interface Value {
    color: Color | null;
    strokeColor: Color | null;
}

/**
 * Reads the four colour bytes a gear stores: RGBA, big-endian, one byte each.
 *
 * `ByteBuffer` in this repo has no `readColor`, so the read lives here. The
 * reference's `readColor()` also defaults alpha to opaque for this call — see
 * the note in `GearColor` — which is reproduced.
 */
function readGearColor(buffer: ByteBuffer): Color {
    const r = buffer.readUbyte();
    const g = buffer.readUbyte();
    const b = buffer.readUbyte();
    buffer.readUbyte(); // alpha, discarded below
    return new Color(r, g, b, 255);
}

/**
 * Drives the owner's tint and outline colour from the controller's selected page.
 *
 * The reference reads each colour through `readColor()` without the `hasAlpha`
 * flag, which forces alpha to `255` and throws the stored alpha byte away. That
 * is preserved: a gear colour is always opaque. The byte is still consumed, so
 * the stream stays in sync.
 */
export class GearColor extends GearBase {
    private _storage: Record<string, Value> = {};
    private _default: Value = { color: null, strokeColor: null };

    public constructor(owner: GObject) {
        super(owner);
    }

    protected init(): void {
        this._default = {
            color: this._owner.getProp(ObjectPropID.Color) as Color | null,
            strokeColor: this._owner.getProp(ObjectPropID.OutlineColor) as Color | null,
        };
        this._storage = {};
    }

    protected addStatus(pageId: string | null, buffer: ByteBuffer): void {
        let gv: Value;
        if (pageId == null)
            gv = this._default;
        else
            this._storage[pageId] = gv = { color: null, strokeColor: null };
        gv.color = readGearColor(buffer);
        gv.strokeColor = readGearColor(buffer);
    }

    public apply(): void {
        this._owner._gearLocked = true;

        let gv: Value = this._storage[this._controller!.selectedPageId!];
        if (!gv)
            gv = this._default;

        this._owner.setProp(ObjectPropID.Color, gv.color);
        this._owner.setProp(ObjectPropID.OutlineColor, gv.strokeColor);

        this._owner._gearLocked = false;
    }

    public updateState(): void {
        let gv: Value = this._storage[this._controller!.selectedPageId!];
        if (!gv)
            this._storage[this._controller!.selectedPageId!] = gv = { color: null, strokeColor: null };

        gv.color = this._owner.getProp(ObjectPropID.Color) as Color | null;
        gv.strokeColor = this._owner.getProp(ObjectPropID.OutlineColor) as Color | null;
    }
}

registerGear(GearIndex.Color, GearColor);
