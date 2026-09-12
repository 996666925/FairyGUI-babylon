import { ObjectPropID } from '../FieldTypes.js';
import { GearBase, GearIndex, registerGear } from './GearBase.js';
import type { ByteBuffer } from '../utils/ByteBuffer.js';
import type { GObject } from '../GObject.js';

/**
 * Drives the owner's font size from the controller's selected page.
 *
 * Sizes are integers, so a stored `0` is legitimate and is told apart from "no
 * stored value" by the `!= undefined` test rather than by truthiness.
 */
export class GearFontSize extends GearBase {
    private _storage: Record<string, number | undefined> = {};
    private _default = 0;

    public constructor(owner: GObject) {
        super(owner);
    }

    protected init(): void {
        this._default = this._owner.getProp(ObjectPropID.FontSize) as number;
        this._storage = {};
    }

    protected addStatus(pageId: string | null, buffer: ByteBuffer): void {
        if (pageId == null)
            this._default = buffer.readInt();
        else
            this._storage[pageId] = buffer.readInt();
    }

    public apply(): void {
        this._owner._gearLocked = true;

        const data = this._storage[this._controller!.selectedPageId!];
        if (data != undefined)
            this._owner.setProp(ObjectPropID.FontSize, data);
        else
            this._owner.setProp(ObjectPropID.FontSize, this._default);

        this._owner._gearLocked = false;
    }

    public updateState(): void {
        this._storage[this._controller!.selectedPageId!] = this._owner.getProp(ObjectPropID.FontSize) as number;
    }
}

registerGear(GearIndex.FontSize, GearFontSize);
