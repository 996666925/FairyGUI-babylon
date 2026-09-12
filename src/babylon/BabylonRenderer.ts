import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Scene } from '@babylonjs/core/scene.js';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import { BlendMode } from '../core/FieldTypes.js';
import type {
    IRenderFactory,
    IRenderObject,
} from '../core/render/IRenderObject.js';
import { BabGraphObject } from './BabGraphObject.js';
import { BabImageObject } from './BabImageObject.js';
import { BabRenderObject } from './BabRenderObject.js';
import { BabTextObject } from './BabTextObject.js';
import { ClipStack } from './ClipRects.js';
import { Mat2D } from './Mat2D.js';
import {
    CanvasTextMetrics,
    defaultCanvasFactory,
    EstimatedTextMetrics,
    type CanvasFactory,
    type ITextMetricsProvider,
} from './TextLayout.js';
import { createUIMaterial, createWhiteTexture } from './UIShader.js';
import { BabylonPackageAssets } from './PackageAssets.js';
import { setRenderFactory } from '../core/render/IRenderObject.js';
import type { InputProcessor } from '../core/event/InputProcessor.js';
import { bindBabylonInput } from './BabylonInput.js';

/**
 * The Babylon layer a UI mesh lives on.
 *
 * Bit 28 is deliberate: Babylon's default `LayerMask` for cameras and meshes is
 * `0x0FFFFFFF` (bits 0–27), so a host camera and a host mesh never intersect this
 * bit. The UI camera sees the UI and nothing else, and the host camera sees
 * everything else and **not** the UI — with no change to the host's camera.
 */
export const UI_LAYER_MASK = 0x10000000;

/** Everything needed to build a backend. Every field has a working default. */
export interface BabylonRendererOptions {
    /** The host's scene. When omitted a scene is created over `engine`. */
    scene?: Scene;
    /** The host's engine. When neither this nor `scene` is given, a `NullEngine` is used. */
    engine?: AbstractEngine;
    /** Initial viewport in **UI units**. Defaults to the engine's render size scaled down. */
    width?: number;
    height?: number;
    /**
     * Builds the surfaces text is rasterised onto. Defaults to `OffscreenCanvas`
     * or a detached `<canvas>`; pass `null` to run without any rasteriser, in
     * which case text objects lay out but draw nothing.
     */
    createCanvas?: CanvasFactory | null;
    /** Overrides the text metrics; defaults to canvas 2D `measureText`. */
    textMetrics?: ITextMetricsProvider;
    /** Layer bit the UI meshes and the UI camera use. */
    uiLayerMask?: number;
    /** Distance of the orthographic camera behind the UI plane. */
    cameraZ?: number;
}

/**
 * The Babylon.js render backend for FairyGUI.
 *
 * ### Screen-space overlay
 *
 * The UI is an orthographic overlay with its own camera, so it is independent of
 * whatever camera the host scene is using. The camera is appended to
 * `scene.activeCameras` rather than being made `scene.activeCamera`, which leaves
 * the host's choice untouched; it also does not clear the colour buffer, so the
 * 3D scene underneath survives.
 *
 * ### Coordinate system
 *
 * One world unit is one UI unit. `uiRootNode` carries `scaling = (1, -1, 1)`,
 * which turns FairyGUI's y-down space into Babylon's y-up world, and its local
 * space *is* the UI space `localToGlobal` reports. That negative determinant
 * mirrors every triangle in the subtree, which is why meshes are built with
 * reversed winding and back-face culling disabled — see `GeometryBuilder`.
 */
export class BabylonRenderer implements IRenderFactory {
    /** The scene the UI is drawn into. */
    public readonly scene: Scene;
    /** The engine driving `scene`. */
    public readonly engine: AbstractEngine;
    /** The orthographic camera the UI is rendered with. */
    public readonly camera: Camera;
    /** Y-flipped root; its local space is the UI root space of the contract. */
    public readonly uiRootNode: TransformNode;
    /** Disabled node that unattached render objects are parked under. */
    public readonly holdingNode: TransformNode;
    /** Layer bit the UI meshes and camera use. */
    public readonly uiLayerMask: number;

    private readonly _ownScene: boolean;
    private readonly _ownEngine: boolean;
    private readonly _createCanvas: CanvasFactory | null;
    private readonly _metrics: ITextMetricsProvider;
    private readonly _whiteTexture: BaseTexture;

