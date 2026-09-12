import { GearBase, GearIndex, registerGear } from './GearBase.js';
import type { ByteBuffer } from '../utils/ByteBuffer.js';
import type { GObject } from '../GObject.js';

/**
 * The second display gear: like `GearDisplay`, but it does not decide
 * visibility on its own. `GObject.checkGearDisplay` feeds it the answer from
 * the first display gear (and from any other owners of the same controller) and
 * it combines that with its own page list.
 */
export class GearDisplay2 extends GearBase {
    public pages: string[] | null = null;

    /**
     * How to combine the two answers: `0` is AND, anything else is OR.
     *
     * Left uninitialised on purpose. The reference reads it only for package
     * format v2+ (`readExtra`), so a v1 package leaves it `undefined`, and
     * `undefined == 0` is false — a v1 GearDisplay2 therefore ORs where its
     * editor-side default would AND. Preserved rather than defaulted to `0`.
     */
    public condition!: number;

    private _visible = 0;

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

    /** Reads the combine mode stored after the per-page payload in v2+. */
    protected readExtra(buffer: ByteBuffer, _cnt: number): void {
        this.condition = buffer.readByte();
    }

    public apply(): void {
        if (this.pages == null || this.pages.length == 0
            || this.pages.indexOf(this._controller!.selectedPageId!) != -1)
            this._visible = 1;
        else
            this._visible = 0;
    }

    public evaluate(connected: boolean): boolean {
        let v: boolean = this._controller == null || this._visible > 0;
        if (this.condition == 0)
            v = v && connected;
        else
            v = v || connected;
        return v;
    }
}

registerGear(GearIndex.Display2, GearDisplay2);
