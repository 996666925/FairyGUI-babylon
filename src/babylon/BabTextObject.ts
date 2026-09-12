// `DynamicTexture` needs an engine capability, `engine.createDynamicTexture`,
// that Babylon installs as a prototype patch rather than as part of the class.
// It must be registered explicitly.
//
// The registration is invoked by name rather than left to a bare
// `import '…/engine.dynamicTexture.js'`. A side-effect-only import of a module
// with no used bindings is exactly what a bundler is entitled to drop, and in
// practice it does: under Vite the bare form silently did nothing, and the
// failure only surfaces when something first rasterises text. Naming the export
// makes the call unremovable, and the `.pure` module has no side effects of its
// own beyond the one being asked for.
import { RegisterEnginesExtensionsEngineDynamicTexture } from '@babylonjs/core/Engines/Extensions/engine.dynamicTexture.pure.js';

RegisterEnginesExtensionsEngineDynamicTexture();

import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { AlignType, AutoSizeType, VertAlignType } from '../core/FieldTypes.js';
import { openNativeInput, closeNativeInput, type CanvasOffsetLike } from './TextInput.js';
import { Color } from '../core/utils/Color.js';
import type { ITextObject } from '../core/render/IRenderObject.js';
import type { ITextInputObject } from '../core/GTextInput.js';
import type { Rect } from '../core/utils/Geometry.js';
import type { BitmapFont, BitmapGlyphSource } from '../core/display/BitmapFont.js';
import type { PackageItem } from '../core/PackageItem.js';
import { BabRenderObject } from './BabRenderObject.js';
import { resolveTextureHandle, type BabTextureHandle } from './BabImageObject.js';
import type { BabylonRenderer } from './BabylonRenderer.js';
import { GeometryBuilder, SpriteMapping, type UV } from './GeometryBuilder.js';
import {
    BitmapTextMetrics,
    CanvasTextMetrics,
    layoutText,
    lineOffsetX,
    lineOffsetY,
    normalizeNewlines,
    stripMarkup,
    type Canvas2DContextLike,
    type TextLayout,
    type TextLink,
} from './TextLayout.js';

/**
 * A text surface.
 *
 * Layout is delegated to `TextLayout`, a pure function over an injected metrics
 * provider, so `measureTextWidth()` / `measureTextHeight()` answer correctly in
 * Node — before anything is rasterised and before the core has committed a size.
 * The `DynamicTexture` is *only* the rasterisation target: created and redrawn
 * lazily, and only when a canvas is actually available.
 *
 * ### How staleness is detected
 *
 * `ITextObject`'s fields are plain properties that the core writes directly, so
 * there is nothing to hook a setter onto. Instead the object snapshots the values
 * the current layout was built from and compares them; a mismatch re-lays-out.
 * That is robust against any mutation path, including a host poking the fields,
 * and costs one comparison per frame once the text is settled.
 *
 * ### Resolution
 *
 * `textureScale` multiplies the rasterisation size while leaving every layout
 * number in UI units: the canvas is `ceil(layout × scale)` pixels, the context is
 * scaled by the same factor, and the quad still covers the unscaled box. Putting
 * the multiplier on the raster rather than the layout is what keeps
 * `measureTextWidth()` comparable with `GRoot`'s coordinate space.
 */
/** Serial for rasterisation texture names; see `ensureRasterised`. */
let _textureSerial = 0;

/**
 * What the raster paints the glyphs in.
 *
 * White and opaque, because the field's colour and opacity are applied when the
 * mesh is drawn — as the `uTint` uniform — rather than baked into the pixels.
 * Painting them in as well multiplies them twice.
 */
const RASTER_INK = new Color(255, 255, 255, 255);

/** Laya's `Text.padding` is `[2, 2, 2, 2]`. */
const TEXT_LAYOUT_PADDING = 2;

export class BabTextObject extends BabRenderObject implements ITextObject, ITextInputObject {
    public text = '';
    public font: string | null = null;
    public fontSize = 12;
    public fontStyle = '';
    public align: number = AlignType.Left;
    public verticalAlign: number = VertAlignType.Top;
    public rich = false;
    public singleLine = false;
    public letterSpacing = 0;
    public leading = 3;
    public underline = false;
    public autoSize: number = AutoSizeType.None;
    public wrapWidth = 0;

    /** Outline thickness in pixels; `0` disables the outline. */
    public stroke = 0;
    public strokeColor = new Color(0, 0, 0, 255);
    /** Drop-shadow offset in pixels; `(0, 0)` disables the shadow. */
    public shadowOffsetX = 0;
    public shadowOffsetY = 0;
    public shadowColor = new Color(0, 0, 0, 255);