    /** Turns package atlases into textures. Install it to make images show art. */
    public readonly packageAssets: BabylonPackageAssets;
    private readonly _stageRoots: BabRenderObject[] = [];
    private readonly _resizeCallbacks: Array<(width: number, height: number) => void> = [];
    private readonly _scratch: Mat2D[] = [];
    private readonly _baseMatrix = new Mat2D();
    private readonly _emptyClipsInstance = new ClipStack();
    private readonly _rootInverse = Matrix.Identity();
    private _viewportWidth = 0;
    private _viewportHeight = 0;
    private _orderDirty = true;
    private _drawCounter = 0;
    private _disposed = false;
    private _inputCleanup: (() => void) | null = null;

    public constructor(options: BabylonRendererOptions = {}) {
        const uiLayerMask = options.uiLayerMask ?? UI_LAYER_MASK;

        if (options.scene) {
            this.scene = options.scene;
            this.engine = options.scene.getEngine();
            this._ownScene = false;
            this._ownEngine = false;
        } else {
            if (options.engine) {
                this.engine = options.engine;
                this._ownEngine = false;
            } else {
                const width = options.width ?? 1024;
                const height = options.height ?? 768;
                this.engine = new NullEngine({
                    renderWidth: Math.max(1, Math.round(width)),
                    renderHeight: Math.max(1, Math.round(height)),
                    textureSize: 512,
                    deterministicLockstep: false,
                    lockstepMaxSteps: 1,
                });
                this._ownEngine = true;
            }
            this.scene = new Scene(this.engine);
            this._ownScene = true;
        }

        this.uiLayerMask = uiLayerMask;
        this._createCanvas = options.createCanvas === undefined ? defaultCanvasFactory() : options.createCanvas;
        this._metrics = options.textMetrics
            ?? (this._createCanvas ? new CanvasTextMetrics(this._createCanvas) : new EstimatedTextMetrics());

        this.uiRootNode = new TransformNode('fgui-root', this.scene);
        // The one and only place the y-down contract meets Babylon's y-up world.
        this.uiRootNode.scaling.set(1, -1, 1);
        this.uiRootNode.position.set(0, 0, 0);

        this.holdingNode = new TransformNode('fgui-detached', this.scene);
        this.holdingNode.parent = this.uiRootNode;
        this.holdingNode.setEnabled(false);

        this.camera = this._createCamera(options.cameraZ ?? 1000);

        this._whiteTexture = createWhiteTexture(this.scene);

        // Created here but not installed: installing is a global side effect,
        // so it belongs to `installBabylonRenderer` where the caller can see it.
        this.packageAssets = new BabylonPackageAssets(this);

        const renderWidth = this.engine.getRenderWidth();
        const renderHeight = this.engine.getRenderHeight();
        this.setViewport(
            options.width ?? this._toUIUnits(renderWidth),
            options.height ?? this._toUIUnits(renderHeight),
        );

        this.scene.onBeforeRenderObservable.add(() => this.update());
    }

    // ---- factory ---------------------------------------------------------

    // The factory methods narrow their return types to the concrete classes.
    // That is still a valid implementation of `IRenderFactory` — return types
    // are covariant — and it means a caller holding the renderer directly can
    // reach the Babylon-specific surface (`babNode`, `commitGeometry`) without
    // casting at every use.
    public createObject(): BabRenderObject {
        return new BabRenderObject(this, 'fgui-object');
    }

    public createImage(): BabImageObject {
        return new BabImageObject(this, 'fgui-image');
    }

    public createText(): BabTextObject {
        return new BabTextObject(this, 'fgui-text');
    }

    public createGraph(): BabGraphObject {
        return new BabGraphObject(this, 'fgui-graph');
    }

    public attachToStage(node: IRenderObject): void {
        const object = BabRenderObject.require(node);
        object.attachTo(null);
        if (!this._stageRoots.includes(object))
            this._stageRoots.push(object);
        this._orderDirty = true;
    }

    // ---- viewport --------------------------------------------------------

    /** Current viewport width in UI units — not device pixels. */
    public get viewportWidth(): number {
        return this._viewportWidth;
    }

    /** Current viewport height in UI units — not device pixels. */
    public get viewportHeight(): number {
        return this._viewportHeight;
    }

    /**
     * Registers a resize callback.
     *
     * Every callback is kept; nothing is overwritten. The callback is **not**
     * invoked at registration — `viewportWidth` / `viewportHeight` are the way to
     * read the current size synchronously.
     */
    public onViewportResize(callback: (width: number, height: number) => void): void {
        this._resizeCallbacks.push(callback);
    }

    /** Connects the engine canvas to FairyGUI input when running in a browser. */
    public bindInput(input: InputProcessor): (() => void) | void {
        this._inputCleanup?.();
        const cleanup = bindBabylonInput(this.engine, input);
        if (!cleanup)
            return;
        this._inputCleanup = cleanup;
        return () => {
            if (this._inputCleanup === cleanup)
                this._inputCleanup = null;
            cleanup();
        };
    }

