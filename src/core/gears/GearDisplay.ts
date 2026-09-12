import { GearBase, GearIndex, registerGear } from './GearBase.js';
import type { ByteBuffer } from '../utils/ByteBuffer.js';
import type { GObject } from '../GObject.js';

/**
 * Shows or hides the owner according to the controller's selected page.
 *
 * Instead of one value per page it stores a plain list of page names, and the
 * owner counts as "connected" while the selected page is in that list — or
 * while any lock is held. `GObject.checkGearDisplay` reads `connected` to
 * recompute the owner's internal visibility, so the two work as a pair.
 *
 * The lock is a token, not a counter: `addLock` hands out the gear's current
 * token and `releaseLock` only honours the token it still holds. A lock taken
 * before a page change is therefore void after it, which keeps a stale tween
 * from pinning a widget visible forever.
 */
export class GearDisplay extends GearBase {
    public pages: string[] | null = null;

    private _visible = 0;
    private _displayLockToken = 1;

    public constructor(owner: GObject) {
        super(owner);
    }

    protected init(): void {
        this.pages = null;
    }

    /**
     * Reads a plain page-name list rather than one value per page.
     *
     * `readSArray` may hand back nulls for entries the editor left empty; the
     * cast keeps the reference's `string[]` declaration, and a null entry can
     * never match a page id, so `apply` behaves the same either way.
     */
    protected readPages(buffer: ByteBuffer, cnt: number): void {
        this.pages = buffer.readSArray(cnt) as string[];
    }

    public apply(): void {
        this._displayLockToken++;
        if (this._displayLockToken == 0)
            this._displayLockToken = 1;

        if (this.pages == null || this.pages.length == 0
            || this.pages.indexOf(this._controller!.selectedPageId!) != -1)
            this._visible = 1;
        else
            this._visible = 0;
    }

    public addLock(): number {
        this._visible++;
        return this._displayLockToken;
    }

    public releaseLock(token: number): void {
        if (token == this._displayLockToken)
            this._visible--;
    }

    public get connected(): boolean {
        return this._controller == null || this._visible > 0;
    }
}

registerGear(GearIndex.Display, GearDisplay);