    public onLinkClick: ((href: string) => void) | null = null;

    // ---- text input ------------------------------------------------------
    //
    // A canvas has no caret, selection, clipboard or IME, so an editable field
    // is backed by a real DOM input laid over it; see `openKeyboard`.

    public editable = false;
    public maxLength = -1;
    public password = false;
    public promptText = '';
    /** Invoked when the user edits the text through the overlay. */
    public onTextChanged: ((text: string) => void) | null = null;
    /** Invoked when the user presses Enter. */
    public onSubmit: ((text: string, keyCode: number) => void) | null = null;

    private _inputOpen = false;

    /** The package font this field draws with, set by the core. */
    public bitmapFont: BitmapFont | null = null;

    /** Reused so a field does not allocate a provider per layout. */
    private _bitmapMetrics: BitmapTextMetrics | null = null;
    /** The atlas the glyphs are cut from, resolved once per font. */
    private _bitmapAtlas: PackageItem | null = null;
    private _bitmapHandle: BabTextureHandle | null = null;
    /** The font `_bitmapAtlas` belongs to, so a font change re-resolves it. */
    private _bitmapFontOf: BitmapFont | null = null;
    /** Set while the atlas texture exists but has not loaded; see `_resolveBitmapAtlas`. */
    private _bitmapAwaiting = false;
    private readonly _bitmapMapping = new SpriteMapping();
    private readonly _glyphUV: UV = { u: 0, v: 0 };

    private _textureScale = 1;
    private _texture: DynamicTexture | null = null;
    private _textureWidth = 0;
    private _textureHeight = 0;
    /** Margin baked into the current texture, in texels. Symmetric. */
    private _rasterPadX = 0;
    /** The same margin in UI units, which is what the quad is grown by. */
    private _rasterPadUI = 0;
    /** What the texture currently holds, so a redraw is skipped when nothing moved. */
    private _rasterisedLayout: TextLayout | null = null;
    private _rasterisedScale = -1;
    private _rasterisedStyle = '';

    private _layout: TextLayout | null = null;
    private _layoutRecomputed = false;
    /** Text as laid out: markup removed, newlines normalised. */
    private _plainText = '';
    private _links: TextLink[] = [];

    private readonly _sig = {
        text: '',
        font: null as string | null,
        bitmapFont: null as BitmapFont | null,
        fontSize: 0,
        fontStyle: '',
        align: -1,
        verticalAlign: -1,
        rich: false,
        singleLine: false,
        letterSpacing: 0,
        leading: 0,
        autoSize: -1,
        wrapWidth: -1,
        boxWidth: -1,
        boxHeight: -1,
    };

    public constructor(renderer: BabylonRenderer, name: string) {
        super(renderer, name);
        this.color = new Color(255, 255, 255, 255);
        // Rasterise at the display's density by default. The viewport is laid
        // out in CSS pixels while the backbuffer is not, so a one-for-one raster
        // is magnified on a high-density screen and reads as soft.
        this._textureScale = renderer.pixelRatio;
    }

    public get textureScale(): number {
        return this._textureScale;
    }

    public set textureScale(value: number) {
        const scale = value > 0 ? value : 1;
        if (this._textureScale === scale)
            return;
        this._textureScale = scale;
        this.invalidateGeometry();
    }

    /** `true` when this object can actually rasterise (a canvas factory exists). */
    public get canRasterise(): boolean {
        return this.renderer.canvasFactory !== null;
    }

    // ---- measurement -----------------------------------------------------

    /**
     * Lays the text out, reusing the previous result when nothing changed.
     *
     * Deliberately never touches the `DynamicTexture` or the mesh: the core calls
     * this to size the object, and only commits through `setContentSize`.
     */
    public ensureLayout(): TextLayout {
        this._layoutRecomputed = false;
        if (this._layout && !this.signatureChanged())
            return this._layout;

        // Taken before laying out, not after: the comparison above only runs once
        // there is a layout to compare against, so a first pass that skipped this
        // would leave the snapshot at its initial values — and the *next* call
        // would find a difference that is not there, laying the text out and
        // repainting it a second time.
        this.recordSignature();

        if (this.rich) {
            const stripped = stripMarkup(this.text);
            this._plainText = normalizeNewlines(stripped.text);
            this._links = stripped.links;
        } else {
            this._plainText = normalizeNewlines(this.text);
            this._links = [];
        }

        // A package font measures from its own glyph table, and the layout
        // module only reads the provider — so wrapping, alignment and the
        // auto-size modes all work unchanged for one.
        const font = this.bitmapFontForDraw();
        const metrics = font ? this.bitmapMetrics(font) : this.renderer.textMetrics;

        const layout = layoutText({
            text: this._plainText,
            style: { font: this.font, fontSize: this.fontSize, fontStyle: this.fontStyle },
            align: this.align,
            verticalAlign: this.verticalAlign,
            singleLine: this.singleLine,
            letterSpacing: this.letterSpacing,
            leading: this.leading,
            wrapWidth: this.wrapWidth,
            autoSize: this.autoSize,
            boxWidth: this.contentWidth,
            boxHeight: this.contentHeight,
        }, metrics);

        this._layout = layout;
        this._layoutRecomputed = true;
        return layout;
    }

