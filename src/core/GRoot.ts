import { GComponent } from './GComponent.js';
import { GGraph } from './GGraph.js';
import { GObject } from './GObject.js';
import { UIConfig } from './UIConfig.js';
import { Color } from './utils/Color.js';
import { Point } from './utils/Geometry.js';
import { RelationType, PopupDirection } from './FieldTypes.js';
import type { Event } from './event/Event.js';
import { InputProcessor } from './event/InputProcessor.js';
import { UIPackage } from './UIPackage.js';
import { getRenderFactory, type IRenderFactory } from './render/IRenderObject.js';
import { scheduler } from './Scheduler.js';
import { globalState } from './State.js';
import { setStage } from './Stage.js';
import { TweenManager } from './tween/TweenManager.js';

import type { Window } from './Window.js';

/** Shape `GRoot` needs from `Window`; avoids importing it at runtime. */
interface WindowLike extends GObject {
    readonly isWindow: true;
    modal: boolean;
    hide(): void;
}

function asWindow(obj: GObject | null): WindowLike | null {
    return obj && (obj as unknown as WindowLike).isWindow === true ? obj as unknown as WindowLike : null;
}

/**
 * The root of a UI display list.
 *
 * Everything that is not parented to something else ends up here. The root owns
 * the input processor, the modal layer, the popup stack and the tooltip window,
 * and it is the clock that drives deferred callbacks and tweens.
 */
export class GRoot extends GComponent {
    private _modalLayer: GGraph;
    private _popupStack: GObject[] = [];
    private _justClosedPopups: GObject[] = [];
    private _modalWaitPane: GObject | null = null;
    private _tooltipWin: GObject | null = null;
    private _defaultTooltipWin: GObject | null = null;
    private _volumeScale = 1;
    private _inputProcessor: InputProcessor;

    private static _inst: GRoot | null = null;

    /** Marks this object as the root, so `GObject.root` stops walking here. */
    public readonly isRoot = true;

    /**
     * Which entry of a `PackageItem.highResolution` list to use, `0` meaning the
     * standard assets. Derived from the viewport scale on resize.
     */
    public static get contentScaleLevel(): number {
        return globalState.contentScaleLevel;
    }

    public static set contentScaleLevel(value: number) {
        globalState.contentScaleLevel = value;
    }

    public static get inst(): GRoot {
        if (!GRoot._inst)
            throw new Error('fairygui: call GRoot.create() first.');
        return GRoot._inst;
    }

    /** The active root, or `null` if none was created yet. */
    public static get hasInstance(): boolean {
        return GRoot._inst !== null;
    }

    /**
     * Returns the root, creating it on first call.
     *
     * The root is a singleton, and it binds to the render backend at creation —
     * so an existing root is re-bound to whatever backend is current. Without
     * that, a host that swaps backends (hot reload, a second canvas, a test
     * suite with several renderers) would keep a root wired to the old one,
     * silently ignoring viewport changes.
     */
    public static create(): GRoot {
        if (GRoot._inst) {
            GRoot._inst.bindTo(getRenderFactory());
            return GRoot._inst;
        }
        const root = new GRoot();
        setStage(root);
        return root;
    }

    public constructor() {
        super();

        GRoot._inst = this;
        this.opaque = false;
        this._volumeScale = 1;

        this._modalLayer = new GGraph();
        this._modalLayer.setSize(this.width, this.height);
        this._modalLayer.drawRect(0, new Color(0, 0, 0, 0), UIConfig.modalLayerColor);
        this._modalLayer.addRelation(this, RelationType.Size);

        this._inputProcessor = new InputProcessor(this);
        this._inputProcessor.onTouchBeginHook = (evt) => this.onTouchBeginHook(evt);

        this.bindTo(getRenderFactory());
    }

    /** The backend this root is currently wired to. */
    private _boundFactory: IRenderFactory | null = null;
    private _inputBindingCleanup: (() => void) | null = null;

