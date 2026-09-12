import type { BlendMode, FillMethod, FillOrigin, FlipType } from '../FieldTypes.js';
import type { Color } from '../utils/Color.js';
import type { Point, Rect } from '../utils/Geometry.js';
import type { PixelHitTestData } from '../event/HitTest.js';
import type { BitmapFont } from '../display/BitmapFont.js';
import type { InputProcessor } from '../event/InputProcessor.js';

/**
 * What FairyGUI's display list needs from a rendering backend.
 *
 * Coordinates are FairyGUI's own throughout: origin at the top-left of the UI
 * root, **y increasing downwards**, angles in degrees increasing **clockwise**
 * on screen. A backend whose native space differs (Babylon's is y-up and
 * counter-clockwise) converts inside its own implementation; the core never
 * sees or produces a native-space number.
 *
 * The reference Cocos runtime expressed this contract implicitly through
 * `cc.Node` and its anchor system, where the anchor's y was inverted relative
 * to FairyGUI's pivot. Stating it directly removes that inversion — and the
 * `1 - pivotY` arithmetic it forced on every call site.
 */
export interface IRenderObject {
    /**
     * Back-pointer to the owning `GObject`.
     *
     * Mirror of the reference's `node["$gobj"]`: input handling walks the render
     * tree and needs to recover the display object it belongs to.
     */
    userData: unknown;

    // ---- hierarchy -------------------------------------------------------

    readonly parent: IRenderObject | null;
    readonly numChildren: number;
    getChildAt(index: number): IRenderObject | null;
    addChild(child: IRenderObject): void;
    addChildAt(child: IRenderObject, index: number): void;
    removeChild(child: IRenderObject): void;
    removeChildren(beginIndex?: number, endIndex?: number): void;
    setChildIndex(child: IRenderObject, index: number): void;
    getChildIndex(child: IRenderObject): number;

    // ---- transform -------------------------------------------------------

    /** Position of the pivot point, in the parent's coordinate space. */
    setPosition(x: number, y: number): void;
    readonly positionX: number;
    readonly positionY: number;

    setScale(sx: number, sy: number): void;
    readonly scaleX: number;
    readonly scaleY: number;

    /** Degrees, clockwise on screen. */
    angle: number;
    skewX: number;
    skewY: number;

    /**
     * Rotation/scale origin, as a fraction of the content box: `(0, 0)` is the
     * top-left corner, `(1, 1)` the bottom-right.
     */
    setPivot(x: number, y: number): void;
    readonly pivotX: number;
    readonly pivotY: number;

    // ---- content box -----------------------------------------------------

    setContentSize(w: number, h: number): void;
    readonly contentWidth: number;
    readonly contentHeight: number;

    // ---- appearance ------------------------------------------------------

    /** Local opacity in `[0, 1]`; the backend multiplies it down the tree. */
    alpha: number;
    visible: boolean;
    grayed: boolean;
    blendMode: BlendMode;
    /** Sibling draw order; higher draws later. */
    sortingOrder: number;
    /** Round positions to whole pixels when true. */
    pixelSnapping: boolean;

    // ---- clipping --------------------------------------------------------

    /** Clips this object's subtree to a rect in its own local space. */
    scrollRect: Rect | null;
    /** Another render object whose silhouette clips this one. */
    mask: IRenderObject | null;
    maskInverted: boolean;

    // ---- coordinates -----------------------------------------------------

    /** Converts a point from this object's space to UI-root space. */
    localToGlobal(x: number, y: number, result?: Point): Point;
    /** Converts a point from UI-root space into this object's space. */
    globalToLocal(x: number, y: number, result?: Point): Point;

    /** Hit test in this object's local space. */
    hitTest(x: number, y: number): boolean;

    dispose(): void;
}

/**
 * Where an atlas region sat inside the image it was cut from.
 *
 * The editor trims a sprite's transparent margins and keeps the offset and the
 * size it trimmed from beside the region. An object's box is that untrimmed
 * size, so the art belongs inset by `x`/`y` rather than filling the box.
 */
export interface SpriteTrim {
    x: number;
    y: number;
    originalWidth: number;
    originalHeight: number;
}

/** A render object that draws an image, optionally from an atlas sub-rect. */
export interface IImageObject extends IRenderObject {
    /**
     * @param texture backend handle previously produced by the asset resolver,
     *   or `null` to draw the fill colour only (a `GGraph`-style solid rect).
     * @param rect atlas sub-rect to sample, or `null` for the whole texture.
     * @param rotated whether the editor stored the region rotated 90°.
     * @param trim where the region sat in the untrimmed image. Omit it for a
     *   whole image, which is the same as an untrimmed one.
     */
    setSprite(texture: unknown | null, rect: Rect | null, rotated: boolean, trim?: SpriteTrim | null): void;

    /** Nine-slice borders. */
    scale9Grid: Rect | null;
    /** Repeat the image instead of stretching it. */
    scaleByTile: boolean;
    /** Which of the editor's tiling layouts to use when `scaleByTile` is set. */
    tileGridIndice: number;

    flip: FlipType;

    fillMethod: FillMethod;
    fillOrigin: FillOrigin;
    fillClockwise: boolean;
    fillAmount: number;

    /** Multiplied into the sampled texels. */
    color: Color;

    /** Adds an analytic hit test on top of the bounding box (e.g. for `GGraph`). */
    hitTestShape: ((x: number, y: number) => boolean) | null;
}