    /** Whether the layout was recomputed by the last `ensureLayout` call. */
    public get layoutRecomputed(): boolean {
        return this._layoutRecomputed;
    }

    /** Compares the live fields against the ones the layout was built from. */
    private signatureChanged(): boolean {
        const s = this._sig;
        const changed = s.text !== this.text
            || s.font !== this.font
            || s.bitmapFont !== this.bitmapFont
            || s.fontSize !== this.fontSize
            || s.fontStyle !== this.fontStyle
            || s.align !== this.align
            || s.verticalAlign !== this.verticalAlign
            || s.rich !== this.rich
            || s.singleLine !== this.singleLine
            || s.letterSpacing !== this.letterSpacing
            || s.leading !== this.leading
            || s.autoSize !== this.autoSize
            || s.wrapWidth !== this.wrapWidth
            || s.boxWidth !== this.contentWidth
            || s.boxHeight !== this.contentHeight;
        if (changed)
            this.recordSignature();
        return changed;
    }

    /** Copies the fields a layout depends on, so the next call can compare. */
    private recordSignature(): void {
        const s = this._sig;
        s.text = this.text;
        s.font = this.font;
        s.bitmapFont = this.bitmapFont;
        s.fontSize = this.fontSize;
        s.fontStyle = this.fontStyle;
        s.align = this.align;
        s.verticalAlign = this.verticalAlign;
        s.rich = this.rich;
        s.singleLine = this.singleLine;
        s.letterSpacing = this.letterSpacing;
        s.leading = this.leading;
        s.autoSize = this.autoSize;
        s.wrapWidth = this.wrapWidth;
        s.boxWidth = this.contentWidth;
        s.boxHeight = this.contentHeight;
    }

    public measureTextWidth(): number {
        return this.ensureLayout().boxWidth;
    }

    public measureTextHeight(): number {
        return this.ensureLayout().boxHeight;
    }

    // ---- geometry --------------------------------------------------------

    protected override buildGeometry(builder: GeometryBuilder): void {
        const layout = this.ensureLayout();

        // While the DOM overlay is open it owns the text, caret and selection
        // alike; drawing the raster underneath would show the same string twice.
        if (this._inputOpen)
            return;

        const font = this.bitmapFontForDraw();
        if (font) {
            this.buildBitmapGeometry(builder, font, layout);
            return;
        }

        if (!this.canRasterise || layout.lines.length === 0)
            return; // no rasteriser, or nothing to show
        if (layout.textWidth <= 0 || layout.textHeight <= 0)
            return;

        const x = this.blockOffsetX(layout) + this.textPaddingOffsetX();
        const y = lineOffsetY(layout.textHeight, this.contentHeight, this.verticalAlign)
            + this.textPaddingOffsetY();

        // The raster carries a margin of transparent texels around the laid-out
        // block, so glyph ink that overhangs its advance box has somewhere to
        // land. The quad grows by the same margin and samples the whole texture,
        // which is what makes that ink visible: both grew together, so the text
        // still falls exactly where the layout put it, and an ink overhang is
        // drawn rather than sliced off.
        const pad = this._rasterPadUI;
        builder.addQuad(
            x - pad, y - pad,
            x + layout.textWidth + pad, y - pad,
            x + layout.textWidth + pad, y + layout.textHeight + pad,
            x - pad, y + layout.textHeight + pad,
            0, 0, 1, 0, 1, 1, 0, 1,
        );
    }

    /**
     * Transparent margin around the raster, in UI units.
     *
     * `measureText().width` is an *advance* width: the ink of a glyph may start
     * left of its origin or run past its advance. Drawing straight into a
     * texture sized to the advance shaves that overhang off, which shows up as
     * characters with their first stroke clipped. Scaled with the font so it
     * stays proportionate, and never smaller than a couple of pixels.
     */
    private get padding(): number {
        // Ink that overhangs the advance box, plus what the outline and the drop
        // shadow add: a stroke straddles the glyph edge at half its width, and a
        // shadow is drawn a whole offset away. The margin is symmetric, so the
        // larger offset covers a shadow in any direction.
        const outline = Math.max(0, this.stroke) / 2;
        const shadow = Math.max(Math.abs(this.shadowOffsetX), Math.abs(this.shadowOffsetY));
        return Math.max(2, Math.ceil(this.fontSize * 0.15 + outline + shadow));
    }

