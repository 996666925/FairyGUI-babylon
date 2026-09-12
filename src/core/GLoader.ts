import { GObject } from './GObject.js';
import {
    AlignType,
    FillMethod,
    FillOrigin,
    LoaderFillType,
    ObjectPropID,
    PackageItemType,
    VertAlignType,
} from './FieldTypes.js';
import { Color } from './utils/Color.js';
import { ToolSet } from './utils/ToolSet.js';
import { UIConfig } from './UIConfig.js';
import { UIPackage, spriteTrim } from './UIPackage.js';
import { GObjectPool } from './GObjectPool.js';
import { MovieClip } from './GMovieClip.js';
import { getRenderFactory, type IImageObject, type IRenderObject, type SpriteTrim } from './render/IRenderObject.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { Point, Rect } from './utils/Geometry.js';
import type { Frame, PackageItem } from './PackageItem.js';
import type { GComponent } from './GComponent.js';

/**
 * A MovieClip frame is drawn on the clip's full logical canvas. The frame
 * record's rect is the atlas-sized artwork position within that canvas, which
 * is the same offset Laya passes to `Texture.create`.
 */
function movieClipFrameTrim(frame: Frame, width: number, height: number): SpriteTrim | null {
    const rect = frame.rect;
    if (rect.x === 0 && rect.y === 0 && rect.width === width && rect.height === height)
        return null;

    return {
        x: rect.x,
        y: rect.y,
        originalWidth: width,
        originalHeight: height,
    };
}

/**
 * Content a `UIContentLoader` resolved: a backend texture handle plus the size
 * the layout math needs.
 *
 * The reference handed back a `cc.SpriteFrame`, which carried its own rect.
 * A bare texture handle cannot, so the size travels alongside it.
 */
export interface UILoadedContent {
    /** Backend texture handle, as `IImageObject.setSprite` expects. */
    texture: unknown;
    /** Natural size of the loaded image, in pixels. */
    width: number;
    height: number;
}

/** @param content `null` when the load failed; `err` then explains why. */
export type UIContentLoadCallback = (err: Error | null, content: UILoadedContent | null) => void;

/**
 * Loads a `GLoader`'s external content.
 *
 * The reference called `cc.assetManager.loadRemote` for absolute URLs and
 * `cc.resources.load` for everything else. The backend installs an
 * implementation of this interface with `setUIContentLoader()`; the same split
 * is expected of it, and the URL is passed through untouched so it can decide.
 *
 * Only `load` is required. The reference's `freeExternal` hook survives as a
 * protected method on `GLoader` for a backend that wants to release what it
 * handed out; nothing in the core calls back into the loader for that.
 */
export interface UIContentLoader {
    /**
     * Resolves `url` and invokes `callback` exactly once.
     *
     * A late result for a URL the loader has since moved away from is ignored
     * by `GLoader` itself, so an implementation need not cancel anything.
     */
    load(url: string, callback: UIContentLoadCallback): void;
}

let contentLoader: UIContentLoader | null = null;

/** @internal Installed by the backend; see `setAssetResolver` for the pattern. */
export function setUIContentLoader(value: UIContentLoader | null): void {
    contentLoader = value;
}

/** The installed loader, or `null` when external content cannot be fetched. */
export function getUIContentLoader(): UIContentLoader | null {
    return contentLoader;
}

/**
 * A slot that shows a package item, an external asset, or a whole component.
 *
 * The reference mounted a `MovieClip` on a container node and swapped content
 * under it. Here the container is a plain transform node carrying three possible
 * children: the image content, a resolved component, and the error sign.
 *
 * Two of these are split where the reference had one node: the reference could
 * express "no sprite" by clearing a sprite frame, while this seam's
 * `setSprite(null, …)` draws the fill colour instead. The image content is
 * therefore a child of the container and is hidden when it holds nothing, so an
 * empty loader draws nothing rather than a coloured box.
 */
export class GLoader extends GObject {
    /** The image content node; a child of `_container`. */
    public _content: IImageObject;

    private _mc: MovieClip;