/**
 * A text surface.
 *
 * Layout lives here rather than in `GTextField` because measuring a glyph run
 * needs the backend's font machinery — canvas 2D metrics, an SDF atlas, or a
 * bitmap-font table. `GTextField` owns the FairyGUI-level properties (font,
 * size, align, auto-size mode, markup) and asks this object what they measure
 * to.
 */
export interface ITextObject extends IRenderObject {
    text: string;
    font: string | null;
    /**
     * The package font this field draws with, or `null` for a system font.
     *
     * A backend that honours it draws the glyphs from the item's own atlas; one
     * that ignores it falls back to `font` as a system family, which is what the
     * `ui://` URL in that field cannot be. Either way the field's own rules are
     * already applied by the core — a font that may not be tinted has had its
     * colour forced to white, and one that does not scale has had `fontSize`
     * snapped to its design size — so the surface only has to draw glyphs.
     */
    bitmapFont: BitmapFont | null;
    fontSize: number;
    color: Color;
    /** `"bold"`, `"italic"`, `"bolditalic"` or `""`. */
    fontStyle: string;
    align: number;
    verticalAlign: number;
    /** `true` when the text carries UBB/HTML markup rather than plain runs. */
    rich: boolean;
    singleLine: boolean;
    letterSpacing: number;
    leading: number;
    underline: boolean;
    /** Auto-size mode, from `AutoSizeType`. */
    autoSize: number;
    /** Explicit wrap width; `0` means unlimited. */
    wrapWidth: number;
    /** Resolution multiplier for the glyph rasterisation. */
    textureScale: number;

    /** Outline thickness in pixels; `0` disables the outline. */
    stroke: number;
    strokeColor: Color;

    /** Drop-shadow offset in pixels; `(0, 0)` disables the shadow. */
    shadowOffsetX: number;
    shadowOffsetY: number;
    shadowColor: Color;

    /** Measures the laid-out text without committing it. */
    measureTextWidth(): number;
    measureTextHeight(): number;

    /** Registers a handler for `<a href=...>` clicks in rich text. */
    onLinkClick: ((href: string) => void) | null;

    /**
     * The `href` of the link under a point in this object's local space.
     *
     * Markup is laid out by the backend, so only it knows where the glyphs
     * landed — the core asks which link is under a click and decides what to
     * emit. Returns `null` when the point is not on a link, or when the text
     * carries no links at all.
     */
    hitTestLink(x: number, y: number): string | null;
}

/** Vector drawing surface backing `GGraph`. */
export interface IGraphObject extends IRenderObject {
    /** Drops all previously drawn shapes. */
    clear(): void;
    /** Draws a filled axis-aligned rectangle. */
    drawRect(lineSize: number, lineColor: Color, fillColor: Color, x: number, y: number, w: number, h: number): void;
    /**
     * Draws a rectangle with independent corner radii.
     * @param corners `[topLeft, topRight, bottomLeft, bottomRight]`; any may be `null`.
     */
    drawRoundRect(
        lineSize: number, lineColor: Color, fillColor: Color,
        x: number, y: number, w: number, h: number,
        corners: Array<number | null>,
    ): void;
    drawEllipse(lineSize: number, lineColor: Color, fillColor: Color, x: number, y: number, w: number, h: number): void;
    /** Draws a closed polygon; `points` is a flat `[x0, y0, x1, y1, …]`. */
    drawPolygon(
        lineSize: number, lineColor: Color, fillColor: Color,
        points: number[], fillAlpha?: number,
    ): void;
    /** Draws an open polyline. */
    drawPath(
        lineSize: number, lineColor: Color, fillColor: Color,
        points: number[], fillAlpha?: number,
    ): void;
    color: Color;
}

/**
 * Creates render objects for the display list.
 *
 * This is global rather than injected because `GObject`'s constructor builds its
 * render object before it is attached to any root — the same reason FairyGUI's
 * own `UIObjectFactory` is global.
 */
export interface IRenderFactory {
    /** A bare transform node: no drawing of its own. */
    createObject(): IRenderObject;
    createImage(): IImageObject;
    createText(): ITextObject;
    createGraph(): IGraphObject;

    /**
     * Attaches a top-level display list to the renderer.
     *
     * `GRoot` calls this on its own node once, to become the root of everything
     * the renderer draws. A screen-space backend parents it under a UI camera's
     * overlay; a world-space one parents it under the host's chosen node.
     */
    attachToStage(node: IRenderObject): void;

    /**
     * The current UI viewport size, in UI units.
     *
     * `GRoot` sizes itself to this and refreshes on the `onResize` callback
     * below, so a backend that owns the canvas dimensions is the authority.
     */
    readonly viewportWidth: number;
    readonly viewportHeight: number;

    /** Registers a callback invoked whenever the viewport size changes. */
    onViewportResize(callback: (width: number, height: number) => void): void;

    /** Connects native backend input to the core processor, when supported. */
    bindInput?(input: InputProcessor): (() => void) | void;
}

let factory: IRenderFactory | null = null;

export function setRenderFactory(value: IRenderFactory | null): void {
    factory = value;
}

export function getRenderFactory(): IRenderFactory {
    if (!factory)
        throw new Error('fairygui: no render backend installed. Call setRenderFactory() with a backend (e.g. createBabylonRenderer()) before building any UI.');
    return factory;
}

/** Resolves a `PixelHitTestData` against a point in an image's local space. */
export interface IAlphaHitTester {
    hitTest(x: number, y: number): boolean;
}

export type AlphaHitTestFactory = (data: PixelHitTestData, width: number, height: number) => IAlphaHitTester;