    /** Horizontal placement of the laid-out block inside the content box. */
    private blockOffsetX(layout: TextLayout): number {
        if (this.align === AlignType.Center)
            return (this.contentWidth - layout.textWidth) / 2;
        if (this.align === AlignType.Right)
            return this.contentWidth - layout.textWidth;
        return 0;
    }

    /**
     * Applies Laya's symmetric padding without moving centred text. For a
     * right/bottom aligned line the trailing padding is reserved instead.
     */
    private textPaddingOffsetX(): number {
        if (this.align === AlignType.Right)
            return -TEXT_LAYOUT_PADDING;
        if (this.align === AlignType.Center)
            return 0;
        return TEXT_LAYOUT_PADDING;
    }

    private textPaddingOffsetY(): number {
        if (this.verticalAlign === VertAlignType.Bottom)
            return -TEXT_LAYOUT_PADDING;
        if (this.verticalAlign === VertAlignType.Middle)
            return 0;
        return TEXT_LAYOUT_PADDING;
    }

    public override getTexture(): unknown {
        return this._texture;
    }

    protected override textureForDraw(): BaseTexture {
        if (this.bitmapFontForDraw() && this._bitmapHandle)
            return this._bitmapHandle.texture;
        return this._texture ?? this.renderer.whiteTexture;
    }

    /** The atlas a package font's glyphs are sampled from, once it is resolved. */
    public get bitmapAtlasTexture(): BaseTexture | null {
        return this.bitmapFontForDraw() ? this._bitmapHandle?.texture ?? null : null;
    }

    // ---- bitmap fonts ----------------------------------------------------

    /**
     * The package font to draw glyphs for, or `null` to use the raster path.
     *
     * Rich text is excluded: its markup is flattened before layout here, so
     * there are no runs for a mixed-font layout to hang off — and the reference
     * never drew a bitmap glyph through its rich text either.
     */
    private bitmapFontForDraw(): BitmapFont | null {
        return this.rich ? null : this.bitmapFont;
    }

    /** Points the shared provider at `font` and hands it back. */
    private bitmapMetrics(font: BitmapFont): BitmapTextMetrics {
        const metrics = this._bitmapMetrics ?? (this._bitmapMetrics = new BitmapTextMetrics(font));
        metrics.setFont(font);
        return metrics;
    }

    /**
     * Resolves the atlas the font's glyphs are cut from, once per font.
     *
     * @returns `false` when there is nothing to draw with — either the atlas has
     *   no asset behind it, or it exists but has not loaded. The two differ: a
     *   texture that is merely late reports a placeholder size, and geometry
     *   built from it would be cached with UVs sampling the wrong part of the
     *   atlas, so the caller has to ask for a rebuild. `_bitmapAwaiting` says
     *   which case this is.
     */
    private _resolveBitmapAtlas(font: BitmapFont, layout: TextLayout): boolean {
        if (this._bitmapFontOf === font) {
            if (!this._bitmapAwaiting)
                return this._bitmapHandle !== null;
            const texture = this._bitmapHandle!.texture;
            if (!texture.isReady())
                return false;
            this._bitmapAwaiting = false;
            const size = texture.getSize();
            this._bitmapHandle = { texture, width: size.width, height: size.height };
            return true;
        }

        this._bitmapFontOf = font;
        this._bitmapAtlas = null;
        this._bitmapHandle = null;
        this._bitmapAwaiting = false;

        const source = this.firstGlyphSource(font, layout);
        if (!source)
            return false;

        this._bitmapAtlas = source.atlas;
        const handle = resolveTextureHandle(source.atlas.owner.getItemAsset(source.atlas));
        if (!handle)
            return false;

        // Recorded before the size is judged: a `Texture` exists before its
        // image does, so a size of zero here means "not yet", not "nothing to
        // draw". Returning without setting `_bitmapAwaiting` would leave the
        // field blank forever, since nothing would ask for a rebuild.
        this._bitmapHandle = handle;
        this._bitmapAwaiting = !handle.texture.isReady();
        return !this._bitmapAwaiting && handle.width > 0 && handle.height > 0;
    }