    private _url: string | null = '';
    private _align: AlignType = AlignType.Left;
    private _verticalAlign: VertAlignType = VertAlignType.Top;
    private _autoSize = false;
    private _fill: LoaderFillType = LoaderFillType.None;
    private _shrinkOnly = false;
    private _showErrorSign = true;
    private _playing = true;
    private _frame = 0;
    private _color = new Color(255, 255, 255, 255);
    private _contentItem: PackageItem | null = null;
    private _container: IRenderObject;
    private _errorSign: GObject | null = null;
    private _content2: GComponent | null = null;
    private _updatingLayout = false;

    /** The external texture currently drawn, kept for `freeExternal`. */
    private _texture: UILoadedContent | null = null;

    /** Pivot at the last layout, so a pivot change can be noticed. */
    private _lastPivotX = 0;
    private _lastPivotY = 0;

    /** Error signs are recycled by URL, as the reference pooled them. */
    private static _errorSignPool: GObjectPool = new GObjectPool();

    public constructor() {
        super();

        this._container = getRenderFactory().createObject();
        // The reference anchored this node at (0, 1) — origin at the box's
        // top-left. With the anchor inversion gone that is pivot (0, 0); the
        // call is explicit so a backend whose default pivot differs still lands
        // the content on the box's top-left corner.
        this._container.setPivot(0, 0);
        this._node.addChild(this._container);

        this._content = getRenderFactory().createImage();
        this._content.visible = false;
        this._container.addChild(this._content);

        this._mc = new MovieClip(this._content);
        this._mc.setPlaySettings();
    }

    public dispose(): void {
        if (this._contentItem == null && this._texture != null)
            this.freeExternal(this._texture);
        if (this._content2)
            this._content2.dispose();
        super.dispose();
    }

    // ---- url -------------------------------------------------------------

    /**
     * Package (`ui://…`) or external URL. `null`/`''` empties the loader.
     *
     * Typed nullable because `texture` assigns `null` to clear it, which the
     * reference did too — it just had no null checks in the type system.
     */
    public get url(): string | null {
        return this._url;
    }

    public set url(value: string | null) {
        if (this._url === value)
            return;

        this._url = value;
        this.loadContent();
        this.updateGear(7);
    }

    public get icon(): string | null {
        return this._url;
    }

    public set icon(value: string | null) {
        this.url = value;
    }

    // ---- layout options --------------------------------------------------

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

    // ---- animated content ------------------------------------------------

    public get playing(): boolean {
        return this._playing;
    }

    public set playing(value: boolean) {
        if (this._playing !== value) {
            this._playing = value;
            this._mc.playing = value;
            this.updateGear(5);
        }
    }

    public get frame(): number {
        return this._frame;
    }

    public set frame(value: number) {
        if (this._frame !== value) {
            this._frame = value;
            this._mc.frame = value;
            this.updateGear(5);
        }
    }

    /** Driven by the root, like `GMovieClip`; a static texture ignores it. */
    public onUpdate(dt: number): void {
        this._mc.update(dt);
    }

    // ---- appearance ------------------------------------------------------

    public get color(): Color {
        return this._color;
    }