    /**
     * Attaches this root to a backend and follows its viewport.
     *
     * @internal Called by the constructor and by `create` when an existing root
     *   is handed to a different backend.
     */
    private bindTo(factory: IRenderFactory): void {
        if (this._boundFactory === factory)
            return;

        this._inputBindingCleanup?.();
        this._inputBindingCleanup = null;
        this._boundFactory = factory;
        factory.attachToStage(this._node);
        factory.onViewportResize((w, h) => this.applyViewport(w, h));
        this.applyViewport(factory.viewportWidth, factory.viewportHeight);
        this._inputBindingCleanup = factory.bindInput?.(this._inputProcessor) ?? null;
    }

    public getTouchPosition(touchId = -1, result?: Point): Point {
        return this._inputProcessor.getTouchPosition(touchId, result);
    }

    public get touchTarget(): GObject | null {
        return this._inputProcessor.getTouchTarget();
    }

    public get inputProcessor(): InputProcessor {
        return this._inputProcessor;
    }

    // ---- viewport --------------------------------------------------------

    /**
     * Resizes the root to the viewport and re-derives the content scale level.
     *
     * @param width in UI units.
     * @param height in UI units.
     */
    public applyViewport(width: number, height: number): void {
        this.setSize(width, height);
        this.updateContentScaleLevel();
    }

    /**
     * Picks the high-resolution variant matching the viewport scale.
     *
     * The reference derived this from `cc.view.getScaleX()` — the engine's
     * device-pixel ratio. Here it is inferred from the viewport itself, which
     * is the same quantity expressed in the units the core works in.
     */
    private updateContentScaleLevel(): void {
        const scale = Math.max(this._pixelRatioHint, 1);
        if (scale >= 3.5)
            globalState.contentScaleLevel = 3;
        else if (scale >= 2.5)
            globalState.contentScaleLevel = 2;
        else if (scale >= 1.5)
            globalState.contentScaleLevel = 1;
        else
            globalState.contentScaleLevel = 0;
    }

    /** Set by the backend when it knows the device pixel ratio. */
    public _pixelRatioHint = 1;

    /** The root never moves relative to the viewport. */
    protected handlePositionChanged(): void {
        // Intentionally empty: the root's position is owned by the backend.
    }

    // ---- clock -----------------------------------------------------------

    /**
     * Advances everything the root schedules.
     *
     * The host calls this once per frame with its own delta. Passing `dt` in
     * rather than reading a clock keeps animations reproducible in tests.
     */
    public update(dt: number): void {
        scheduler.update(dt);
        TweenManager.update(dt);
        this.updateChildren(dt);
    }

    private updateChildren(dt: number): void {
        for (const child of this._children)
            child.onUpdate(dt);
    }

    // ---- windows ---------------------------------------------------------

    public showWindow(win: Window): void {
        this.addChild(win);
        win.requestFocus();

        if (win.x > this.width)
            win.x = this.width - win.width;
        else if (win.x + win.width < 0)
            win.x = 0;

        if (win.y > this.height)
            win.y = this.height - win.height;
        else if (win.y + win.height < 0)
            win.y = 0;

        this.adjustModalLayer();
    }

    public hideWindow(win: Window): void {
        win.hide();
    }

    public hideWindowImmediately(win: Window): void {
        if (win.parent === this)
            this.removeChild(win);
        this.adjustModalLayer();
    }

    /** Raises `win` to just above the most recent window below it. */
    public bringToFront(win: Window): void {
        const cnt = this.numChildren;
        let i: number;
        if (this._modalLayer.parent && !win.modal) {
            // Do not rise above the modal layer.
            i = this.getChildIndex(this._modalLayer) - 1;
        } else {
            i = cnt - 1;
        }

        for (; i >= 0; i--) {
            const g = this.getChildAt(i);
            if (g === win)
                return;
            if (asWindow(g))
                break;
        }

        if (i >= 0)
            this.setChildIndex(win, i);
    }

    public closeAllExceptModals(): void {
        for (const g of this._children.slice()) {
            const win = asWindow(g);
            if (win && !win.modal)
                win.hide();
        }
    }

    public closeAllWindows(): void {
        for (const g of this._children.slice()) {
            const win = asWindow(g);
            if (win)
                win.hide();
        }
    }