    /** The source of the first glyph the text actually uses, if any. */
    private firstGlyphSource(font: BitmapFont, layout: TextLayout): BitmapGlyphSource | null {
        for (const line of layout.lines) {
            for (let i = 0; i < line.text.length; i++) {
                const glyph = font.glyph(line.text.charCodeAt(i));
                const source = glyph ? font.sourceFor(glyph) : null;
                if (source)
                    return source;
            }
        }
        return null;
    }

    /**
     * One quad per glyph, straight from the package atlas.
     *
     * Nothing is rasterised: the glyphs are already images, so the mesh samples
     * them where they lie. That also means a bitmap-font field needs no canvas
     * at all — it draws in an environment where `canvasFactory` is `null`, which
     * the raster path cannot.
     *
     * The corners come out in the layout's own coordinates, so `align`,
     * `verticalAlign` and `autoSize` mean exactly what they mean for a system
     * font: the block is placed by the same two offsets, and the pen of each
     * line by the same call the raster path makes.
     */
    private buildBitmapGeometry(builder: GeometryBuilder, font: BitmapFont, layout: TextLayout): void {
        if (layout.lines.length === 0 || layout.textWidth <= 0)
            return;

        if (!this._resolveBitmapAtlas(font, layout)) {
            // Ask for a rebuild only while the atlas is genuinely on its way; a
            // font whose atlas never resolves must not invalidate every frame.
            if (this._bitmapAwaiting)
                this.invalidateGeometry();
            return;
        }

        const handle = this._bitmapHandle!;
        const mapping = this._bitmapMapping;
        const uv = this._glyphUV;
        const metrics = this.bitmapMetrics(font);
        const scale = metrics.scale(this.fontSize);

        const blockX = this.blockOffsetX(layout) + this.textPaddingOffsetX();
        const blockY = lineOffsetY(layout.textHeight, this.contentHeight, this.verticalAlign)
            + this.textPaddingOffsetY();

        for (let i = 0; i < layout.lines.length; i++) {
            const line = layout.lines[i];
            // A blank line costs its step but has nothing to draw.
            if (line.text.length === 0)
                continue;

            let pen = blockX + lineOffsetX(line.width, layout.textWidth, this.align);
            // The font's own line sits centred in the taller line box, matching
            // where the raster path puts it.
            const top = blockY + i * layout.lineStep + (layout.lineStep - layout.lineHeight) / 2;

            for (let c = 0; c < line.text.length; c++) {
                const code = line.text.charCodeAt(c);
                const glyph = font.glyph(code);
                const source = glyph ? font.sourceFor(glyph) : null;

                // One mesh carries one texture. A font packed across two atlases
                // cannot be drawn in one pass; nothing the editor publishes does
                // that, and the glyph is better dropped than sampled from the
                // wrong image.
                if (glyph && source && source.atlas === this._bitmapAtlas) {
                    mapping.set(glyph.rect, handle.width, handle.height, source.rotated);

                    const x0 = pen + glyph.xOffset * scale;
                    const y0 = top + glyph.yOffset * scale;
                    const x1 = x0 + mapping.width * scale;
                    const y1 = y0 + mapping.height * scale;

                    mapping.uv(0, 0, uv);
                    const u0 = uv.u;
                    const v0 = uv.v;
                    mapping.uv(1, 0, uv);
                    const u1 = uv.u;
                    const v1 = uv.v;
                    mapping.uv(1, 1, uv);
                    const u2 = uv.u;
                    const v2 = uv.v;
                    mapping.uv(0, 1, uv);
                    const u3 = uv.u;
                    const v3 = uv.v;

                    builder.addQuad(x0, y0, x1, y0, x1, y1, x0, y1, u0, v0, u1, v1, u2, v2, u3, v3);
                }

                pen += metrics.advance(code, this.fontSize) + this.letterSpacing;
            }
        }
    }

    public override commitGeometry(): void {
        // Laid out here, not inside `ensureRasterised`: a package font draws
        // glyphs straight from its atlas and has no raster to redraw, so that
        // early return would leave every change to its text unnoticed — the mesh
        // went on drawing the glyphs it was first built with, and a cooldown's
        // digits never moved on from the number they started at.
        this.ensureLayout();
        this.ensureRasterised();
        // A text or metrics change resizes the quad, which the base class only
        // learns about through its own dirty flag.
        if (this._layoutRecomputed)
            this.invalidateGeometry();
        super.commitGeometry();
    }

    // ---- rasterisation ---------------------------------------------------

