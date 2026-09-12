import { GObject } from './GObject.js';
import { FillMethod, FillOrigin, FlipType, ObjectPropID } from './FieldTypes.js';
import { Color } from './utils/Color.js';
import { Point } from './utils/Geometry.js';
import { PixelHitTest } from './event/HitTest.js';
import { getRenderFactory, type IImageObject, type IRenderObject } from './render/IRenderObject.js';
import { spriteTrim } from './UIPackage.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { PackageItem } from './PackageItem.js';

/**
 * A bitmap drawn from a package atlas, or a flat colour when the item has no
 * sprite.
 *
 * Not clickable by itself — `_touchDisabled` is set so hit testing falls
 * through to the enclosing component, which decides its own click area via
 * `opaque` or an explicit `hitArea`.
 */
export class GImage extends GObject {
    /** The drawing node. Same object as `node`, narrowed. */
    public _content: IImageObject;

    public constructor() {
        super();

        this._content = this._node as IImageObject;
        this._touchDisabled = true;
    }

    protected createDisplayObject(): IRenderObject {
        return getRenderFactory().createImage();
    }

    public get color(): Color {
        return this._content.color;
    }

    public set color(value: Color) {
        this._content.color = value;
        this.updateGear(4);
    }

    public get flip(): FlipType {
        return this._content.flip;
    }

    public set flip(value: FlipType) {
        this._content.flip = value;
    }

    public get fillMethod(): FillMethod {
        return this._content.fillMethod;
    }

    public set fillMethod(value: FillMethod) {
        this._content.fillMethod = value;
    }

    public get fillOrigin(): FillOrigin {
        return this._content.fillOrigin;
    }

    public set fillOrigin(value: FillOrigin) {
        this._content.fillOrigin = value;
    }

    public get fillClockwise(): boolean {
        return this._content.fillClockwise;
    }

    public set fillClockwise(value: boolean) {
        this._content.fillClockwise = value;
    }

    public get fillAmount(): number {
        return this._content.fillAmount;
    }

    public set fillAmount(value: number) {
        this._content.fillAmount = value;
    }

    /** Images are the one shape kind backends can use as a stencil. */
    public get isShapeMask(): boolean {
        return true;
    }

    public constructFromResource(): void {
        const contentItem = this.packageItem!.getBranch();
        this.sourceWidth = contentItem.width;
        this.sourceHeight = contentItem.height;
        this.initWidth = this.sourceWidth;
        this.initHeight = this.sourceHeight;
        this.setSize(this.sourceWidth, this.sourceHeight);

        const resItem = contentItem.getHighResolution();
        this.bindSprite(resItem);
    }

    /** Resolves an item's atlas region and hands it to the drawing node. */
    private bindSprite(resItem: PackageItem): void {
        const owner = resItem.owner;
        const sprite = owner.getSprite(resItem.id);

        if (resItem.scale9Grid)
            this._content.scale9Grid = resItem.scale9Grid;
        else if (resItem.scaleByTile)
            this._content.scaleByTile = true;
        if (resItem.tileGridIndice != null)
            this._content.tileGridIndice = resItem.tileGridIndice;

        if (!sprite) {
            // No atlas region: the item is a plain coloured rect.
            this._content.setSprite(null, null, false);
            return;
        }

        // The asset resolver maps an *atlas* item to a backend texture handle;
        // the region within it comes from the sprite record, along with where
        // that region sat before the editor trimmed the transparent margins off.
        const texture = owner.getItemAsset(sprite.atlas);
        this._content.setSprite(texture, sprite.rect, sprite.rotated ?? false, spriteTrim(sprite));

        if (resItem.hitTestData) {
            // The mask is authored against the untrimmed image, so shift it by
            // the padding the editor trimmed off.
            const tester = new PixelHitTest(resItem.hitTestData, sprite.offsetX, sprite.offsetY);
            const scratch = new Point();
            this._content.hitTestShape = (x, y) => tester.hitTest(scratch.setTo(x, y));
        }
    }

    protected handleGrayedChanged(): void {
        this._node.grayed = this._grayed;
    }

    public getProp(index: number): unknown {
        if (index === ObjectPropID.Color)
            return this.color;
        return super.getProp(index);
    }

    public setProp(index: number, value: unknown): void {
        if (index === ObjectPropID.Color)
            this.color = value instanceof Color ? value : Color.parse(value as string) ?? this.color;
        else
            super.setProp(index, value);
    }

    public setup_beforeAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_beforeAdd(buffer, beginPos);

        buffer.seek(beginPos, 5);

        if (buffer.readBool())
            this.color = buffer.readColor();
        this._content.flip = buffer.readByte();
        this._content.fillMethod = buffer.readByte();
        if (this._content.fillMethod !== FillMethod.None) {
            this._content.fillOrigin = buffer.readByte();
            this._content.fillClockwise = buffer.readBool();
            this._content.fillAmount = buffer.readFloat();
        }
    }
}

