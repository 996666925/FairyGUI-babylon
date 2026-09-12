import { GObject } from './GObject.js';
import { AlignType, LoaderFillType, ObjectPropID, PackageItemType, VertAlignType } from './FieldTypes.js';
import { Color } from './utils/Color.js';
import { ToolSet } from './utils/ToolSet.js';
import { UIPackage } from './UIPackage.js';
import { getRenderFactory, type IRenderObject } from './render/IRenderObject.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { PackageItem } from './PackageItem.js';

/**
 * A piece of 3D or skeletal content hosted inside the UI.
 *
 * The reference hard-codes Spine and DragonBones. Neither is part of this
 * library, so the content itself is supplied through a
 * `ILoader3DContentFactory` — a host that has a skeleton runtime registers one,
 * and everything else (URL handling, fill modes, alignment, auto-size, the
 * playing/frame/skin property surface) works regardless.
 */
export interface ILoader3DContent {
    /** The render node to parent into the loader's container. */
    readonly node: IRenderObject;
    playing: boolean;
    /** Normalised `0..100` position within the current animation. */
    frame: number;
    animationName: string | null;
    skinName: string | null;
    loop: boolean;
    color: Color;
    /** Advances the content. `dt` is in seconds. */
    update(dt: number): void;
    dispose(): void;
}

export interface ILoader3DContentFactory {
    /** Builds content for a package item, or returns `null` if unsupported. */
    createFromPackage(item: PackageItem): ILoader3DContent | null;
    /** Builds content for an external URL, or returns `null` if unsupported. */
    createFromUrl(url: string): ILoader3DContent | null;
}

let contentFactory: ILoader3DContentFactory | null = null;

export function setLoader3DContentFactory(factory: ILoader3DContentFactory | null): void {
    contentFactory = factory;
}

/** Fallback box for content that reports no natural size, as in the reference. */
const DEFAULT_CONTENT_WIDTH = 50;
const DEFAULT_CONTENT_HEIGHT = 30;

export class GLoader3D extends GObject {
    private _url = '';
    private _align: AlignType = AlignType.Left;
    private _verticalAlign: VertAlignType = VertAlignType.Top;
    private _autoSize = false;
    private _fill: LoaderFillType = LoaderFillType.None;
    private _shrinkOnly = false;
    private _playing = true;
    private _frame = 0;
    private _loop = false;
    private _animationName: string | null = null;
    private _skinName: string | null = null;
    private _color = new Color(255, 255, 255, 255);
    private _container: IRenderObject;
    private _content: ILoader3DContent | null = null;
    /** Guards `handleSizeChanged` against re-entering `updateLayout`. */
    private _updatingLayout = false;

    public constructor() {
        super();

        this._container = getRenderFactory().createObject();
        // Children are laid out from the container's top-left corner.
        this._container.setPivot(0, 0);
        this._node.addChild(this._container);
    }

    // ---- properties ------------------------------------------------------

    public get url(): string {
        return this._url;
    }

    public set url(value: string) {
        if (this._url === value)
            return;
        this._url = value;
        this.loadContent();
        this.updateGear(7);
    }

    public get icon(): string {
        return this._url;
    }

    public set icon(value: string) {
        this.url = value;
    }

    public get align(): AlignType {
        return this._align;
    }

    public set align(value: AlignType) {
        if (this._align !== value) {
            this._align = value;
            this.updateLayout();
        }
    }

    public get verticalAlign(): VertAlignType {
        return this._verticalAlign;
    }

    public set verticalAlign(value: VertAlignType) {
        if (this._verticalAlign !== value) {
            this._verticalAlign = value;
            this.updateLayout();
        }
    }

    public get fill(): LoaderFillType {
        return this._fill;
    }

    public set fill(value: LoaderFillType) {
        if (this._fill !== value) {
            this._fill = value;
            this.updateLayout();
        }
    }

    public get shrinkOnly(): boolean {
        return this._shrinkOnly;
    }

    public set shrinkOnly(value: boolean) {
        if (this._shrinkOnly !== value) {
            this._shrinkOnly = value;
            this.updateLayout();
        }
    }