    /**
     * Redraws the `DynamicTexture` when the layout, the resolution or the style
     * changed.
     *
     * The texture is the *laid-out block*, not the content box, so a wide box with
     * a little text does not allocate a wide bitmap; the alignment offsets move
     * the quad instead.
     */
    public ensureRasterised(): void {
        // A package font's glyphs are already images, so this field has no
        // raster of its own — and one left behind by a system font it used to
        // draw with would stay allocated for nothing.
        if (this.bitmapFontForDraw()) {
            this.releaseRaster();
            return;
        }

        const factory = this.renderer.canvasFactory;
        if (factory === null) {
            this.releaseRaster();
            return;
        }

        const layout = this.ensureLayout();
        const scale = this._textureScale;
        const style = this.rasterStyleKey();

        if (this._texture
            && this._rasterisedLayout === layout
            && this._rasterisedScale === scale
            && this._rasterisedStyle === style)
            return;

        // The raster is the laid-out block plus a transparent margin, so glyph
        // ink that overhangs the advance box is not shaved off. `buildGeometry`
        // steps the UVs in by the same margin, so the quad is unaffected.
        const pad = Math.ceil(this.padding * scale);
        const blockWidth = Math.ceil(layout.textWidth * scale);
        const blockHeight = Math.ceil(layout.textHeight * scale);
        const width = Math.max(1, blockWidth + pad * 2);
        const height = Math.max(1, blockHeight + pad * 2);

        if (!this._texture || this._textureWidth !== width || this._textureHeight !== height) {
            this._texture?.dispose();
            const canvas = factory(width, height);
            canvas.width = width;
            canvas.height = height;
            // The name carries a serial number because every text object's mesh
            // is called `fgui-text`: without it, every texture in the scene would
            // share one name, which makes both debugging and any name-keyed
            // lookup in Babylon point at an arbitrary one of them.
            this._texture = new DynamicTexture(
                `${this.mesh.name}-texture-${++_textureSerial}`,
                canvas as never,
                this.renderer.scene,
                false,
                Texture.BILINEAR_SAMPLINGMODE,
            );
            this._texture.hasAlpha = true;
            this._textureWidth = width;
            this._textureHeight = height;
            this._rasterisedLayout = null;
        }

        // Kept so `buildGeometry` can derive the UVs without second-guessing
        // the rounding above. All of these are in **texels**, which is what the
        // UVs are a ratio of.
        this._rasterPadX = pad;
        this._rasterPadUI = pad / scale;

        const ctx = this._texture.getContext() as unknown as Canvas2DContextLike | null;
        if (!ctx)
            return;

        this.draw(ctx, layout, scale);
        this._texture.update(false);

        this._rasterisedLayout = layout;
        this._rasterisedScale = scale;
        this._rasterisedStyle = style;
    }

    /** Drops the rasterisation texture, if there is one. */
    private releaseRaster(): void {
        if (!this._texture)
            return;
        this._texture.dispose();
        this._texture = null;
        this._textureWidth = 0;
        this._textureHeight = 0;
        this._rasterisedLayout = null;
    }

    /** Everything the drawn pixels depend on besides the layout. */
    private rasterStyleKey(): string {
        return [
            // Not the field's colour: the raster is painted white and that
            // colour arrives as the draw-time tint, so changing it is not a
            // reason to repaint.
            this.underline ? 1 : 0,
            this.stroke,
            this.strokeColor.toHex(),
            this.shadowOffsetX,
            this.shadowOffsetY,
            this.shadowColor.toHex(),
        ].join('|');
    }

    /** Draws every line of the layout into the rasterisation context. */
    private draw(ctx: Canvas2DContextLike, layout: TextLayout, scale: number): void {
        ctx.save();
        ctx.scale(scale, scale);
        // Shift into the padded texture, so the laid-out block still starts at
        // its own origin and every line offset below is unchanged.
        const pad = this._rasterPadX / scale;
        ctx.translate(pad, pad);
        ctx.clearRect(-pad, -pad, layout.textWidth + pad * 2, layout.textHeight + pad * 2);

        ctx.font = CanvasTextMetrics.fontString({
            font: this.font,
            fontSize: this.fontSize,
            fontStyle: this.fontStyle,
        });
        ctx.textAlign = 'left';

        // What sits above the baseline is centred in the line box, so the descent
        // hangs below it.
        //
        // That is the alignment a reader judges: the capitals are the body of the
        // run, and putting *their* middle on the line box's middle is what lines
        // a row of text up with a centred sibling — a tree row's icon, a combo's
        // title. The two neighbouring rules are each a little off: centring the
        // whole ink (descent included) lifts the capitals by half a descent, and
        // our own `'middle'` centres the em square, which a Latin face balances
        // differently again. `measureText('Mg')` reports exactly what is above
        // the baseline: a capital's height and no more.
        const probe = ctx.measureText('Mg');
        const ascent = typeof probe.actualBoundingBoxAscent === 'number' ? probe.actualBoundingBoxAscent : null;
        // A canvas that reports no ink bounds (the headless stubs) keeps the
        // em-square approximation.
        ctx.textBaseline = ascent === null ? 'middle' : 'alphabetic';

        for (let i = 0; i < layout.lines.length; i++) {
            const line = layout.lines[i];
            const x = lineOffsetX(line.width, layout.textWidth, this.align);
            const lineTop = i * layout.lineStep;
            const y = ascent === null
                ? lineTop + layout.lineStep / 2
                : lineTop + (layout.lineStep + ascent) / 2;

            if (line.text.length > 0)
                this.drawStyledLine(ctx, line.text, x, y);

            if (this.underline && line.width > 0) {
                ctx.fillStyle = toCssColor(RASTER_INK);
                ctx.globalAlpha = 1;
                // Just under the baseline the run above was drawn on.
                const rule = ascent === null ? lineTop + layout.lineHeight - 1 : y + 2;
                ctx.fillRect(x, rule, line.width, 1);
            }
        }

        ctx.restore();
    }