    public set color(value: Color) {
        this._color.copy(value);
        this.updateGear(4);
        // The reference tinted the container node, which in Cocos multiplies
        // down the subtree. Only the image content can carry a tint here, so a
        // resolved component is not tinted.
        this._content.color = value;
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

    public get showErrorSign(): boolean {
        return this._showErrorSign;
    }

    public set showErrorSign(value: boolean) {
        this._showErrorSign = value;
    }

    /** The component built from a package Component item, when that is the content. */
    public get component(): GComponent | null {
        return this._content2;
    }

    /**
     * Externally supplied content.
     *
     * Takes a `UILoadedContent` rather than a bare handle because the layout
     * math needs the content's natural size and a texture handle carries none —
     * the reference read it back off the `cc.SpriteFrame` it was given.
     */
    public get texture(): UILoadedContent | null {
        return this._texture;
    }

    public set texture(value: UILoadedContent | null) {
        this.url = null;

        this._texture = value;
        this.bindTexture(value ? value.texture : null);
        if (value != null) {
            this.sourceWidth = value.width;
            this.sourceHeight = value.height;
        } else {
            this.sourceWidth = this.sourceHeight = 0;
        }

        this.updateLayout();
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
        this._contentItem = UIPackage.getItemByURL(itemURL);
        if (!this._contentItem) {
            this.setErrorState();
            return;
        }

        let resItem = this._contentItem.getBranch();
        this.sourceWidth = resItem.width;
        this.sourceHeight = resItem.height;
        resItem = resItem.getHighResolution();

        if (this._autoSize)
            this.setSize(this.sourceWidth, this.sourceHeight);

        if (resItem.type === PackageItemType.Image) {
            if (!this.bindImageItem(resItem)) {
                // Nothing in the atlas backs this item, so the reference showed
                // the error sign rather than an empty rect.
                this.setErrorState();
                return;
            }
            this.updateLayout();
        } else if (resItem.type === PackageItemType.MovieClip) {
            // Laya switches the source canvas to the selected high-resolution
            // MovieClip item before binding its frames. The frame offsets are
            // authored against this size.
            this.sourceWidth = resItem.width;
            this.sourceHeight = resItem.height;
            this.bindMovieClipItem(resItem);
            this.updateLayout();
        } else if (resItem.type === PackageItemType.Component) {
            const obj = UIPackage.createObjectFromURL(itemURL);
            // Duck-typed rather than `instanceof GComponent`: this module must
            // not need the component class at runtime (see `ObjectFactory`).
            if (!obj || typeof (obj as GComponent).addChild !== 'function') {
                obj?.dispose();
                this.setErrorState();
                return;
            }

            this._content2 = obj as GComponent;
            this._container.addChild(this._content2.node);
            this.updateLayout();
        } else {
            this.setErrorState();
        }
    }

    /**
     * Binds an Image item's atlas region, with its nine-slice or tiling
     * settings.
     *
     * @returns false when the package holds no sprite for the item.
     */
    private bindImageItem(resItem: PackageItem): boolean {
        const owner = resItem.owner;
        const sprite = owner.getSprite(resItem.id);
        if (!sprite)
            return false;

        this.bindTexture(owner.getItemAsset(sprite.atlas), sprite.rect, sprite.rotated ?? false, spriteTrim(sprite));

        // The reference switched the sprite between SIMPLE, SLICED and TILED,
        // and skipped both when a radial or linear fill was in play.
        if (this._content.fillMethod === FillMethod.None) {
            if (resItem.scale9Grid)
                this._content.scale9Grid = resItem.scale9Grid;
            else if (resItem.scaleByTile)
                this._content.scaleByTile = true;
            if (resItem.tileGridIndice != null)
                this._content.tileGridIndice = resItem.tileGridIndice;
        }
        return true;
    }

    /** Points the frame driver at a MovieClip item's timing and frames. */
    private bindMovieClipItem(resItem: PackageItem): void {
        // A clip draws through this loader's own content node, unlike the
        // reference — which mounted it on a container of its own. That node is
        // hidden by `clearContent`, and the image path is the only one that
        // shows it again, so an icon pointing at a movie clip animated away
        // behind a hidden node and never appeared.
        this._content.visible = true;

        const owner = resItem.owner;

        this._mc.frameResolver = (frame: Frame) => {
            if (frame.spriteId == null)
                return null;
            const sprite = owner.getSprite(frame.spriteId);
            if (!sprite)
                return null;
            return {
                texture: owner.getItemAsset(sprite.atlas),
                rect: sprite.rect,
                rotated: sprite.rotated ?? false,
                // Keep the frame's transparent border stable while the heart
                // grows and shrinks. `spriteTrim` describes atlas packing and
                // is not the MovieClip frame offset used by Laya.
                trim: movieClipFrameTrim(frame, resItem.width, resItem.height),
            };
        };

        this._mc.interval = resItem.interval ?? 0;
        this._mc.swing = resItem.swing ?? false;
        this._mc.repeatDelay = resItem.repeatDelay ?? 0;
        this._mc.smoothing = resItem.smoothing ?? true;
        this._mc.frames = resItem.frames ?? null;
    }

    /**
     * Hands the image content a texture, or clears it.
     *
     * Always starts from a clean slate — no nine-slice, no tiling — so that
     * swapping one item for another cannot leave the previous item's scaling
     * behind.
     */
    private bindTexture(texture: unknown | null, rect: Rect | null = null, rotated = false, trim: SpriteTrim | null = null): void {
        if (texture == null) {
            this._content.visible = false;
        } else {
            this._content.scale9Grid = null;
            this._content.scaleByTile = false;
            this._content.tileGridIndice = 0;
            this._content.visible = true;
        }
        this._content.setSprite(texture, rect, rotated, trim);
    }

    protected loadExternal(): void {
        const url = this._url;
        if (url == null)
            return;

        const loader = getUIContentLoader();
        if (!loader) {
            // No loader installed: behave as a failed load, which is what the
            // reference did when an asset never arrived.
            this.onExternalLoadFailed();
            return;
        }

        loader.load(url, (err, content) => {
            // The URL may have changed while this was in flight; the reference
            // discarded such results and so does this.
            if (this._url !== url || this.disposed)
                return;

            if (err)
                console.warn(err);

            if (content)
                this.onExternalLoadSuccess(content);
            else
                this.onExternalLoadFailed();
        });
    }

    /** Override to release a texture the backend handed out. */
    protected freeExternal(_texture: UILoadedContent): void {
    }

    protected onExternalLoadSuccess(content: UILoadedContent): void {
        this._texture = content;
        this.bindTexture(content.texture);
        this.sourceWidth = content.width;
        this.sourceHeight = content.height;
        if (this._autoSize)
            this.setSize(this.sourceWidth, this.sourceHeight);
        this.updateLayout();
    }

    /**
     * The reference defined this but never called it — its asset callback only
     * acted on a successful load, so a failure left the loader blank and the
     * error sign unreachable. `UIConfig.loaderErrorSign` and `showErrorSign`
     * only make sense if a failed load reports itself, so this port calls it.
     */
    protected onExternalLoadFailed(): void {
        this.setErrorState();
    }

    // ---- error sign ------------------------------------------------------

    private setErrorState(): void {
        if (!this._showErrorSign)
            return;

        if (this._errorSign == null) {
            if (UIConfig.loaderErrorSign != null)
                this._errorSign = GLoader._errorSignPool.getObject(UIConfig.loaderErrorSign);
        }

        if (this._errorSign) {
            this._errorSign.setSize(this.width, this.height);
            this._container.addChild(this._errorSign.node);
        }
    }

    private clearErrorState(): void {
        if (this._errorSign) {
            this._container.removeChild(this._errorSign.node);
            GLoader._errorSignPool.returnObject(this._errorSign);
            this._errorSign = null;
        }
    }

    // ---- layout ----------------------------------------------------------

    private updateLayout(): void {
        let cw = this.sourceWidth;
        let ch = this.sourceHeight;

        // The reference's `pivotCorrectY` was positive because Cocos is y-up;
        // here the container's origin is the box's top-left corner in a y-down
        // space, which puts it at `-pivotY * height`.
        const pivotCorrectX = -this.pivotX * this._width;
        const pivotCorrectY = -this.pivotY * this._height;

        if (this._autoSize) {
            this._updatingLayout = true;
            if (cw === 0)
                cw = 50;
            if (ch === 0)
                ch = 30;

            this.setSize(cw, ch);
            this._updatingLayout = false;

            this._container.setContentSize(this._width, this._height);
            this._content.setContentSize(this._width, this._height);
            this._container.setPosition(pivotCorrectX, pivotCorrectY);
            if (this._content2) {
                // The reference's expression here reduced to zero in Cocos too —
                // the pivot correction cancelled against itself.
                this._content2.setPosition(0, 0);
                this._content2.setScale(1, 1);
            }
            if (cw === this._width && ch === this._height)
                return;
        }

        let sx = 1;
        let sy = 1;
        if (this._fill !== LoaderFillType.None) {
            sx = this.width / this.sourceWidth;
            sy = this.height / this.sourceHeight;

            if (sx !== 1 || sy !== 1) {
                if (this._fill === LoaderFillType.ScaleMatchHeight)
                    sx = sy;
                else if (this._fill === LoaderFillType.ScaleMatchWidth)
                    sy = sx;
                else if (this._fill === LoaderFillType.Scale) {
                    if (sx > sy)
                        sx = sy;
                    else
                        sy = sx;
                } else if (this._fill === LoaderFillType.ScaleNoBorder) {
                    if (sx > sy)
                        sy = sx;
                    else
                        sx = sy;
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

        this._container.setContentSize(cw, ch);
        this._content.setContentSize(cw, ch);
        if (this._content2) {
            this._content2.setPosition(0, 0);
            this._content2.setScale(sx, sy);
        }

        let nx: number;
        let ny: number;
        if (this._align === AlignType.Left)
            nx = 0;
        else if (this._align === AlignType.Center)
            nx = Math.floor((this._width - cw) / 2);
        else
            nx = this._width - cw;
        if (this._verticalAlign === VertAlignType.Top)
            ny = 0;
        else if (this._verticalAlign === VertAlignType.Middle)
            ny = Math.floor((this._height - ch) / 2);
        else
            ny = this._height - ch;
        // Not negated: the container's origin is its top-left here, where the
        // reference's was its bottom-left.
        this._container.setPosition(pivotCorrectX + nx, pivotCorrectY + ny);
    }

    private clearContent(): void {
        this.clearErrorState();

        if (!this._contentItem && this._texture != null)
            this.freeExternal(this._texture);
        this._texture = null;

        if (this._content2) {
            this._container.removeChild(this._content2.node);
            this._content2.dispose();
            this._content2 = null;
        }
        this._mc.frames = null;
        this._mc.frameResolver = null;
        this._content.visible = false;
        this._content.setSprite(null, null, false);
        this._contentItem = null;
    }

    protected handleSizeChanged(): void {
        super.handleSizeChanged();

        if (!this._updatingLayout)
            this.updateLayout();
    }

    /**
     * Stands in for the reference's `handleAnchorChanged`: the pivot feeds the
     * layout offsets, so a pivot change has to re-run the layout. The seam has
     * no pivot-change hook, so the pivot is compared here, where every position
     * change already lands.
     */
    protected handlePositionChanged(): void {
        super.handlePositionChanged();

        if (this._lastPivotX !== this._node.pivotX || this._lastPivotY !== this._node.pivotY) {
            this._lastPivotX = this._node.pivotX;
            this._lastPivotY = this._node.pivotY;
            if (!this._updatingLayout)
                this.updateLayout();
        }
    }

    protected handleGrayedChanged(): void {
        this._content.grayed = this._grayed;
    }

    protected _hitTest(pt: Point, globalPt: Point): GObject | null {
        if (this._content2) {
            const obj = this._content2.hitTest(globalPt);
            if (obj)
                return obj;
        }

        if (pt.x >= 0 && pt.y >= 0 && pt.x < this._width && pt.y < this._height)
            return this;
        return null;
    }

    // ---- properties by index ---------------------------------------------

    public getProp(index: number): unknown {
        switch (index) {
            case ObjectPropID.Color:
                return this.color;
            case ObjectPropID.Playing:
                return this.playing;
            case ObjectPropID.Frame:
                return this.frame;
            case ObjectPropID.TimeScale:
                return this._mc.timeScale;
            default:
                return super.getProp(index);
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
                this._mc.timeScale = value as number;
                break;
            case ObjectPropID.DeltaTime:
                this._mc.advance(value as number);
                break;
            default:
                super.setProp(index, value);
                break;
        }
    }

    // ---- construction from package data ----------------------------------

    public setup_beforeAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_beforeAdd(buffer, beginPos);

        buffer.seek(beginPos, 5);

        this._url = buffer.readS();
        this._align = buffer.readByte();
        this._verticalAlign = buffer.readByte();
        this._fill = buffer.readByte();
        this._shrinkOnly = buffer.readBool();
        this._autoSize = buffer.readBool();
        this._showErrorSign = buffer.readBool();
        this._playing = buffer.readBool();
        this._frame = buffer.readInt();

        if (buffer.readBool())
            this.color = buffer.readColor();
        this._content.fillMethod = buffer.readByte();
        if (this._content.fillMethod !== FillMethod.None) {
            this._content.fillOrigin = buffer.readByte();
            this._content.fillClockwise = buffer.readBool();
            this._content.fillAmount = buffer.readFloat();
        }

        if (this._url)
            this.loadContent();
    }
}
