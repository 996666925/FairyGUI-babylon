import { GearBase, GearIndex, registerGear } from './GearBase.js';
import type { ByteBuffer } from '../utils/ByteBuffer.js';
import type { GObject } from '../GObject.js';

/**
 * Drives the owner's text from the controller's selected page.
 *
 * A page whose payload is a null string stores `null`, and applying it clears
 * the text — that is a distinct outcome from a page with no stored value at
 * all, which falls back to `_default`. The lookup therefore keeps `undefined`
 * in its type, mirroring the reference's `data !== undefined` test.
 */
export class GearText extends GearBase {
    private _storage: Record<string, string | null | undefined> = {};
    private _default: string | null = null;

    public constructor(owner: GObject) {
        super(owner);
    }

    protected init(): void {
        this._default = this._owner.text;
        this._storage = {};
    }

    protected addStatus(pageId: string | null, buffer: ByteBuffer): void {
        if (pageId == null)
            this._default = buffer.readS();
        else
            this._storage[pageId] = buffer.readS();
    }

    public apply(): void {
        this._owner._gearLocked = true;

        const data = this._storage[this._controller!.selectedPageId!];
        if (data !== undefined)
            this._owner.text = data;
        else
            this._owner.text = this._default;

        this._owner._gearLocked = false;
    }

    public updateState(): void {
        this._storage[this._controller!.selectedPageId!] = this._owner.text;
    }
}

registerGear(GearIndex.Text, GearText);