    public getTopWindow(): Window | null {
        for (let i = this.numChildren - 1; i >= 0; i--) {
            const win = asWindow(this.getChildAt(i));
            if (win)
                return win as unknown as Window;
        }
        return null;
    }

    public get modalLayer(): GGraph {
        return this._modalLayer;
    }

    public get hasModalWindow(): boolean {
        return this._modalLayer.parent !== null;
    }

    public get modalWaiting(): boolean {
        return this._modalWaitPane !== null && this._modalWaitPane.onStage;
    }

    public showModalWait(msg?: string): void {
        if (UIConfig.globalModalWait == null)
            return;

        if (this._modalWaitPane == null)
            this._modalWaitPane = UIPackage.createObjectFromURL(UIConfig.globalModalWait);

        if (!this._modalWaitPane)
            return;

        this._modalWaitPane.setSize(this.width, this.height);
        this._modalWaitPane.addRelation(this, RelationType.Size);
        this.addChild(this._modalWaitPane);
        this._modalWaitPane.text = msg ?? null;
    }

    public closeModalWait(): void {
        if (this._modalWaitPane?.parent)
            this.removeChild(this._modalWaitPane);
    }

    // ---- popups ----------------------------------------------------------

    /** Computes where `popup` should sit relative to `target`. */
    public getPopupPosition(
        popup: GObject, target?: GObject | null,
        dir?: PopupDirection | boolean, result?: Point,
    ): Point {
        const pos = result ?? new Point();
        let sizeW = 0;
        let sizeH = 0;

        if (target) {
            target.localToGlobal(0, 0, pos);
            const pos2 = target.localToGlobal(target.width, target.height);
            sizeW = pos2.x - pos.x;
            sizeH = pos2.y - pos.y;
        } else {
            this.getTouchPosition(-1, pos);
            this.globalToLocal(pos.x, pos.y, pos);
        }

        if (pos.x + popup.width > this.width)
            pos.x = pos.x + sizeW - popup.width;
        pos.y += sizeH;

        const wantUp = ((dir === undefined || dir === PopupDirection.Auto) && pos.y + popup.height > this.height)
            || dir === false
            || dir === PopupDirection.Up;

        if (wantUp) {
            pos.y = pos.y - sizeH - popup.height - 1;
            if (pos.y < 0) {
                pos.y = 0;
                pos.x += sizeW / 2;
            }
        }

        return pos;
    }

    public showPopup(popup: GObject, target?: GObject | null, dir?: PopupDirection | boolean): void {
        if (this._popupStack.length > 0) {
            const k = this._popupStack.indexOf(popup);
            if (k !== -1) {
                // Re-showing an open popup closes everything above it first.
                for (let i = this._popupStack.length - 1; i >= k; i--)
                    this.removeChild(this._popupStack.pop()!);
            }
        }
        this._popupStack.push(popup);

        if (target) {
            // A popup anchored to a child must draw above that child's window.
            let p: GObject | null = target;
            while (p) {
                if (p.parent === this) {
                    if (popup.sortingOrder < p.sortingOrder)
                        popup.sortingOrder = p.sortingOrder;
                    break;
                }
                p = p.parent;
            }
        }

        this.addChild(popup);
        this.adjustModalLayer();

        const pt = this.getPopupPosition(popup, target, dir);
        popup.setPosition(pt.x, pt.y);
    }

    /** Like `showPopup`, but does nothing if this popup just closed on this press. */
    public togglePopup(popup: GObject, target?: GObject | null, dir?: PopupDirection | boolean): void {
        if (this._justClosedPopups.indexOf(popup) !== -1)
            return;
        this.showPopup(popup, target, dir);
    }

    public hidePopup(popup?: GObject): void {
        if (popup) {
            const k = this._popupStack.indexOf(popup);
            if (k !== -1) {
                for (let i = this._popupStack.length - 1; i >= k; i--)
                    this.closePopup(this._popupStack.pop()!);
            }
        } else {
            for (let i = this._popupStack.length - 1; i >= 0; i--)
                this.closePopup(this._popupStack[i]);
            this._popupStack.length = 0;
        }
    }

    public get hasAnyPopup(): boolean {
        return this._popupStack.length !== 0;
    }

