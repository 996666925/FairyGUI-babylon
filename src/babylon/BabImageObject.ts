import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import { FillMethod, FillOrigin, FlipType } from '../core/FieldTypes.js';
import type { SpriteTrim } from '../core/render/IRenderObject.js';
import { Color } from '../core/utils/Color.js';
import { Rect } from '../core/utils/Geometry.js';
import type { IImageObject } from '../core/render/IRenderObject.js';
import { BabRenderObject } from './BabRenderObject.js';
import type { BabylonRenderer } from './BabylonRenderer.js';
import {
    fillPolygon,
    GeometryBuilder,
    nineSliceRegions,
    SpriteMapping,
    tileRegions,
    triangulatePolygon,
    type SpriteRegion,
    type UV,
} from './GeometryBuilder.js';

/**
 * A backend texture plus the pixel size the same resolver measured.
 *
 * `texture` may also be passed on its own when it can report its own size, which
 * covers Babylon's `Texture`, `DynamicTexture` and `RawTexture`.
 */
export interface BabTextureHandle {
    texture: BaseTexture;
    width: number;
    height: number;
}

/**
 * Duck-typed check for a Babylon texture, without importing the class as a value.
 *
 * `isReady` is part of the test on purpose: `ShaderMaterial` calls it for every
 * sampler uniform, so an object that looks like a texture but lacks it fails
 * deep inside Babylon's bind path. Rejecting it here turns that into a clear
 * message at the point `setSprite` was called.
 */
function isBaseTexture(value: unknown): value is BaseTexture {
    const candidate = value as Partial<BaseTexture> | null;
    return !!candidate
        && typeof candidate.getSize === 'function'
        && typeof candidate.getScene === 'function'
        && typeof candidate.getInternalTexture === 'function'
        && typeof candidate.isReady === 'function';
}

/**
 * Normalises whatever the asset resolver handed back.
 *
 * Accepts a `BabTextureHandle`, a bare `BaseTexture` (its `getSize()` is
 * consulted), or `null`. Anything else is rejected with a message rather than
 * silently drawing nothing.
 */
export function resolveTextureHandle(value: unknown): BabTextureHandle | null {
    if (value === null || value === undefined)
        return null;

    if (isBaseTexture(value)) {
        const size = value.getSize();
        return { texture: value, width: size.width, height: size.height };
    }

    const candidate = value as Partial<BabTextureHandle>;
    if (isBaseTexture(candidate.texture)) {
        const width = typeof candidate.width === 'number' && candidate.width > 0
            ? candidate.width
            : candidate.texture.getSize().width;
        const height = typeof candidate.height === 'number' && candidate.height > 0
            ? candidate.height
            : candidate.texture.getSize().height;
        return { texture: candidate.texture, width, height };
    }

    throw new Error('fairygui-babylon: setSprite() expects a BaseTexture, a { texture, width, height } handle, or null.');
}

/**
 * A textured quad.
 *
 * Every appearance variant — atlas sub-rect, 90°-rotated region, nine-slice,
 * grid tiling, mirroring and progress fill — is resolved into a set of quads (or
 * one polygon) in *content space* before the mesh is uploaded. Nothing is faked
 * in the shader, so all of it keeps working under an arbitrary ancestor rotation
 * and with the object's own skew baked into the same vertices.
 *
 * The texture is never resampled: a nine-slice corner, a tile, and a stretched
 * centre all sample the atlas through the same affine UV mapping.
 */
export class BabImageObject extends BabRenderObject implements IImageObject {
    /**
     * Appearance, all of it baked into the vertices when the mesh is built.
     *
     * These are accessors rather than plain fields because a widget may change
     * one *after* the geometry exists — a progress bar writes `fillAmount` every
     * frame it animates. A plain field left the mesh showing whatever was built
     * first: the bar's value moved, and its fill never did.
     */
    private _scale9Grid: Rect | null = null;
    private _scaleByTile = false;
    private _tileGridIndice = 0;
    private _flip: FlipType = FlipType.None;
    private _fillMethod: FillMethod = FillMethod.None;
    private _fillOrigin: FillOrigin = FillOrigin.Top;
    private _fillClockwise = true;
    private _fillAmount = 1;