    /**
     * Draws one line: its shadow, then its outline, then the fill.
     *
     * Order matters — each pass paints over the previous, which is what makes
     * the outline read as sitting outside the glyph rather than through it.
     *
     * The fill is painted in {@link RASTER_INK}, not in the field's colour: the
     * shader multiplies the whole raster by that colour at draw time, so baking
     * it in here as well applied it twice. A mid-grey label came out at a
     * quarter of its value, and a half-transparent one at a quarter of its
     * opacity. The outline and the shadow keep their own colours — those are
     * absolute, and the reference tinted them the same way.
     */
    private drawStyledLine(ctx: Canvas2DContextLike, text: string, x: number, y: number): void {
        const offsetX = this.shadowOffsetX;
        const offsetY = this.shadowOffsetY;
        const hasShadow = offsetX !== 0 || offsetY !== 0;
        const hasStroke = this.stroke > 0;

        if (hasShadow) {
            const sx = x + offsetX;
            const sy = y + offsetY;
            // The shadow of an outlined glyph is itself outlined, or the
            // outline would punch a hole in the shadow.
            if (hasStroke)
                this.paint(ctx, text, sx, sy, this.shadowColor, true);
            this.paint(ctx, text, sx, sy, this.shadowColor, false);
        }

        if (hasStroke)
            this.paint(ctx, text, x, y, this.strokeColor, true);
        this.paint(ctx, text, x, y, RASTER_INK, false);
    }

    /**
     * Paints one run of text in a single colour, as a fill or an outline.
     *
     * Spacing is applied by advancing the pen manually: canvas `letterSpacing` is
     * not universally available and interacts with `measureText` inconsistently
     * across engines, whereas this is the same arithmetic the layout used and so
     * keeps the raster and the measured width in agreement.
     */
    private paint(
        ctx: Canvas2DContextLike, text: string, x: number, y: number,
        color: Color, asStroke: boolean,
    ): void {
        const css = toCssColor(color);
        ctx.fillStyle = css;
        ctx.strokeStyle = css;
        ctx.globalAlpha = color.a / 255;

        // The canvas's own lineWidth is shared, so it is set per pass rather
        // than once outside the loop.
        if (asStroke)
            ctx.lineWidth = Math.max(1, this.stroke);

        const emit = (value: string, px: number): void => {
            if (asStroke) {
                if (ctx.strokeText)
                    ctx.strokeText(value, px, y);
            } else {
                ctx.fillText(value, px, y);
            }
        };

        if (this.letterSpacing === 0) {
            emit(text, x);
            return;
        }

        let pen = x;
        for (let i = 0; i < text.length; i++) {
            const ch = text.charAt(i);
            emit(ch, pen);
            pen += ctx.measureText(ch).width + this.letterSpacing;
        }
    }

    // ---- links -----------------------------------------------------------

    /** The `<a href>` spans the current markup declared, in plain-text offsets. */
    public get links(): readonly TextLink[] {
        this.ensureLayout();
        return this._links;
    }