    public get autoSize(): boolean {
        return this._autoSize;
    }

    public set autoSize(value: boolean) {
        if (this._autoSize !== value) {
            this._autoSize = value;
            this.updateLayout();
        }
    }

    public get playing(): boolean {
        return this._playing;
    }

    public set playing(value: boolean) {
        if (this._playing === value)
            return;
        this._playing = value;
        this.updateGear(5);
        this.onChange();
    }

    public get frame(): number {
        return this._frame;
    }

    public set frame(value: number) {
        if (this._frame === value)
            return;
        this._frame = value;
        this.updateGear(5);
        this.onChange();
    }

    public get animationName(): string | null {
        return this._animationName;
    }

    public set animationName(value: string | null) {
        if (this._animationName !== value) {
            this._animationName = value;
            this.onChange();
        }
    }

    public get skinName(): string | null {
        return this._skinName;
    }

    public set skinName(value: string | null) {
        if (this._skinName !== value) {
            this._skinName = value;
            this.onChange();
        }
    }

    public get loop(): boolean {
        return this._loop;
    }

    public set loop(value: boolean) {
        if (this._loop !== value) {
            this._loop = value;
            this.onChange();
        }
    }

    public get color(): Color {
        return this._color;
    }

    public set color(value: Color) {
        this._color.copy(value);
        this.updateGear(4);
        if (this._content)
            this._content.color = value;
    }

    public get content(): ILoader3DContent | null {
        return this._content;
    }

    // ---- loading ---------------------------------------------------------

    protected loadContent(): void {
        this.clearContent();
        if (!this._url)
            return;

        if (ToolSet.startsWith(this._url, 'ui://'))
            this.loadFromPackage(this._url);
        else
            this.loadExternal();
    }

    protected loadFromPackage(itemURL: string): void {
        let item = UIPackage.getItemByURL(itemURL);
        if (!item)
            return;

        item = item.getBranch();
        this.sourceWidth = item.width;
        this.sourceHeight = item.height;
        item = item.getHighResolution();

        if (this._autoSize)
            this.setSize(this.sourceWidth, this.sourceHeight);

        if (item.type !== PackageItemType.Spine && item.type !== PackageItemType.DragonBones)
            return;

        if (!contentFactory)
            return;

        const content = contentFactory.createFromPackage(item);
        if (content)
            this.adoptContent(content);
    }

    protected loadExternal(): void {
        if (!contentFactory)
            return;

        // Loading may be asynchronous; a result that arrives after the URL has
        // moved on is discarded rather than shown.
        const url = this._url;
        const content = contentFactory.createFromUrl(url);
        if (!content || this._url !== url)
            return;

        this.adoptContent(content);
    }

    /** Installs previously-prepared content, replacing whatever was there. */
    public setContent(content: ILoader3DContent | null): void {
        this.clearContent();
        if (content)
            this.adoptContent(content);
    }

    private adoptContent(content: ILoader3DContent): void {
        this._content = content;

        content.color = this._color;
        content.playing = this._playing;
        content.frame = this._frame;
        content.animationName = this._animationName;
        content.skinName = this._skinName;
        content.loop = this._loop;

        this._container.addChild(content.node);
        this.updateLayout();
    }

    private onChange(): void {
        if (!this._content)
            return;

        this._content.playing = this._playing;
        this._content.frame = this._frame;
        this._content.animationName = this._animationName;
        this._content.skinName = this._skinName;
        this._content.loop = this._loop;
    }

    private clearContent(): void {
        if (this._content) {
            this._content.dispose();
            this._content = null;
        }
    }

    public onUpdate(dt: number): void {
        if (this._playing)
            this._content?.update(dt);
    }

    // ---- layout ----------------------------------------------------------