    /** Borders a nine-slice stretches between. */
    public get scale9Grid(): Rect | null {
        return this._scale9Grid;
    }

    public set scale9Grid(value: Rect | null) {
        if (this._scale9Grid === value)
            return;
        this._scale9Grid = value;
        this.invalidateGeometry();
    }

    public get scaleByTile(): boolean {
        return this._scaleByTile;
    }

    public set scaleByTile(value: boolean) {
        if (this._scaleByTile === value)
            return;
        this._scaleByTile = value;
        this.invalidateGeometry();
    }

    public get tileGridIndice(): number {
        return this._tileGridIndice;
    }

    public set tileGridIndice(value: number) {
        if (this._tileGridIndice === value)
            return;
        this._tileGridIndice = value;
        this.invalidateGeometry();
    }

    public get flip(): FlipType {
        return this._flip;
    }

    public set flip(value: FlipType) {
        if (this._flip === value)
            return;
        this._flip = value;
        this.invalidateGeometry();
    }

    public get fillMethod(): FillMethod {
        return this._fillMethod;
    }

    public set fillMethod(value: FillMethod) {
        if (this._fillMethod === value)
            return;
        this._fillMethod = value;
        this.invalidateGeometry();
    }

    public get fillOrigin(): FillOrigin {
        return this._fillOrigin;
    }

    public set fillOrigin(value: FillOrigin) {
        if (this._fillOrigin === value)
            return;
        this._fillOrigin = value;
        this.invalidateGeometry();
    }

    public get fillClockwise(): boolean {
        return this._fillClockwise;
    }

    public set fillClockwise(value: boolean) {
        if (this._fillClockwise === value)
            return;
        this._fillClockwise = value;
        this.invalidateGeometry();
    }

    /** How much of the shape is drawn, from `0` to `1`. */
    public get fillAmount(): number {
        return this._fillAmount;
    }

    public set fillAmount(value: number) {
        if (this._fillAmount === value)
            return;
        this._fillAmount = value;
        this.invalidateGeometry();
    }

    /** Shape the hit test against, rather than the bounding box. */
    public hitTestShape: ((x: number, y: number) => boolean) | null = null;

    private _handle: BabTextureHandle | null = null;
    private readonly _mapping = new SpriteMapping();
    /** The sprite arguments, kept so the mapping can be rebuilt once sized. */
    private _spriteRect: Rect | null = null;
    private _spriteRotated = false;
    /** Where the sprite sat in the untrimmed image; all zero for a whole one. */
    private _trim: SpriteTrim | null = null;
    /**
     * Set when the handle's size came from a texture that had not loaded yet, so
     * the UVs are placeholders until it does.
     */
    private _awaitingTexture = false;
    /** Scratch for the normalised fill ring. */
    private readonly _fillRing: number[] = [];
    /** Scratch for triangulation indices, remapped to builder vertex ids. */
    private readonly _fillIndices: number[] = [];

    public constructor(renderer: BabylonRenderer, name: string) {
        super(renderer, name);
        this.color = new Color(255, 255, 255, 255);
    }

    public setSprite(texture: unknown | null, rect: Rect | null, rotated: boolean, trim: SpriteTrim | null = null): void {
        // A bare texture has no size of its own until it loads, so its handle is
        // the one that benefits from being refreshed later. A caller passing a
        // handle has already stated the dimensions — usually a deliberate slice
        // — and those must not be overwritten with the whole texture's size.
        const sizeFromTexture = isBaseTexture(texture);

        this._handle = resolveTextureHandle(texture);
        this._spriteRect = rect;
        this._spriteRotated = rotated;
        this._trim = trim;
        this._awaitingTexture = sizeFromTexture && !!this._handle && !this._handle.texture.isReady();

        if (this._handle)
            this._mapping.set(rect, this._handle.width, this._handle.height, rotated);
        else
            this._mapping.set(null, 1, 1, false);

        this.invalidateGeometry();
    }

