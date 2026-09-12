import type { ByteBuffer } from '../utils/ByteBuffer.js';
import type { Point } from '../utils/Geometry.js';
import type { GObject } from '../GObject.js';

export interface IHitTest {
    /**
     * @param pt the point in the owning object's local space.
     * @param globalPt the same point in UI-root space, for tests that need to
     *   reach into a child's own coordinates.
     */
    hitTest(pt: Point, globalPt: Point): boolean;
}

/**
 * An alpha mask baked by the editor for images whose shape does not match their
 * bounding box. Bits are packed LSB-first, one per pixel, row-major.
 */
export class PixelHitTestData {
    public pixelWidth: number;
    /** Pixels per stored sample; the editor downsamples large masks. */
    public scale: number;
    public pixels: Uint8Array;

    public constructor(ba: ByteBuffer) {
        ba.readInt();
        this.pixelWidth = ba.readInt();
        this.scale = 1 / ba.readByte();
        this.pixels = ba.readBuffer().data;
    }
}

/**
 * Defers a hit test to another object — used when a component wants its click
 * area to be the silhouette of one of its children rather than its own box.
 */
export class ChildHitArea implements IHitTest {
    private _child: GObject;

    public constructor(child: GObject) {
        this._child = child;
    }

    public hitTest(_pt: Point, globalPt: Point): boolean {
        return this._child.hitTest(globalPt, false) !== null;
    }
}

export class PixelHitTest implements IHitTest {
    private _data: PixelHitTestData;

    public offsetX: number;
    public offsetY: number;
    public scaleX = 1;
    public scaleY = 1;

    public constructor(data: PixelHitTestData, offsetX = 0, offsetY = 0) {
        this._data = data;
        this.offsetX = offsetX;
        this.offsetY = offsetY;
    }

    public hitTest(pt: Point, _globalPt?: Point): boolean {
        const x = Math.floor((pt.x / this.scaleX - this.offsetX) * this._data.scale);
        const y = Math.floor((pt.y / this.scaleY - this.offsetY) * this._data.scale);
        if (x < 0 || y < 0 || x >= this._data.pixelWidth)
            return false;

        const pos = y * this._data.pixelWidth + x;
        const pos2 = Math.floor(pos / 8);
        const pos3 = pos % 8;

        if (pos2 >= 0 && pos2 < this._data.pixels.length)
            return ((this._data.pixels[pos2] >> pos3) & 0x1) === 1;
        else
            return false;
    }
}
