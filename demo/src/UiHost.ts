import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import type { Scene } from '@babylonjs/core/scene.js';
import {
    GComponent,
    GRoot,
    installBabylonRenderer,
    type BabylonRenderer,
    type GObject,
} from 'fairygui-babylon';

/**
 * Owns the Babylon engine, the UI renderer and the root, and keeps them in step
 * with the window.
 *
 * ### UI units are CSS pixels
 *
 * The viewport is set in CSS pixels rather than device pixels, so one UI unit
 * is one CSS pixel and a pointer position maps across with no scaling at all.
 * On a high-DPI screen the UI is therefore rendered at the device resolution
 * but laid out at the CSS size — which is what a UI authored in the editor
 * against a device-sized artboard expects.
 */
export class UiHost {
    public readonly engine: AbstractEngine;
    public readonly renderer: BabylonRenderer;
    public readonly root: GRoot;

    private readonly _canvas: HTMLCanvasElement;
    /** Wrapper holding the current component; what actually gets placed. */
    private _frame: GComponent | null = null;
    private _content: GObject | null = null;

    public constructor(canvas: HTMLCanvasElement, engine: AbstractEngine, scene: Scene) {
        this._canvas = canvas;
        this.engine = engine;

        const { width, height } = this._cssSize();
        this.renderer = installBabylonRenderer({ scene, width, height });
        this.root = GRoot.create();

        window.addEventListener('resize', this._onResize);

        this.engine.runRenderLoop(() => {
            const dt = this.engine.getDeltaTime() / 1000;
            // The root drives every deferred callback, tween and widget update.
            this.root.update(dt);
            scene.render();
        });
    }

    /**
     * Shows `obj`, replacing whatever was there.
     *
     * The previous object is disposed rather than detached, so a viewer that
     * swaps components repeatedly does not accumulate display lists.
     */
    public show(obj: GObject): void {
        this.clear();

        // The component is wrapped rather than positioned directly: it carries
        // its own pivot, scale and relations from the editor, and the fit below
        // would be fighting them. A frame of the component's own size leaves all
        // of that alone and gives one thing to place.
        const frame = new GComponent();
        frame.setSize(obj.width, obj.height);
        frame.addChild(obj);

        this._frame = frame;
        this._content = obj;
        this.root.addChild(frame);
        this.layout();
    }

    public clear(): void {
        if (this._frame) {
            this.root.removeChild(this._frame);
            this._frame.dispose();
            this._frame = null;
            this._content = null;
            return;
        }
        // Anything added by other means (a window, a popup) goes too.
        this.root.removeChildren(0, -1, true);
    }

    public get current(): GObject | null {
        return this._content;
    }

    /**
     * Centres the current content in the clear area, shrinking it when it would
     * not fit.
     *
     * Components are authored against a fixed artboard — 1136x640 and the like —
     * so one is routinely larger than the window. Scaling only ever shrinks: a
     * component that fits is shown at its authored size.
     *
     * The sample application does not come through here: its screens call
     * `makeFullScreen` and add themselves to the root directly.
     */
    public layout(): void {
        if (!this._frame)
            return;

        const w = Math.max(1, this._frame.width);
        const h = Math.max(1, this._frame.height);
        const availW = Math.max(1, this.root.width);
        const availH = Math.max(1, this.root.height);

        const scale = Math.min(1, availW / w, availH / h);
        this._frame.setScale(scale, scale);
        this._frame.setPosition((availW - w * scale) / 2, (availH - h * scale) / 2);
    }

    public dispose(): void {
        window.removeEventListener('resize', this._onResize);
        this.renderer.packageAssets.dispose();
        this.renderer.dispose();
    }

    // ---- internals -------------------------------------------------------

    private _cssSize(): { width: number; height: number } {
        const rect = this._canvas.getBoundingClientRect();
        return {
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
        };
    }

    private _onResize = (): void => {
        this.engine.resize();
        const { width, height } = this._cssSize();
        // The renderer tells the root through the callback it registered, so
        // `GRoot` follows the window with no extra wiring here.
        this.renderer.setViewport(width, height);
        // The root has its new size by now, so the content can be re-centred.
        this.layout();
    };
}