    /**
     * Re-derives the mapping once the texture has real dimensions.
     *
     * A `Texture` exists before its image does, and `getSize()` reports a
     * placeholder until the pixels arrive — dividing pixel coordinates by that
     * placeholder pushes every UV far out of `[0, 1]`, which samples the wrong
     * part of the atlas. The geometry is built once and cached, so without a
     * rebuild the damage would be permanent.
     *
     * @returns `false` while the size is still a placeholder, meaning there is
     *   nothing worth drawing yet.
     */
    private _resolveTextureSize(): boolean {
        if (!this._awaitingTexture)
            return true;

        const texture = this._handle?.texture;
        if (!texture || !texture.isReady())
            return false;

        this._awaitingTexture = false;
        const size = texture.getSize();
        this._mapping.set(this._spriteRect, size.width, size.height, this._spriteRotated);
        return true;
    }

    public override getTexture(): unknown {
        return this._handle;
    }

    protected override textureForDraw(): BaseTexture {
        return this._handle ? this._handle.texture : this.renderer.whiteTexture;
    }

    protected override hitTestContent(x: number, y: number): boolean {
        return this.hitTestShape ? this.hitTestShape(x, y) : true;
    }

    // ---- geometry --------------------------------------------------------

    protected override buildGeometry(builder: GeometryBuilder): void {
        const w = this._contentWidth;
        const h = this._contentHeight;
        if (w <= 0 || h <= 0)
            return;

        if (!this._resolveTextureSize()) {
            // Drawing now would use placeholder dimensions. Asking to be rebuilt
            // means the mesh appears the frame the atlas does, with correct UVs.
            this.invalidateGeometry();
            return;
        }

        const hasTexture = this._handle !== null && !this._mapping.isEmpty();
        if (!hasTexture) {
            // No texture means "solid fill of `color`", which is how a `GGraph`
            // background is expressed through an image object.
            builder.addQuad(0, 0, w, 0, w, h, 0, h, 0, 0, 1, 0, 1, 1, 0, 1);
            return;
        }

        // Where the artwork goes inside the node's box. The box is the size the
        // editor gave the object — the *untrimmed* image — so a sprite the editor
        // trimmed is drawn inset by the margin it lost rather than stretched over
        // it. Untrimmed sprites come out as the whole box, unchanged.
        const box = this.sourceBox(w, h);

        if (this.fillMethod !== FillMethod.None) {
            this.buildFill(builder, box);
            return;
        }

        const srcW = this._mapping.width;
        const srcH = this._mapping.height;

        let regions: SpriteRegion[];
        if (this.scaleByTile)
            regions = tileRegions(box.width, box.height, srcW, srcH, this.scale9Grid, this.tileGridIndice);
        else if (this.scale9Grid)
            regions = nineSliceRegions(box.width, box.height, srcW, srcH, this.scale9Grid);
        else
            regions = [{ srcX: 0, srcY: 0, srcW, srcH, dstX: 0, dstY: 0, dstW: box.width, dstH: box.height }];

        for (const region of regions) {
            region.dstX += box.x;
            region.dstY += box.y;
            this.emitRegion(builder, region);
        }
    }

