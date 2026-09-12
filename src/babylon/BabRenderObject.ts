import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import type { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { BlendMode } from '../core/FieldTypes.js';
import { Color } from '../core/utils/Color.js';
import { Point, Rect } from '../core/utils/Geometry.js';
import type { IRenderObject } from '../core/render/IRenderObject.js';
import { ClipStack, MAX_CLIP_RECTS } from './ClipRects.js';
import { GeometryBuilder } from './GeometryBuilder.js';
import { Mat2D } from './Mat2D.js';
import type { BabylonRenderer } from './BabylonRenderer.js';

const DEG2RAD = Math.PI / 180;

/** Scratch, pooled because `localToGlobal` sits on the hit-test path. */
const sChain: BabRenderObject[] = [];
const sTmp = new Mat2D();
const sTotal = new Mat2D();

/**
 * Base implementation of the FairyGUI render contract on top of Babylon.
 *
 * One `Mesh` per render object doubles as the transform node, so the display
 * tree, the Babylon transform hierarchy and the draw order are all the same
 * structure.
 *
 * ### Coordinate handling
 *
 * Nothing in this class ever stores or returns a Babylon-space number. The node's
 * transform holds FairyGUI values verbatim — `position` is the pivot's location
 * in the parent, `rotation.z` is `angle` converted degrees-to-radians *without a
 * sign change*, and `scaling` is `(scaleX, scaleY, 1)`. That works because the UI
 * root's y-flip and Babylon's y-up convention cancel: feeding Babylon the same
 * numeric angle yields a clockwise-on-screen rotation, exactly as the contract
 * requires. Pivot and skew are baked into the geometry instead of the node, since
 * Babylon's `TransformNode` exposes neither.
 */
export class BabRenderObject implements IRenderObject {
    public userData: unknown = null;
    public pixelSnapping = false;
    public maskInverted = false;

    /** The renderer that owns this object. */
    protected readonly renderer: BabylonRenderer;
    /** Babylon node; also the mesh the geometry is uploaded to. */
    protected readonly mesh: Mesh;
    /** Tint multiplied into every fragment. Image, text and graph all expose it. */
    public color: Color = new Color(255, 255, 255, 255);

    protected _children: BabRenderObject[] = [];
    protected _parent: BabRenderObject | null = null;

    protected _x = 0;
    protected _y = 0;
    protected _scaleX = 1;
    protected _scaleY = 1;
    protected _pivotX = 0;
    protected _pivotY = 0;
    protected _contentWidth = 0;
    protected _contentHeight = 0;
    protected _angle = 0;
    protected _skewX = 0;
    protected _skewY = 0;
    protected _alpha = 1;
    protected _visible = true;
    protected _grayed = false;
    protected _blendMode: BlendMode = BlendMode.Normal;
    protected _sortingOrder = 0;
    protected _scrollRect: Rect | null = null;
    protected _mask: IRenderObject | null = null;

    /** Geometry scratch, reused by every rebuild. */
    protected readonly builder = new GeometryBuilder();

    /** Local → UI-root space, refreshed by `BabylonRenderer.update()`. */
    public readonly uiMatrix = new Mat2D();
    /** Opacity accumulated from the UI root down to and including this object. */
    public worldAlpha = 1;
    /** Clip rects inherited from the ancestors plus this object's own. */
    public readonly clips = new ClipStack();
    /** Draw position within the UI layer, ascending. */
    private _drawOrder = 0;

    /**
     * Position in the display list, used as Babylon's `alphaIndex`.
     *
     * The UI material does not write depth — every object is blended, and a
     * panel's own contents must be able to overlap it — so draw order is the
     * only thing deciding what covers what. Babylon sorts the transparent pass
     * by `alphaIndex` ascending, which makes the display list's order the
     * painter's order.
     */
    public get drawOrder(): number {
        return this._drawOrder;
    }

    public set drawOrder(value: number) {
        this._drawOrder = value;
        this.mesh.alphaIndex = value;
    }

    /** The value pushed to `uTint` at draw time; reused every frame. */
    public readonly tint = new Color4(1, 1, 1, 1);

    private _clipRects: number[] | null = null;
    private _clipRow0: number[] | null = null;
    private _clipRow1: number[] | null = null;
    private _geometryDirty = true;
    private _disposed = false;
    /** This object's own material; see `materialForDraw`. */
    private _material: ShaderMaterial | null = null;

    public constructor(renderer: BabylonRenderer, name: string) {
        this.renderer = renderer;
        this.mesh = new Mesh(name, renderer.scene);
        this.mesh.parent = renderer.holdingNode;
        // UI meshes cover the screen and are never picked with a ray; the core
        // does its own hit testing in UI space.
        this.mesh.alwaysSelectAsActiveMesh = true;
        this.mesh.doNotSyncBoundingInfo = true;
        this.mesh.isPickable = false;
        this.mesh.layerMask = renderer.uiLayerMask;
        this.mesh.alphaIndex = 0;
        this.mesh.onBeforeRenderObservable.add(() => this._bindUniforms());
    }

    // ---- hierarchy -------------------------------------------------------

    public get parent(): IRenderObject | null {
        return this._parent;
    }

    public get numChildren(): number {
        return this._children.length;
    }

    public getChildAt(index: number): IRenderObject | null {
        return this._children[index] ?? null;
    }

    public addChild(child: IRenderObject): void {
        this.addChildAt(child, this._children.length);
    }

    public addChildAt(child: IRenderObject, index: number): void {
        const node = BabRenderObject.require(child);
        if (node._parent === this) {
            this.setChildIndex(child, index);
            return;
        }
        node.detachFromParent();
        node._parent = this;
        this._children.splice(Math.max(0, Math.min(index, this._children.length)), 0, node);
        node.mesh.parent = this.mesh;
        this.renderer.invalidateDrawOrder();
    }

    public removeChild(child: IRenderObject): void {
        const node = child as BabRenderObject;
        const index = this._children.indexOf(node);
        if (index === -1)
            return;
        this._children.splice(index, 1);
        node._parent = null;
        node.mesh.parent = this.renderer.holdingNode;
        this.renderer.invalidateDrawOrder();
    }

    public removeChildren(beginIndex = 0, endIndex = -1): void {
        if (endIndex < 0 || endIndex >= this._children.length)
            endIndex = this._children.length - 1;
        for (let i = beginIndex; i <= endIndex; i++) {
            const node = this._children[i];
            if (node) {
                node._parent = null;
                node.mesh.parent = this.renderer.holdingNode;
            }
        }
        this._children.splice(beginIndex, endIndex - beginIndex + 1);
        this.renderer.invalidateDrawOrder();
    }

    public setChildIndex(child: IRenderObject, index: number): void {
        const node = child as BabRenderObject;
        const old = this._children.indexOf(node);
        if (old === -1)
            return;
        this._children.splice(old, 1);
        this._children.splice(Math.max(0, Math.min(index, this._children.length)), 0, node);
        this.renderer.invalidateDrawOrder();
    }

    public getChildIndex(child: IRenderObject): number {
        return this._children.indexOf(child as BabRenderObject);
    }

    /** Reparents this object's Babylon node under `parent`'s. */
    public attachTo(parent: BabRenderObject | null): void {
        this.detachFromParent();
        this._parent = parent;
        this.mesh.parent = parent ? parent.mesh : this.renderer.uiRootNode;
        this.renderer.invalidateDrawOrder();
    }

    private detachFromParent(): void {
        const parent = this._parent;
        if (!parent)
            return;
        const index = parent._children.indexOf(this);
        if (index !== -1)
            parent._children.splice(index, 1);
        this._parent = null;
    }

    /** Narrows an `IRenderObject` to this backend's class, loudly. */
    public static require(node: IRenderObject): BabRenderObject {
        if (!(node instanceof BabRenderObject))
            throw new Error('fairygui-babylon: a render object from another backend was added to this display list.');
        return node;
    }

    /** This object's children, for the renderer's traversal. */
    public get babChildren(): readonly BabRenderObject[] {
        return this._children;
    }

    /** The Babylon node, exposed for the renderer and for advanced hosts. */
    public get babNode(): Mesh {
        return this.mesh;
    }

    // ---- transform -------------------------------------------------------

    public setPosition(x: number, y: number): void {
        if (this._x === x && this._y === y)
            return;
        this._x = x;
        this._y = y;
        this.syncTransform();
    }

    public get positionX(): number {
        return this._x;
    }

    public get positionY(): number {
        return this._y;
    }

    public setScale(sx: number, sy: number): void {
        if (this._scaleX === sx && this._scaleY === sy)
            return;
        this._scaleX = sx;
        this._scaleY = sy;
        this.syncTransform();
    }

    public get scaleX(): number {
        return this._scaleX;
    }

    public get scaleY(): number {
        return this._scaleY;
    }

    public get angle(): number {
        return this._angle;
    }

    public set angle(value: number) {
        if (this._angle === value)
            return;
        this._angle = value;
        this.syncTransform();
    }

    public get skewX(): number {
        return this._skewX;
    }

    public set skewX(value: number) {
        if (this._skewX === value)
            return;
        this._skewX = value;
        this.invalidateGeometry();
    }

    public get skewY(): number {
        return this._skewY;
    }

    public set skewY(value: number) {
        if (this._skewY === value)
            return;
        this._skewY = value;
        this.invalidateGeometry();
    }

    public setPivot(x: number, y: number): void {
        if (this._pivotX === x && this._pivotY === y)
            return;
        this._pivotX = x;
        this._pivotY = y;
        // The pivot moves the node origin, so the baked vertex offset changes.
        this.invalidateGeometry();
    }

    public get pivotX(): number {
        return this._pivotX;
    }

    public get pivotY(): number {
        return this._pivotY;
    }

    public setContentSize(w: number, h: number): void {
        if (this._contentWidth === w && this._contentHeight === h)
            return;
        this._contentWidth = w;
        this._contentHeight = h;
        this.invalidateGeometry();
    }

    public get contentWidth(): number {
        return this._contentWidth;
    }

    public get contentHeight(): number {
        return this._contentHeight;
    }

    /** Pushes position/rotation/scale onto the Babylon node. */
    protected syncTransform(): void {
        this.mesh.position.set(this._x, this._y, 0);
        this.mesh.rotation.z = this._angle * DEG2RAD;
        this.mesh.scaling.set(this._scaleX, this._scaleY, 1);
    }

    /** Pivot offset in pixels, in content space. */
    public get pivotOffsetX(): number {
        return this._pivotX * this._contentWidth;
    }

    public get pivotOffsetY(): number {
        return this._pivotY * this._contentHeight;
    }

    /**
     * Writes this object's local→parent affine.
     *
     * `T(pos) · R(angle) · S(scale) · T(-pivot) · K(skew)` — which is exactly
     * Babylon's node transform (`T(pos) · R · S`) applied to the vertices
     * `GeometryBuilder` emits (`K · (p - pivot)`).
     */
    public fillLocalToParent(out: Mat2D): Mat2D {
        const rad = this._angle * DEG2RAD;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const a = this._scaleX * cos;
        const b = this._scaleX * sin;
        const c = -this._scaleY * sin;
        const d = this._scaleY * cos;

        const kx = Math.tan(this._skewX * DEG2RAD);
        const ky = Math.tan(this._skewY * DEG2RAD);

        const a2 = a + c * kx;
        const b2 = b + d * kx;
        const c2 = a * ky + c;
        const d2 = b * ky + d;

        const px = this.pivotOffsetX;
        const py = this.pivotOffsetY;
        return out.set(a2, b2, c2, d2, this._x - (a2 * px + c2 * py), this._y - (b2 * px + d2 * py));
    }

    /** Composes this object's local→UI-root affine by walking the parent chain. */
    public fillLocalToUI(out: Mat2D): Mat2D {
        sChain.length = 0;
        let node: BabRenderObject | null = this;
        while (node) {
            sChain.push(node);
            node = node._parent;
        }
        out.setIdentity();
        for (let i = sChain.length - 1; i >= 0; i--)
            out.multiply(sChain[i].fillLocalToParent(sTmp));
        sChain.length = 0;
        return out;
    }

    public localToGlobal(x: number, y: number, result?: Point): Point {
        const out = result ?? new Point();
        const m = this.fillLocalToUI(sTotal);
        out.setTo(m.transformX(x, y), m.transformY(x, y));
        return out;
    }

    public globalToLocal(x: number, y: number, result?: Point): Point {
        const out = result ?? new Point();
        const m = this.fillLocalToUI(sTotal).invert();
        out.setTo(m.transformX(x, y), m.transformY(x, y));
        return out;
    }

    // ---- appearance ------------------------------------------------------

    public get alpha(): number {
        return this._alpha;
    }

    public set alpha(value: number) {
        this._alpha = value;
    }

    public get visible(): boolean {
        return this._visible;
    }

    public set visible(value: boolean) {
        if (this._visible === value)
            return;
        this._visible = value;
        // `setEnabled` propagates down the Babylon hierarchy, which is exactly
        // what the contract needs: `GObject._finalVisible` deliberately ignores
        // the ancestors, so the backend has to carry invisibility to children.
        this.mesh.setEnabled(value);
        this.mesh.isVisible = value;
    }

    public get grayed(): boolean {
        return this._grayed;
    }

    public set grayed(value: boolean) {
        this._grayed = value;
    }

    public get blendMode(): BlendMode {
        return this._blendMode;
    }

    public set blendMode(value: BlendMode) {
        this.applyBlendMode(value);
    }

    /**
     * The optional hook `BlendModeUtils.applyBlendMode` looks for.
     *
     * Each object owns its material, so switching modes means building another
     * one rather than reconfiguring a shared one.
     */
    public applyBlendMode(mode: BlendMode): void {
        this._blendMode = mode;
        this._material?.dispose();
        this._material = null;
        if (this.hasGeometry())
            this.mesh.material = this.materialForDraw();
    }

    /**
     * This object's material, built on first use.
     *
     * Not shared, and not optional: `uTexture` is a per-object uniform, and a
     * material used by several meshes only ever holds the last value assigned
     * to it, so every mesh drawing with it samples the same texture. Sharing
     * would make objects quietly render with each other's images — most
     * visible on text, where every label ends up showing the same glyphs.
     */
    protected materialForDraw(): ShaderMaterial {
        this._material ??= this.renderer.createMaterial(this._blendMode);
        return this._material;
    }

    public get sortingOrder(): number {
        return this._sortingOrder;
    }

    public set sortingOrder(value: number) {
        if (this._sortingOrder === value)
            return;
        this._sortingOrder = value;
        this.renderer.invalidateDrawOrder();
    }

    public get scrollRect(): Rect | null {
        return this._scrollRect;
    }

    public set scrollRect(value: Rect | null) {
        this._scrollRect = value;
    }

    public get mask(): IRenderObject | null {
        return this._mask;
    }

    public set mask(value: IRenderObject | null) {
        // A silhouette mask needs a stencil pass, which this backend does not
        // run: `scrollRect` is the supported clipping mechanism. The property is
        // kept so the core's bookkeeping stays intact.
        this._mask = value;
    }

    // ---- geometry --------------------------------------------------------

    /** Marks the mesh geometry as needing a rebuild. */
    public invalidateGeometry(): void {
        this._geometryDirty = true;
    }

    /** Whether this object currently has anything to draw. */
    public hasGeometry(): boolean {
        return this.mesh.getTotalVertices() > 0;
    }

    /** Rebuilds the mesh when dirty. Called by the renderer's per-frame pass. */
    public commitGeometry(): void {
        if (!this._geometryDirty)
            return;
        this._geometryDirty = false;
        this.builder.reset();
        this.builder.setPivotOffset(this.pivotOffsetX, this.pivotOffsetY);
        this.builder.setShear(this._skewX, this._skewY);
        this.buildGeometry(this.builder);
        this.uploadGeometry();
    }

    /** Subclasses fill `builder` with content-space geometry. */
    protected buildGeometry(_builder: GeometryBuilder): void {
        // A bare transform node draws nothing.
    }

    /** Uploads the accumulated geometry to the mesh. */
    protected uploadGeometry(): void {
        const b = this.builder;
        if (b.isEmpty()) {
            // `GGraph.clear()` and a texture-less text both land here: the mesh
            // has to lose its geometry, not just stop being drawn, so a later
            // `getTotalVertices()` (and the renderer's own bookkeeping) agrees.
            this.mesh.geometry?.dispose();
            this.mesh.setEnabled(this._visible);
            this.mesh.isVisible = false;
            return;
        }

        const data = new VertexData();
        data.positions = b.positions;
        data.uvs = b.uvs;
        data.colors = b.colors;
        data.indices = b.indices;
        data.applyToMesh(this.mesh, true);

        this.mesh.material = this.materialForDraw();
        this.mesh.setEnabled(this._visible);
        this.mesh.isVisible = this._visible;
    }

    /** Texture handle this object was given, or `null` for a solid tint. */
    public getTexture(): unknown {
        return null;
    }

    /** Texture bound to `uTexture` at draw time; the white texture by default. */
    protected textureForDraw(): BaseTexture {
        return this.renderer.whiteTexture;
    }

    // ---- per-draw uniforms ----------------------------------------------

    /**
     * Binds the per-object uniforms.
     *
     * Materials are shared by every object with the same blend mode, so the
     * per-object values are pushed just before each mesh draws, through
     * `mesh.onBeforeRenderObservable`.
     */
    private _bindUniforms(): void {
        const material = this.mesh.material as ShaderMaterial | null;
        if (!material || typeof material.setArray4 !== 'function')
            return;

        // Set here rather than pushed to every material each frame: the uniform
        // changes only when the root moves, and this is the one place that
        // already runs immediately before each draw.
        material.setMatrix('uRootInverse', this.renderer.rootInverse);

        const c = this.color;
        this.tint.set(c.r / 255, c.g / 255, c.b / 255, (c.a / 255) * this.worldAlpha);
        material.setColor4('uTint', this.tint);
        material.setFloat('uGrayed', this._grayed ? 1 : 0);
        material.setTexture('uTexture', this.textureForDraw());

        if (this._clipRects === null) {
            this._clipRects = new Array<number>(MAX_CLIP_RECTS * 4).fill(0);
            this._clipRow0 = new Array<number>(MAX_CLIP_RECTS * 4).fill(0);
            this._clipRow1 = new Array<number>(MAX_CLIP_RECTS * 4).fill(0);
        }
        this.clips.writeUniforms(this._clipRects, this._clipRow0 as number[], this._clipRow1 as number[]);
        material.setArray4('uClipRect', this._clipRects);
        material.setArray4('uClipRow0', this._clipRow0 as number[]);
        material.setArray4('uClipRow1', this._clipRow1 as number[]);
    }

    // ---- hit testing -----------------------------------------------------

    /**
     * Box test in this object's local space, plus the alpha silhouette an
     * `IImageObject` may carry.
     */
    public hitTest(x: number, y: number): boolean {
        if (x < 0 || y < 0 || x >= this._contentWidth || y >= this._contentHeight)
            return false;
        return this.hitTestContent(x, y);
    }

    /** Hook for `IImageObject`'s analytic shape. */
    protected hitTestContent(_x: number, _y: number): boolean {
        return true;
    }

    /**
     * Whether a UI-root-space point survives every `scrollRect` on the way down.
     *
     * `GObject.hitTest` walks the display tree itself and only asks each node
     * about its own box, so the clip test has to be applied here. The matrices
     * come from the last `BabylonRenderer.update()`, which is the state the
     * picture was drawn with.
     */
    public hitTestClip(x: number, y: number): boolean {
        return this.clips.containsUIPoint(x, y);
    }

    // ---- lifecycle -------------------------------------------------------

    public dispose(): void {
        if (this._disposed)
            return;
        this._disposed = true;
        this.detachFromParent();
        for (const child of this._children.slice())
            child.dispose();
        this._children.length = 0;

        // The material belongs to this object alone, so it goes with it.
        this._material?.dispose();
        this._material = null;
        this.mesh.dispose();
        this.renderer.onObjectDisposed(this);
    }

    /** Whether `dispose` has run. */
    public get disposed(): boolean {
        return this._disposed;
    }

    /** Clips the object's own content to a rect in its local space. */
    public setScrollRect(x: number, y: number, w: number, h: number): void {
        this._scrollRect = new Rect(x, y, w, h);
    }
}

/** `true` when `value` is one of this backend's render objects. */
export function isBabRenderObject(value: unknown): value is BabRenderObject {
    return value instanceof BabRenderObject;
}
