import { GComponent } from './GComponent.js';
import { GObject } from './GObject.js';
import { GRoot } from './GRoot.js';
import { UIConfig } from './UIConfig.js';
import { RelationType } from './FieldTypes.js';
import { EventType } from './event/Event.js';
import { UIPackage } from './UIPackage.js';

import type { Event } from './event/Event.js';
import type { IUISource } from './IUISource.js';

/**
 * A top-level panel: a component that knows how to show, hide, and centre
 * itself on a `GRoot`, with optional modal behaviour.
 *
 * A subclass supplies its own content — either by assigning `contentPane` or by
 * overriding `onInit` to build it.
 */
export class Window extends GComponent {
    private _contentPane: GComponent | null = null;
    private _modalWaitPane: GObject | null = null;
    private _closeButton: GObject | null = null;
    private _dragArea: GObject | null = null;
    private _contentArea: GObject | null = null;
    private _frame: GComponent | null = null;
    private _modal = false;

    private _uiSources: IUISource[] = [];
    private _inited = false;
    private _loading = false;

    /** Command token a `showModalWait` call was made with, for `closeModalWait`. */
    protected _requestingCmd = 0;

    public bringToFontOnClick: boolean;

    /** Marks this object so `GRoot` can recognise windows without importing this class. */
    public readonly isWindow = true;

    public constructor() {
        super();
        this.bringToFontOnClick = UIConfig.bringWindowToFrontOnClick;
        this.on(EventType.TOUCH_BEGIN, this.onTouchBegin_1, this);
    }

    /** Registers an external UI source that must load before `onInit` runs. */
    public addUISource(source: IUISource): void {
        this._uiSources.push(source);
    }

    public get contentPane(): GComponent | null {
        return this._contentPane;
    }

    public set contentPane(val: GComponent | null) {
        if (this._contentPane === val)
            return;

        if (this._contentPane)
            this.removeChild(this._contentPane);

        this._contentPane = val;
        if (!this._contentPane)
            return;

        this.addChild(this._contentPane);
        this.setSize(this._contentPane.width, this._contentPane.height);
        this._contentPane.addRelation(this, RelationType.Size);

        // The conventional frame hierarchy the editor emits for windows.
        this._frame = this._contentPane.getChild('frame') as GComponent | null;
        if (this._frame) {
            this.closeButton = this._frame.getChild('closeButton');
            this.dragArea = this._frame.getChild('dragArea');
            this.contentArea = this._frame.getChild('contentArea');
        }
    }

    public get frame(): GComponent | null {
        return this._frame;
    }

    public get closeButton(): GObject | null {
        return this._closeButton;
    }

    public set closeButton(value: GObject | null) {
        if (this._closeButton)
            this._closeButton.offClick(this.closeEventHandler, this);

        this._closeButton = value;

        if (this._closeButton)
            this._closeButton.onClick(this.closeEventHandler, this);
    }

    public get dragArea(): GObject | null {
        return this._dragArea;
    }

    public set dragArea(value: GObject | null) {
        if (this._dragArea === value)
            return;

        if (this._dragArea) {
            this._dragArea.draggable = false;
            this._dragArea.off(EventType.DRAG_START, this.onDragStart_1, this);
        }

        this._dragArea = value;
        if (this._dragArea) {
            this._dragArea.draggable = true;
            this._dragArea.on(EventType.DRAG_START, this.onDragStart_1, this);
        }
    }

    public get contentArea(): GObject | null {
        return this._contentArea;
    }

    public set contentArea(value: GObject | null) {
        this._contentArea = value;
    }

    // ---- showing and hiding ----------------------------------------------

    public show(): void {
        GRoot.inst.showWindow(this);
    }

    public showOn(root: GRoot): void {
        root.showWindow(this);
    }

    public hide(): void {
        if (this.isShowing)
            this.doHideAnimation();
    }

    public hideImmediately(): void {
        const parent = this.parent as unknown as { isRoot?: boolean } | null;
        const r = parent?.isRoot ? this.parent as unknown as GRoot : GRoot.inst;
        r.hideWindowImmediately(this);
    }

    public centerOn(r: GRoot, restraint = false): void {
        this.setPosition(
            Math.round((r.width - this.width) / 2),
            Math.round((r.height - this.height) / 2),
        );
        if (restraint) {
            this.addRelation(r, RelationType.Center_Center);
            this.addRelation(r, RelationType.Middle_Middle);
        }
    }

