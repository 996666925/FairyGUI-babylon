/**
 * Babylon.js render backend for the FairyGUI runtime.
 *
 * ```ts
 * import { createBabylonRenderer } from './babylon/index.js';
 * import { setRenderFactory } from './core/render/IRenderObject.js';
 *
 * const renderer = createBabylonRenderer({ scene, width, height });
 * setRenderFactory(renderer);
 * ```
 *
 * The backend is screen-space: it owns an orthographic camera sized to the
 * viewport, keeps the host scene's active camera untouched, and accepts an
 * existing `Scene`. Every coordinate it exchanges with the core is FairyGUI's own
 * — origin top-left, y down, degrees clockwise — with the conversion confined to
 * the y-flipped UI root and the shader.
 */

export {
    BabylonRenderer,
    createBabylonRenderer,
    installBabylonRenderer,
    UI_LAYER_MASK,
    type BabylonRendererOptions,
} from './BabylonRenderer.js';

export { BabylonPackageAssets } from './PackageAssets.js';
export { bindBabylonInput } from './BabylonInput.js';

export {
    openNativeInput,
    closeNativeInput,
    hasNativeInput,
    type NativeInputOptions,
    type CanvasOffsetLike,
} from './TextInput.js';

export { BabRenderObject, isBabRenderObject } from './BabRenderObject.js';
export { BabImageObject, resolveTextureHandle, type BabTextureHandle } from './BabImageObject.js';
export { BabTextObject } from './BabTextObject.js';
export { BabGraphObject } from './BabGraphObject.js';

export { Mat2D } from './Mat2D.js';

export {
    MAX_CLIP_RECTS,
    ClipStack,
    type ClipEntry,
} from './ClipRects.js';

export {
    GeometryBuilder,
    SpriteMapping,
    nineSliceBorders,
    nineSliceRegions,
    tileRegions,
    fillPolygon,
    triangulatePolygon,
    clipToUnitSquare,
    clipHalfPlane,
    roundRectPath,
    ellipsePath,
    signedArea,
    strokePolyline,
    type SpriteRegion,
    type SliceBorders,
    type UV,
} from './GeometryBuilder.js';

export {
    layoutText,
    stripMarkup,
    tokenizeParagraph,
    normalizeNewlines,
    lineOffsetX,
    lineOffsetY,
    BitmapTextMetrics,
    CanvasTextMetrics,
    EstimatedTextMetrics,
    defaultCanvasFactory,
    type Canvas2DContextLike,
    type CanvasFactory,
    type CanvasLike,
    type ITextMetricsProvider,
    type StrippedMarkup,
    type TextLayout,
    type TextLayoutInput,
    type TextLine,
    type TextLink,
    type TextStyle,
} from './TextLayout.js';

export {
    registerUIShaders,
    createUIMaterial,
    createWhiteTexture,
    alphaModeFor,
    UI_ATTRIBUTES,
    UI_UNIFORMS,
} from './UIShader.js';