    private closePopup(target: GObject): void {
        if (!target.parent)
            return;

        const win = asWindow(target);
        if (win)
            win.hide();
        else
            this.removeChild(target);
    }

    // ---- tooltips --------------------------------------------------------

    public showTooltips(msg: string): void {
        if (this._defaultTooltipWin == null) {
            const resourceURL = UIConfig.tooltipsWin;
            if (!resourceURL) {
                console.error('fairygui: UIConfig.tooltipsWin is not defined, so tooltips cannot be shown.');
                return;
            }
            this._defaultTooltipWin = UIPackage.createObjectFromURL(resourceURL);
        }

        if (!this._defaultTooltipWin)
            return;

        this._defaultTooltipWin.text = msg;
        this.showTooltipsWin(this._defaultTooltipWin);
    }

    public showTooltipsWin(tooltipWin: GObject): void {
        this.hideTooltips();
        this._tooltipWin = tooltipWin;

        const pt = this.getTouchPosition();
        pt.x += 10;
        pt.y += 20;
        this.globalToLocal(pt.x, pt.y, pt);

        if (pt.x + tooltipWin.width > this.width) {
            pt.x = pt.x - tooltipWin.width - 1;
            if (pt.x < 0)
                pt.x = 10;
        }
        if (pt.y + tooltipWin.height > this.height) {
            pt.y = pt.y - tooltipWin.height - 1;
            if (pt.y < 0)
                pt.y = 10;
        }

        tooltipWin.setPosition(pt.x, pt.y);
        this.addChild(tooltipWin);
    }

    public hideTooltips(): void {
        if (!this._tooltipWin)
            return;
        if (this._tooltipWin.parent)
            this.removeChild(this._tooltipWin);
        this._tooltipWin = null;
    }

    // ---- audio -----------------------------------------------------------

    public get volumeScale(): number {
        return this._volumeScale;
    }

    public set volumeScale(value: number) {
        this._volumeScale = value;
    }

    /**
     * Plays a one-shot sound.
     *
     * No audio backend is bundled; `soundPlayer` is the seam a host fills in.
     * With none installed this is a no-op rather than an error, since UI code
     * calls it unconditionally on button clicks.
     */
    public soundPlayer: ((sound: unknown, volume: number) => void) | null = null;

    public playOneShotSound(clip: unknown, volumeScale = 1): void {
        this.soundPlayer?.(clip, this._volumeScale * volumeScale);
    }

    // ---- internals -------------------------------------------------------

    /** Keeps the modal scrim directly beneath the topmost modal window. */
    private adjustModalLayer(): void {
        const cnt = this.numChildren;

        if (this._modalWaitPane?.parent)
            this.setChildIndex(this._modalWaitPane, cnt - 1);

        for (let i = cnt - 1; i >= 0; i--) {
            const win = asWindow(this.getChildAt(i));
            if (win && win.modal) {
                if (this._modalLayer.parent == null)
                    this.addChildAt(this._modalLayer, i);
                else
                    this.setChildIndexBefore(this._modalLayer, i);
                return;
            }
        }

        if (this._modalLayer.parent)
            this.removeChild(this._modalLayer);
    }

    /** Runs before any press is dispatched: closes popups and tooltips. */
    private onTouchBeginHook(evt: Event): void {
        if (this._tooltipWin)
            this.hideTooltips();

        this._justClosedPopups.length = 0;
        if (this._popupStack.length === 0)
            return;

        // A press inside a popup closes only the popups stacked above it.
        let mc: GObject | null = evt.initiator as GObject | null;
        while (mc && mc !== this) {
            const pindex = this._popupStack.indexOf(mc);
            if (pindex !== -1) {
                for (let i = this._popupStack.length - 1; i > pindex; i--) {
                    const popup = this._popupStack.pop()!;
                    this.closePopup(popup);
                    this._justClosedPopups.push(popup);
                }
                return;
            }
            mc = mc.findParent();
        }

        for (let i = this._popupStack.length - 1; i >= 0; i--) {
            const popup = this._popupStack[i];
            this.closePopup(popup);
            this._justClosedPopups.push(popup);
        }
        this._popupStack.length = 0;
    }
}