    public toggleStatus(): void {
        if (this.isTop)
            this.hide();
        else
            this.show();
    }

    public get isShowing(): boolean {
        return this.parent != null;
    }

    public get isTop(): boolean {
        const p = this.parent;
        return p != null && p.getChildIndex(this) === p.numChildren - 1;
    }

    public get modal(): boolean {
        return this._modal;
    }

    public set modal(val: boolean) {
        this._modal = val;
    }

    public bringToFront(): void {
        this.root?.bringToFront(this);
    }

    // ---- modal wait ------------------------------------------------------

    public showModalWait(requestingCmd?: number): void {
        if (requestingCmd != null)
            this._requestingCmd = requestingCmd;

        if (!UIConfig.windowModalWaiting)
            return;

        if (!this._modalWaitPane)
            this._modalWaitPane = UIPackage.createObjectFromURL(UIConfig.windowModalWaiting);

        if (!this._modalWaitPane)
            return;

        this.layoutModalWaitPane();
        this.addChild(this._modalWaitPane);
    }

    /**
     * Places the spinner over the content area when the frame defines one, so
     * it does not cover the window's title bar and borders.
     */
    protected layoutModalWaitPane(): void {
        if (!this._modalWaitPane)
            return;

        if (this._contentArea && this._frame) {
            const pt = this._frame.localToGlobal(0, 0);
            this.globalToLocal(pt.x, pt.y, pt);
            this._modalWaitPane.setPosition(pt.x + this._contentArea.x, pt.y + this._contentArea.y);
            this._modalWaitPane.setSize(this._contentArea.width, this._contentArea.height);
        } else {
            this._modalWaitPane.setSize(this.width, this.height);
        }
    }

    /**
     * @returns `false` when `requestingCmd` does not match the command the
     *   current wait was opened for — a stale completion, which is ignored.
     */
    public closeModalWait(requestingCmd?: number): boolean {
        if (requestingCmd != null && this._requestingCmd !== requestingCmd)
            return false;

        this._requestingCmd = 0;

        if (this._modalWaitPane?.parent)
            this.removeChild(this._modalWaitPane);

        return true;
    }

    public get modalWaiting(): boolean {
        return this._modalWaitPane != null && this._modalWaitPane.parent != null;
    }

    // ---- lifecycle -------------------------------------------------------

    /** Runs `onInit` once every registered UI source has loaded. */
    public init(): void {
        if (this._inited || this._loading)
            return;

        if (this._uiSources.length > 0) {
            this._loading = false;
            for (const lib of this._uiSources) {
                if (!lib.loaded) {
                    lib.load(this.__uiLoadComplete, this);
                    this._loading = true;
                }
            }

            if (!this._loading)
                this._init();
        } else {
            this._init();
        }
    }

    /** Where a subclass builds its content. Called once. */
    protected onInit(): void {
    }

    protected onShown(): void {
    }

    protected onHide(): void {
    }

    protected doShowAnimation(): void {
        this.onShown();
    }

    protected doHideAnimation(): void {
        this.hideImmediately();
    }

    private __uiLoadComplete = (): void => {
        for (const lib of this._uiSources) {
            if (!lib.loaded)
                return;
        }
        this._loading = false;
        this._init();
    };

    private _init(): void {
        this._inited = true;
        this.onInit();

        if (this.isShowing)
            this.doShowAnimation();
    }

    public dispose(): void {
        if (this.parent)
            this.hideImmediately();

        super.dispose();
    }

    protected closeEventHandler(_evt: Event): void {
        this.hide();
    }

    protected onEnable(): void {
        super.onEnable();

        if (!this._inited)
            this.init();
        else
            this.doShowAnimation();
    }

    protected onDisable(): void {
        super.onDisable();
        this.closeModalWait();
        this.onHide();
    }

    private onTouchBegin_1 = (_evt: Event): void => {
        if (this.isShowing && this.bringToFontOnClick)
            this.bringToFront();
    };

    /**
     * The drag area drags the whole window rather than itself, so the child
     * hands the drag over and stops its own.
     */
    private onDragStart_1 = (evt: Event): void => {
        const original = evt.currentTarget as GObject | null;
        original?.stopDrag();
        this.startDrag(evt.touchId);
    };
}