    private updateLayout(): void {
        let cw = this.sourceWidth;
        let ch = this.sourceHeight;

        // The container sits at the content box's top-left, which is offset
        // from the node's pivot.
        const pivotCorrectX = -this.pivotX * this._width;
        const pivotCorrectY = -this.pivotY * this._height;

        if (this._autoSize) {
            this._updatingLayout = true;
            if (cw === 0)
                cw = DEFAULT_CONTENT_WIDTH;
            if (ch === 0)
                ch = DEFAULT_CONTENT_HEIGHT;

            this.setSize(cw, ch);
            this._updatingLayout = false;

            if (cw === this._width && ch === this._height) {
                this._container.setScale(1, 1);
                this._container.setPosition(pivotCorrectX, pivotCorrectY);
                return;
            }
        }

        let sx = 1;
        let sy = 1;
        if (this._fill !== LoaderFillType.None) {
            sx = this.width / this.sourceWidth;
            sy = this.height / this.sourceHeight;

            if (sx !== 1 || sy !== 1) {
                switch (this._fill) {
                    case LoaderFillType.ScaleMatchHeight:
                        sx = sy;
                        break;
                    case LoaderFillType.ScaleMatchWidth:
                        sy = sx;
                        break;
                    case LoaderFillType.Scale:
                        // Contain: pick the smaller scale so nothing is cropped.
                        if (sx > sy)
                            sx = sy;
                        else
                            sy = sx;
                        break;
                    case LoaderFillType.ScaleNoBorder:
                        // Cover: pick the larger scale so nothing is letterboxed.
                        if (sx > sy)
                            sy = sx;
                        else
                            sx = sy;
                        break;
                }

                if (this._shrinkOnly) {
                    if (sx > 1)
                        sx = 1;
                    if (sy > 1)
                        sy = 1;
                }

                cw = this.sourceWidth * sx;
                ch = this.sourceHeight * sy;
            }
        }

        this._container.setScale(sx, sy);

        let nx: number;
        if (this._align === AlignType.Left)
            nx = 0;
        else if (this._align === AlignType.Center)
            nx = Math.floor((this._width - cw) / 2);
        else
            nx = this._width - cw;

        let ny: number;
        if (this._verticalAlign === VertAlignType.Top)
            ny = 0;
        else if (this._verticalAlign === VertAlignType.Middle)
            ny = Math.floor((this._height - ch) / 2);
        else
            ny = this._height - ch;

        this._container.setPosition(pivotCorrectX + nx, pivotCorrectY + ny);
    }

    protected handleSizeChanged(): void {
        super.handleSizeChanged();
        if (!this._updatingLayout)
            this.updateLayout();
    }

    protected onMoved(): void {
        if (!this._updatingLayout)
            this.updateLayout();
    }

    protected handleGrayedChanged(): void {
        // Greyscale is a material concern the content owns; nothing here.
    }

    // ---- properties by index ---------------------------------------------

    public getProp(index: number): unknown {
        switch (index) {
            case ObjectPropID.Color: return this.color;
            case ObjectPropID.Playing: return this.playing;
            case ObjectPropID.Frame: return this.frame;
            case ObjectPropID.TimeScale: return 1;
            default: return super.getProp(index);
        }
    }

    public setProp(index: number, value: unknown): void {
        switch (index) {
            case ObjectPropID.Color:
                this.color = value instanceof Color ? value : Color.parse(value as string) ?? this.color;
                break;
            case ObjectPropID.Playing:
                this.playing = value as boolean;
                break;
            case ObjectPropID.Frame:
                this.frame = value as number;
                break;
            case ObjectPropID.TimeScale:
            case ObjectPropID.DeltaTime:
                break;
            default:
                super.setProp(index, value);
                break;
        }
    }

    public setup_beforeAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_beforeAdd(buffer, beginPos);

        buffer.seek(beginPos, 5);

        this._url = (buffer.readS() as string) ?? '';
        this._align = buffer.readByte();
        this._verticalAlign = buffer.readByte();
        this._fill = buffer.readByte();
        this._shrinkOnly = buffer.readBool();
        this._autoSize = buffer.readBool();
        this._animationName = buffer.readS();
        this._skinName = buffer.readS();
        this._playing = buffer.readBool();
        this._frame = buffer.readInt();
        this._loop = buffer.readBool();

        if (buffer.readBool())
            this.color = buffer.readColor();

        if (this._url)
            this.loadContent();
    }

    public dispose(): void {
        this.clearContent();
        super.dispose();
    }
}