    /**
     * Returns the `href` of the link under a point in this object's local space,
     * or `null`.
     *
     * `ITextObject` only exposes the `onLinkClick` slot — the core owns dispatch —
     * but a click cannot be attributed to a link without knowing where the glyphs
     * landed, so the hit test lives here, next to the layout that computed it.
     */
    public hitTestLink(x: number, y: number): string | null {
        const layout = this.ensureLayout();
        if (this._links.length === 0 || layout.lines.length === 0)
            return null;

        const localX = x - this.blockOffsetX(layout) - this.textPaddingOffsetX();
        const localY = y - lineOffsetY(layout.textHeight, this.contentHeight, this.verticalAlign)
            - this.textPaddingOffsetY();

        const lineIndex = Math.floor(localY / layout.lineStep);
        if (lineIndex < 0 || lineIndex >= layout.lines.length || localY < 0)
            return null;

        const line = layout.lines[lineIndex];
        const local = localX - lineOffsetX(line.width, layout.textWidth, this.align);
        if (local < 0 || local > line.width)
            return null;

        // Walk the line to find which character cell the point falls in. The
        // test is the cell's right edge, not its midpoint: a point in a glyph's
        // right half still belongs to that glyph, so rounding to the nearest
        // character would hand every other half-glyph to its neighbour.
        let pen = 0;
        let offsetInLine = line.text.length;
        for (let i = 0; i < line.text.length; i++) {
            const advance = this.advanceOf(line.text.charAt(i));
            if (local < pen + advance) {
                offsetInLine = i;
                break;
            }
            pen += advance;
        }

        const charIndex = line.start + offsetInLine;
        for (const link of this._links) {
            if (charIndex >= link.start && charIndex < link.end)
                return link.href;
        }
        return null;
    }

    /** Fires `onLinkClick` for the link under a local-space point, if any. */
    public clickLink(x: number, y: number): boolean {
        const href = this.hitTestLink(x, y);
        if (href === null)
            return false;
        this.onLinkClick?.(href);
        return true;
    }

    /** Advance width of one character, measured the way the layout measures it. */
    private advanceOf(ch: string): number {
        // Whatever the layout measured with: a link's hit box has to sit under
        // the glyphs the same provider placed.
        const font = this.bitmapFontForDraw();
        if (font)
            return this.bitmapMetrics(font).advance(ch.charCodeAt(0), this.fontSize) + this.letterSpacing;

        const style = { font: this.font, fontSize: this.fontSize, fontStyle: this.fontStyle };
        return this.renderer.textMetrics.measure(ch, style) + this.letterSpacing;
    }

    /** Raises a DOM input over this field so the user can type into it. */
    public openKeyboard(): void {
        if (!this.editable)
            return;

        // The field's rect in UI-root space *is* its position on the page, in
        // CSS pixels: the UI is a screen-space overlay laid out in CSS pixels,
        // anchored at the canvas's top-left.
        const owner = this.userData as { localToGlobalRect?(x: number, y: number, w: number, h: number): Rect } | null;
        const rect = owner?.localToGlobalRect
            ? owner.localToGlobalRect(0, 0, this.contentWidth, this.contentHeight)
            : { x: 0, y: 0, width: this.contentWidth, height: this.contentHeight };

        // The overlay draws the text from here on, so this raster stands down
        // until it closes — see `openNativeInput` for why. A host with no DOM
        // has no overlay to hand over to, and keeps drawing its own text.
        const opened = openNativeInput({
            // Babylon types this as its own canvas shape; all that is wanted from
            // it is the page offset, so it crosses the boundary as a cast.
            canvas: this.renderer.engine.getRenderingCanvas() as unknown as CanvasOffsetLike | null,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            text: this.text,
            font: this.font,
            fontSize: this.fontSize,
            fontStyle: this.fontStyle,
            color: this.color,
            align: this.align as AlignType,
            letterSpacing: this.letterSpacing,
            // The overlay's own line boxes have to be the ones this field lays
            // out with, or the text it draws would not match what the display
            // list puts back on close.
            lineHeight: this.ensureLayout().lineStep,
            promptText: this.promptText,
            multiline: !this.singleLine,
            password: this.password,
            maxLength: this.maxLength,
            onText: (text) => {
                this.text = text;
                this.onTextChanged?.(text);
            },
            onSubmit: (text, keyCode) => {
                this.text = text;
                this.onSubmit?.(text, keyCode);
            },
            onClose: () => {
                this._inputOpen = false;
                // ...and the raster takes over again.
                this.invalidateGeometry();
            },
        });

        if (opened) {
            this._inputOpen = true;
            // The mesh has to be told, not just skipped next time round: without
            // this it keeps the quad it drew a moment ago and the text shows
            // twice — which is what a field reopened after a blur used to do.
            this.invalidateGeometry();
        }
    }

    public override dispose(): void {
        // Leaving the overlay behind would strand a focused DOM element over a
        // field that no longer exists.
        if (this._inputOpen)
            closeNativeInput();
        this._texture?.dispose();
        this._texture = null;
        super.dispose();
    }
}

/** `#rrggbbaa` — how a `Color` reaches canvas 2D. */
function toCssColor(color: Color): string {
    const hex = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}${hex(color.a)}`;
}