    /**
     * The rectangle the artwork itself occupies, within the node's box.
     *
     * A node's box is the size the editor gave the object, and a sprite the
     * editor trimmed no longer covers it: the pixels that were cut came off the
     * edges, and the record of where the rest sat is the sprite's offset. Scaling
     * that offset and size with the box keeps a stretched image right too — a
     * nine-slice band, or an object resized by hand.
     */
    private sourceBox(w: number, h: number): Rect {
        const trim = this._trim;
        const rect = this._spriteRect;
        if (!trim || !rect || trim.originalWidth <= 0 || trim.originalHeight <= 0)
            return new Rect(0, 0, w, h);

        const sx = w / trim.originalWidth;
        const sy = h / trim.originalHeight;
        // The displayed size of the region, which swaps for a rotated sprite.
        const rw = this._mapping.width;
        const rh = this._mapping.height;
        return new Rect(trim.x * sx, trim.y * sy, rw * sx, rh * sy);
    }

    /** Emits one quad for a source sub-rect stretched into its destination band. */
    private emitRegion(builder: GeometryBuilder, region: SpriteRegion): void {
        const srcW = this._mapping.width;
        const srcH = this._mapping.height;
        if (srcW <= 0 || srcH <= 0)
            return;

        const s0 = region.srcX / srcW;
        const t0 = region.srcY / srcH;
        const s1 = (region.srcX + region.srcW) / srcW;
        const t1 = (region.srcY + region.srcH) / srcH;

        const x0 = region.dstX;
        const y0 = region.dstY;
        const x1 = region.dstX + region.dstW;
        const y1 = region.dstY + region.dstH;

        const uv: UV = { u: 0, v: 0 };
        // Corners in on-screen clockwise order: top-left, top-right,
        // bottom-right, bottom-left. Positions are never mirrored — only the UVs
        // are — so a mirrored nine-slice keeps its corners where they belong.
        const sa = this._flipS(s0);
        const sb = this._flipS(s1);
        const ta = this._flipT(t0);
        const tb = this._flipT(t1);

        this._mapping.uv(sa, ta, uv);
        const u0 = uv.u;
        const v0 = uv.v;
        this._mapping.uv(sb, ta, uv);
        const u1 = uv.u;
        const v1 = uv.v;
        this._mapping.uv(sb, tb, uv);
        const u2 = uv.u;
        const v2 = uv.v;
        this._mapping.uv(sa, tb, uv);
        const u3 = uv.u;
        const v3 = uv.v;

        builder.addQuad(x0, y0, x1, y0, x1, y1, x0, y1, u0, v0, u1, v1, u2, v2, u3, v3);
    }

    /**
     * Builds the progress fill.
     *
     * `fillPolygon` returns a ring in normalised sprite space; it is mapped onto
     * the content box for positions and through the atlas mapping for UVs, then
     * ear-clipped. A linear fill degenerates to a single quad, so both paths share
     * this code.
     */
    private buildFill(builder: GeometryBuilder, box: Rect): void {
        const ring = fillPolygon(
            this.fillMethod,
            this.fillOrigin,
            this.fillClockwise,
            this.fillAmount,
            this._fillRing,
        );

        const n = ring.length / 2;
        if (n < 3)
            return;

        const uv: UV = { u: 0, v: 0 };
        const first = builder.vertexCount;
        for (let i = 0; i < n; i++) {
            const s = ring[i * 2];
            const t = ring[i * 2 + 1];
            this._mapping.uv(this._flipS(s), this._flipT(t), uv);
            builder.addVertex(box.x + s * box.width, box.y + t * box.height, uv.u, uv.v);
        }

        this._fillIndices.length = 0;
        triangulatePolygon(ring, this._fillIndices);
        for (let i = 0; i < this._fillIndices.length; i++)
            builder.indices.push(first + this._fillIndices[i]);
    }

    private _flipS(s: number): number {
        return this.flip === FlipType.Horizontal || this.flip === FlipType.Both ? 1 - s : s;
    }

    private _flipT(t: number): number {
        return this.flip === FlipType.Vertical || this.flip === FlipType.Both ? 1 - t : t;
    }

    /** The atlas mapping in use, exposed for tests and diagnostics. */
    public get mapping(): SpriteMapping {
        return this._mapping;
    }
}