    /**
     * Resizes the UI viewport, in **UI units**.
     *
     * The orthographic box follows, so `GRoot`'s coordinate space and pointer
     * input stay in the same units. Hosts that own the canvas call this from their
     * own resize handler; `resizeToEngine()` reads the size off the engine
     * including any device-pixel-ratio scaling.
     */
    public setViewport(width: number, height: number): void {
        const w = Math.max(1, width);
        const h = Math.max(1, height);
        if (this._viewportWidth === w && this._viewportHeight === h)
            return;

        this._viewportWidth = w;
        this._viewportHeight = h;
        this.camera.orthoLeft = 0;
        this.camera.orthoRight = w;
        this.camera.orthoTop = 0;
        this.camera.orthoBottom = -h;

        for (const callback of this._resizeCallbacks)
            callback(w, h);
    }

    /**
     * Picks the viewport up from the engine, dividing out the hardware scaling
     * level so a device-pixel-ratio canvas still yields UI units.
     */
    public resizeToEngine(): void {
        this.setViewport(
            this._toUIUnits(this.engine.getRenderWidth()),
            this._toUIUnits(this.engine.getRenderHeight()),
        );
    }

    private _toUIUnits(renderSize: number): number {
        // Babylon's hardware scaling level is `1 / devicePixelRatio`, so the UI
        // size is the render size times that level.
        return renderSize * this.engine.getHardwareScalingLevel();
    }

    /**
     * Device pixels per UI unit — the factor text should rasterise at.
     *
     * The viewport is in CSS pixels while the backbuffer is not, so a glyph
     * rasterised one-for-one is magnified on a high-density display and reads as
     * soft. Multiplying the raster by this keeps a texel on a device pixel.
     */
    public get pixelRatio(): number {
        const level = this.engine.getHardwareScalingLevel();
        return level > 0 ? 1 / level : 1;
    }

    // ---- frame -----------------------------------------------------------

    /**
     * Refreshes everything that has to be recomputed per frame: world matrices,
     * accumulated alpha, clip stacks, draw order, and any geometry or text that
     * went dirty.
     *
     * Called automatically from `scene.onBeforeRenderObservable`, and public so a
     * headless test can drive it without a render loop.
     */
    public update(): void {
        if (this._disposed)
            return;

        this.uiRootNode.computeWorldMatrix(true);
        this.uiRootNode.getWorldMatrix().invertToRef(this._rootInverse);

        this._drawCounter = 0;
        this._baseMatrix.setIdentity();
        const noClips = this._emptyClips();
        for (const root of this._stageRoots)
            this._visit(root, this._baseMatrix, 1, noClips, 0);

        this._orderDirty = false;
    }

    private _emptyClips(): ClipStack {
        this._emptyClipsInstance.clear();
        return this._emptyClipsInstance;
    }

    private _visit(
        object: BabRenderObject,
        parentMatrix: Mat2D,
        parentAlpha: number,
        parentClips: ClipStack,
        depth: number,
    ): void {
        const local = this._scratchAt(depth);
        object.fillLocalToParent(local);
        object.uiMatrix.copy(parentMatrix).multiply(local);
        object.worldAlpha = parentAlpha * object.alpha;
        object.drawOrder = this._drawCounter++;

        const clips = object.clips;
        clips.copyFrom(parentClips);
        const scroll = object.scrollRect;
        if (scroll)
            clips.push(object.uiMatrix, scroll);

        object.commitGeometry();

        const children = object.babChildren;
        for (let i = 0; i < children.length; i++)
            this._visit(children[i], object.uiMatrix, object.worldAlpha, clips, depth + 1);
    }

    private _scratchAt(depth: number): Mat2D {
        let m = this._scratch[depth];
        if (!m) {
            m = new Mat2D();
            this._scratch[depth] = m;
        }
        return m;
    }

    /** Uploads the root's inverse world matrix to every material. */

    /** Marks the draw order stale; `update()` recomputes it unconditionally. */
    public invalidateDrawOrder(): void {
        this._orderDirty = true;
    }

    /** Whether the draw order needs recomputing. */
    public get drawOrderDirty(): boolean {
        return this._orderDirty;
    }

    // ---- resources -------------------------------------------------------

    /** The shader material for a blend mode, created once and shared. */
    /**
     * The root's inverse world matrix, for the `uRootInverse` uniform.
     *
     * Refreshed once per frame and read by every object as it binds.
     */
    public get rootInverse(): Matrix {
        return this._rootInverse;
    }

