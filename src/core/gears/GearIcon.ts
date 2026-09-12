import { GearBase, GearIndex, registerGear } from './GearBase.js';
import type { ByteBuffer } from '../utils/ByteBuffer.js';
import type { GObject } from '../GObject.js';

/**
 * Drives the owner's icon from the controller's selected page.
 *
 * The null/undefined split matches `GearText`: a stored null clears the icon,
 * a page with no entry falls back to `_default`.
 */
export class GearIcon extends GearBase {
    private _storage: Record<string, string | null | undefined> = {};
    private _default: string | null = null;

    public constructor(owner: GObject) {
        super(owner);
    }

    protected init(): void {
        this._default = this._owner.icon;
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
            this._owner.icon = data;
        else
            this._owner.icon = this._default;

        this._owner._gearLocked = false;
    }

    public updateState(): void {
        this._storage[this._controller!.selectedPageId!] = this._owner.icon;
    }
}

registerGear(GearIndex.Icon, GearIcon);