    /**
     * Builds a material for one object.
     *
     * A fresh material every time, deliberately. `uTexture` is a per-object
     * uniform, and a material shared between meshes only ever holds one value
     * for it: Babylon caches the sampler on the material, so every mesh drawing
     * with it samples whichever texture was assigned last. The symptom is
     * subtle — objects render, just with someone else's texture — and it only
     * shows when two objects want different images. The shader program itself
     * is still shared by Babylon's effect cache, so this costs a small
     * bookkeeping object per object, not a compilation.
     */
    public createMaterial(mode: BlendMode): ReturnType<typeof createUIMaterial> {
        const material = createUIMaterial(this.scene, 'fgui-ui-' + BlendMode[mode], mode);
        material.setMatrix('uRootInverse', this._rootInverse);
        return material;
    }

    /** 1×1 white texture, bound for objects that carry no texture. */
    public get whiteTexture(): BaseTexture {
        return this._whiteTexture;
    }

    /** The canvas factory text rasterisation uses, or `null` when unavailable. */
    public get canvasFactory(): CanvasFactory | null {
        return this._createCanvas;
    }

    /** The text metrics provider shared by every text object. */
    public get textMetrics(): ITextMetricsProvider {
        return this._metrics;
    }

    /** Called by `BabRenderObject.dispose`. */
    public onObjectDisposed(object: BabRenderObject): void {
        const index = this._stageRoots.indexOf(object);
        if (index !== -1)
            this._stageRoots.splice(index, 1);
        this._orderDirty = true;
    }

    /** Renders one frame: `update()` then `scene.render()`. */
    public render(): void {
        this.update();
        this.scene.render();
    }

    public dispose(): void {
        if (this._disposed)
            return;
        this._disposed = true;
        this._inputCleanup?.();
        this._inputCleanup = null;
        this._whiteTexture.dispose();
        this.uiRootNode.dispose();
        this.camera.dispose();
        if (this._ownScene)
            this.scene.dispose();
        if (this._ownEngine)
            this.engine.dispose();
    }

    // ---- internals -------------------------------------------------------

    private _createCamera(z: number): Camera {
        // `new FreeCamera(...)` claims `scene.activeCamera` when there is none;
        // the host's choice is restored below.
        const previous = this.scene.activeCamera;

        // Babylon 9 has no `OrthographicCamera` class any more: the orthographic
        // projection is a mode on `Camera`, driven by the `orthoLeft/Right/Top/
        // Bottom` box. It must be a *target* camera all the same — the base
        // `Camera` does not implement `_getViewMatrix`, so it leaves the view
        // matrix as the identity and ignores the position entirely. The
        // orthographic projection expects view-space z within `[minZ, maxZ]`, so
        // with an identity view every UI vertex lands outside the frustum and is
        // clipped away.
        const camera = new FreeCamera('fgui-camera', new Vector3(0, 0, -z), this.scene);
        camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
        camera.layerMask = this.uiLayerMask;
        camera.minZ = 1;
        camera.maxZ = z * 2 + 100;
        camera.orthoLeft = 0;
        camera.orthoRight = 1;
        camera.orthoTop = 0;
        camera.orthoBottom = -1;

        if (previous && previous !== camera) {
            // Put the host's camera back and render the overlay *after* it.
            this.scene.activeCamera = previous;
            // `scene.activeCameras` is an empty array by default, so its mere
            // truthiness says nothing: the host's camera has to be installed in
            // the list explicitly or it would stop rendering altogether.
            const cameras = this.scene.activeCameras;
            if (cameras && cameras.length > 0) {
                if (!cameras.includes(previous))
                    cameras.unshift(previous);
                cameras.push(camera);
            } else {
                this.scene.activeCameras = [previous, camera];
            }
            // The colour buffer is cleared once per frame by the scene, before
            // any camera draws (`Scene.autoClear` is not per-camera), so having
            // the overlay last in the list is all that is needed for it to
            // composite over the 3D scene rather than erase it.
        }
        return camera;
    }
}

/**
 * Builds a backend and installs it as the process-wide render factory.
 *
 * With no `scene` and no `engine` it runs on Babylon's `NullEngine`, which makes
 * the whole backend constructible in Node with no WebGL — the same path the tests
 * take.
 */
export function createBabylonRenderer(options: BabylonRendererOptions = {}): BabylonRenderer {
    return new BabylonRenderer(options);
}

/**
 * Creates the renderer and makes it the process-wide backend.
 *
 * Equivalent to `createBabylonRenderer` followed by `setRenderFactory` and
 * `renderer.packageAssets.install()`. Prefer this unless you are installing
 * several backends, since the core resolves both its nodes and its textures
 * through global hooks.
 */
export function installBabylonRenderer(options: BabylonRendererOptions = {}): BabylonRenderer {
    const renderer = createBabylonRenderer(options);
    setRenderFactory(renderer);
    renderer.packageAssets.install();
    return renderer;
}
