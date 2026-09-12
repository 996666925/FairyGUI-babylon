import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { PackageItem } from './PackageItem.js';
import { BlendMode, ObjectPropID, RelationType } from './FieldTypes.js';
import { Point, Rect } from './utils/Geometry.js';
import { UIConfig } from './UIConfig.js';
import { Event, EventType } from './event/Event.js';
import { EventDispatcher, type Listener } from './event/EventDispatcher.js';
import { getRenderFactory, type IRenderObject } from './render/IRenderObject.js';
import { findRootOf } from './Stage.js';
import { applyBlendMode } from './render/BlendModeUtils.js';
import { GearBase } from './gears/GearBase.js';
import { Relations } from './Relations.js';
import { scheduler } from './Scheduler.js';

import type { GearDisplay } from './gears/GearDisplay.js';
import type { GearDisplay2 } from './gears/GearDisplay2.js';
import type { GearXY } from './gears/GearXY.js';
import type { GearSize } from './gears/GearSize.js';
import type { GearLook } from './gears/GearLook.js';
import type { GComponent } from './GComponent.js';
import type { GGroup } from './GGroup.js';
import type { GRoot } from './GRoot.js';
import type { Controller } from './Controller.js';
import type { GTreeNode } from './GTreeNode.js';
import type { GButton } from './GButton.js';
import type { GLabel } from './GLabel.js';
import type { GProgressBar } from './GProgressBar.js';
import type { GTextField } from './GTextField.js';
import type { GRichTextField } from './GRichTextField.js';
import type { GTextInput } from './GTextInput.js';
import type { GLoader } from './GLoader.js';
import type { GList } from './GList.js';
import type { GTree } from './GTree.js';
import type { GGraph } from './GGraph.js';
import type { GSlider } from './GSlider.js';
import type { GComboBox } from './GComboBox.js';
import type { GImage } from './GImage.js';
import type { GMovieClip } from './GMovieClip.js';

let _nextId = 0;

// Scratch objects for drag handling, so dragging does not allocate per frame.
const sGlobalDragStart = new Point();
const sGlobalRect = new Rect();
const sHelperPoint = new Point();
const sDragHelperRect = new Rect();
let sUpdateInDragging = false;
let sDragQuery = false;

export class GObject {
    public data?: unknown;
    public packageItem?: PackageItem;

    /** The object currently being dragged, or `null`. Only one at a time. */
    public static draggingObject: GObject | null = null;

    protected _x = 0;
    protected _y = 0;
    protected _alpha = 1;
    protected _visible = true;
    protected _touchable = true;
    protected _grayed = false;
    protected _draggable = false;
    protected _skewX = 0;
    protected _skewY = 0;
    protected _pivotAsAnchor = false;
    protected _sortingOrder = 0;
    /** Set by `GearDisplay`; combined with `_visible` to give `_finalVisible`. */
    protected _internalVisible = true;
    protected _handlingController = false;
    protected _tooltips: string | null = null;
    protected _blendMode: BlendMode = BlendMode.Normal;
    protected _pixelSnapping = false;
    protected _dragTesting = false;
    protected _dragStartPos: Point | null = null;

    protected _relations: Relations;
    protected _group: GGroup | null = null;
    protected _gears: Array<GearBase | null>;
    protected _node: IRenderObject;
    protected _dragBounds: Rect | null = null;

    public sourceWidth = 0;
    public sourceHeight = 0;
    public initWidth = 0;
    public initHeight = 0;
    public minWidth = 0;
    public minHeight = 0;
    public maxWidth = 0;
    public maxHeight = 0;

    public _parent: GComponent | null = null;
    public _width = 0;
    public _height = 0;
    public _rawWidth = 0;
    public _rawHeight = 0;
    public _id: string;
    public _name = '';
    public _underConstruct = false;
    public _gearLocked = false;
    public _sizePercentInGroup = 0;
    public _touchDisabled = false;
    /** True when a `DISPLAY`/`UNDISPLAY` listener was ever registered. */
    public _emitDisplayEvents = false;
    public _treeNode?: GTreeNode;

    private _hitTestPt = new Point();
    private _disposed = false;
    /** Whether this object has been told it is live; see `checkEnabled`. */
    private _enabled = false;
    private _dispatcher = new EventDispatcher();

    /**
     * Builds this object's render node.
     *
     * Overridden by widgets that need a drawing node rather than a bare
     * transform — `GImage` wants a textured quad, `GTextField` a text surface.
     * Called from the constructor, so overrides must not touch subclass fields:
     * those are still being initialised at that point.
     */
    protected createDisplayObject(): IRenderObject {
        return getRenderFactory().createObject();
    }

    public constructor() {
        this._node = this.createDisplayObject();
        this._node.userData = this;
        this._id = 'g' + (++_nextId);

        this._relations = new Relations(this);
        this._gears = new Array<GearBase | null>(10).fill(null);
    }

    public get id(): string {
        return this._id;
    }

    public get name(): string {
        return this._name;
    }

    public set name(value: string) {
        this._name = value;
    }

    /** The backend node this object draws into. */
    public get node(): IRenderObject {
        return this._node;
    }

    public get parent(): GComponent | null {
        return this._parent;
    }

    public get dispatcher(): EventDispatcher {
        return this._dispatcher;
    }

    // ---- position --------------------------------------------------------

    public get x(): number {
        return this._x;
    }

    public set x(value: number) {
        this.setPosition(value, this._y);
    }

    public get y(): number {
        return this._y;
    }

    public set y(value: number) {
        this.setPosition(this._x, value);
    }

    public setPosition(xv: number, yv: number): void {
        if (this._x === xv && this._y === yv)
            return;

        const dx = xv - this._x;
        const dy = yv - this._y;
        this._x = xv;
        this._y = yv;

        this.handlePositionChanged();
        this.onMoved(dx, dy);

        this.updateGear(1);

        if (this._parent) {
            this._parent.handleChildPositionChanged(this);
            if (this._group)
                this._group.setBoundsChangedFlag(true);
            this._dispatcher.emit(EventType.XY_CHANGED, this);
        }

        if (GObject.draggingObject === this && !sUpdateInDragging)
            this.localToGlobalRect(0, 0, this._width, this._height, sGlobalRect);
    }

    /** Left edge of the content box, accounting for the pivot when it is an anchor. */
    public get xMin(): number {
        return this._pivotAsAnchor ? this._x - this._width * this._node.pivotX : this._x;
    }

    public set xMin(value: number) {
        this.setPosition(this._pivotAsAnchor ? value + this._width * this._node.pivotX : value, this._y);
    }

    public get yMin(): number {
        return this._pivotAsAnchor ? this._y - this._height * this._node.pivotY : this._y;
    }

    public set yMin(value: number) {
        this.setPosition(this._x, this._pivotAsAnchor ? value + this._height * this._node.pivotY : value);
    }

    public get pixelSnapping(): boolean {
        return this._pixelSnapping;
    }

    public set pixelSnapping(value: boolean) {
        if (this._pixelSnapping !== value) {
            this._pixelSnapping = value;
            this.handlePositionChanged();
        }
    }

    /** Centres the object in its parent, or in the root when it has none. */
    public center(restraint = false): void {
        const r = this._parent ?? this.root;
        if (!r)
            return;

        this.setPosition((r.width - this._width) / 2, (r.height - this._height) / 2);
        if (restraint) {
            this.addRelation(r, RelationType.Center_Center);
            this.addRelation(r, RelationType.Middle_Middle);
        }
    }

    // ---- size ------------------------------------------------------------

    public get width(): number {
        this.ensureSizeCorrect();
        if (this._relations.sizeDirty)
            this._relations.ensureRelationsSizeCorrect();
        return this._width;
    }

    public set width(value: number) {
        this.setSize(value, this._rawHeight);
    }

    public get height(): number {
        this.ensureSizeCorrect();
        if (this._relations.sizeDirty)
            this._relations.ensureRelationsSizeCorrect();
        return this._height;
    }

    public set height(value: number) {
        this.setSize(this._rawWidth, value);
    }

    public setSize(wv: number, hv: number, ignorePivot = false): void {
        if (this._rawWidth === wv && this._rawHeight === hv)
            return;

        this._rawWidth = wv;
        this._rawHeight = hv;
        if (wv < this.minWidth)
            wv = this.minWidth;
        if (hv < this.minHeight)
            hv = this.minHeight;
        if (this.maxWidth > 0 && wv > this.maxWidth)
            wv = this.maxWidth;
        if (this.maxHeight > 0 && hv > this.maxHeight)
            hv = this.maxHeight;

        const dWidth = wv - this._width;
        const dHeight = hv - this._height;
        this._width = wv;
        this._height = hv;

        this.handleSizeChanged();

        if ((this._node.pivotX !== 0 || this._node.pivotY !== 0) && !this._pivotAsAnchor && !ignorePivot) {
            // Keep the top-left corner put when the box changes under a pivot.
            this.setPosition(
                this.x - this._node.pivotX * dWidth,
                this.y - this._node.pivotY * dHeight,
            );
        } else {
            this.handlePositionChanged();
        }

        this.onResized(dWidth, dHeight);

        this.updateGear(2);

        if (this._parent) {
            this._relations.onOwnerSizeChanged(dWidth, dHeight, this._pivotAsAnchor || !ignorePivot);
            this._parent.setBoundsChangedFlag();
            if (this._group)
                this._group.setBoundsChangedFlag();
        }

        this._dispatcher.emit(EventType.SIZE_CHANGED, this);
    }

    public makeFullScreen(): void {
        const root = this.root;
        if (root)
            this.setSize(root.width, root.height);
    }

    /** `GTextField` overrides this to finish any pending layout. */
    public ensureSizeCorrect(): void {
    }

    public get actualWidth(): number {
        return this._width * Math.abs(this._node.scaleX);
    }

    public get actualHeight(): number {
        return this._height * Math.abs(this._node.scaleY);
    }

    // ---- transform -------------------------------------------------------

    public get scaleX(): number {
        return this._node.scaleX;
    }

    public set scaleX(value: number) {
        this.setScale(value, this._node.scaleY);
    }

    public get scaleY(): number {
        return this._node.scaleY;
    }

    public set scaleY(value: number) {
        this.setScale(this._node.scaleX, value);
    }

    public setScale(sx: number, sy: number): void {
        if (this._node.scaleX === sx && this._node.scaleY === sy)
            return;
        this._node.setScale(sx, sy);
        this.updateGear(2);
    }

    public get skewX(): number {
        return this._skewX;
    }

    public set skewX(value: number) {
        this.setSkew(value, this._skewY);
    }

    public get skewY(): number {
        return this._skewY;
    }

    public set skewY(value: number) {
        this.setSkew(this._skewX, value);
    }

    public setSkew(xv: number, yv: number): void {
        if (this._skewX === xv && this._skewY === yv)
            return;
        this._skewX = xv;
        this._skewY = yv;
        this._node.skewX = xv;
        this._node.skewY = yv;
    }

    public get pivotX(): number {
        return this._node.pivotX;
    }

    public set pivotX(value: number) {
        this._node.setPivot(value, this._node.pivotY);
        this.handlePositionChanged();
    }

    public get pivotY(): number {
        return this._node.pivotY;
    }

    public set pivotY(value: number) {
        this._node.setPivot(this._node.pivotX, value);
        this.handlePositionChanged();
    }

    public setPivot(xv: number, yv: number, asAnchor = false): void {
        if (this._node.pivotX !== xv || this._node.pivotY !== yv) {
            this._pivotAsAnchor = asAnchor;
            this._node.setPivot(xv, yv);
            this.handlePositionChanged();
        } else if (this._pivotAsAnchor !== asAnchor) {
            this._pivotAsAnchor = asAnchor;
            this.handlePositionChanged();
        }
    }

    /** Whether the pivot doubles as the object's own origin for layout. */
    public get pivotAsAnchor(): boolean {
        return this._pivotAsAnchor;
    }

    /** Degrees, clockwise. */
    public get rotation(): number {
        return this._node.angle;
    }

    public set rotation(value: number) {
        if (this._node.angle !== value) {
            this._node.angle = value;
            this.updateGear(3);
        }
    }

    // ---- appearance ------------------------------------------------------

    public get touchable(): boolean {
        return this._touchable;
    }

    public set touchable(value: boolean) {
        if (this._touchable !== value) {
            this._touchable = value;
            this.updateGear(3);
        }
    }

    public get grayed(): boolean {
        return this._grayed;
    }

    public set grayed(value: boolean) {
        if (this._grayed !== value) {
            this._grayed = value;
            this._node.grayed = value;
            this.handleGrayedChanged();
            this.updateGear(3);
        }
    }

    public get enabled(): boolean {
        return !this._grayed && this._touchable;
    }

    public set enabled(value: boolean) {
        this.grayed = !value;
        this.touchable = value;
    }

    public get alpha(): number {
        return this._alpha;
    }

    public set alpha(value: number) {
        if (this._alpha === value)
            return;
        this._alpha = value;
        this._node.alpha = value;
        this.handleAlphaChanged();
        this.updateGear(3);
    }

    public get visible(): boolean {
        return this._visible;
    }

    public set visible(value: boolean) {
        if (this._visible === value)
            return;
        this._visible = value;
        this.handleVisibleChanged();
        if (this._group && this._group.excludeInvisibles)
            this._group.setBoundsChangedFlag();
    }

    /** Visible once this object's own flags and its group's are combined. */
    public get _finalVisible(): boolean {
        return this._visible && this._internalVisible && (!this._group || this._group._finalVisible);
    }

    /** Visibility ignoring the enclosing group. */
    public get internalVisible3(): boolean {
        return this._visible && this._internalVisible;
    }

    public get sortingOrder(): number {
        return this._sortingOrder;
    }

    public set sortingOrder(value: number) {
        if (value < 0)
            value = 0;
        if (this._sortingOrder === value)
            return;
        const old = this._sortingOrder;
        this._sortingOrder = value;
        this._node.sortingOrder = value;
        this._parent?.childSortingOrderChanged(this, old, this._sortingOrder);
    }

    public get blendMode(): BlendMode {
        return this._blendMode;
    }

    public set blendMode(value: BlendMode) {
        if (this._blendMode === value)
            return;
        this._blendMode = value;
        this._node.blendMode = value;
        applyBlendMode(this._node, value);
    }

    /** True once this object is attached to a root and every ancestor is visible. */
    public get onStage(): boolean {
        return this._node.visible && this._isInTree();
    }

    private _isInTree(): boolean {
        let p: GObject | null = this;
        while (p) {
            if ((p as unknown as { isRoot?: boolean }).isRoot)
                return true;
            p = p._parent;
        }
        return false;
    }

    public get resourceURL(): string | null {
        if (this.packageItem)
            return 'ui://' + this.packageItem.owner.id + this.packageItem.id;
        return null;
    }

    public get group(): GGroup | null {
        return this._group;
    }

    public set group(value: GGroup | null) {
        if (this._group === value)
            return;
        this._group?.setBoundsChangedFlag();
        this._group = value;
        this._group?.setBoundsChangedFlag();
        this.handleVisibleChanged();
    }

    // ---- tooltips --------------------------------------------------------

    public get tooltips(): string | null {
        return this._tooltips;
    }

    public set tooltips(value: string | null) {
        if (this._tooltips) {
            this.off(EventType.ROLL_OVER, this.onRollOver, this);
            this.off(EventType.ROLL_OUT, this.onRollOut, this);
        }

        this._tooltips = value;

        if (this._tooltips) {
            this.on(EventType.ROLL_OVER, this.onRollOver, this);
            this.on(EventType.ROLL_OUT, this.onRollOut, this);
        }
    }

    private onRollOver = (): void => {
        if (this._tooltips)
            this.root?.showTooltips(this._tooltips);
    };

    private onRollOut = (): void => {
        this.root?.hideTooltips();
    };

    // ---- gears -----------------------------------------------------------

    public getGear(index: number): GearBase {
        let gear = this._gears[index];
        if (!gear) {
            gear = GearBase.create(this, index);
            this._gears[index] = gear;
        }
        return gear;
    }

    protected updateGear(index: number): void {
        if (this._underConstruct || this._gearLocked)
            return;
        const gear = this._gears[index];
        if (gear && gear.controller)
            gear.updateState();
    }

    public checkGearController(index: number, c: Controller): boolean {
        return !!this._gears[index] && this._gears[index]!.controller === c;
    }

    public updateGearFromRelations(index: number, dx: number, dy: number): void {
        this._gears[index]?.updateFromRelations(dx, dy);
    }

    public addDisplayLock(): number {
        const gearDisplay = this._gears[0] as GearDisplay | null;
        if (gearDisplay && gearDisplay.controller) {
            const ret = gearDisplay.addLock();
            this.checkGearDisplay();
            return ret;
        }
        return 0;
    }

    public releaseDisplayLock(token: number): void {
        const gearDisplay = this._gears[0] as GearDisplay | null;
        if (gearDisplay && gearDisplay.controller) {
            gearDisplay.releaseLock(token);
            this.checkGearDisplay();
        }
    }

    /**
     * Recomputes `_internalVisible` from the display gears and reports a change.
     *
     * The reference recursed into `GGroup.handleVisibleChanged` here, which for a
     * group called straight back into itself. The group now overrides
     * `handleVisibleChanged` directly, so the recursion is gone.
     */
    private checkGearDisplay(): void {
        if (this._handlingController)
            return;

        let connected = this._gears[0] == null || (this._gears[0] as GearDisplay).connected;
        const gearDisplay2 = this._gears[8] as GearDisplay2 | null;
        if (gearDisplay2)
            connected = gearDisplay2.evaluate(connected);

        if (connected !== this._internalVisible) {
            this._internalVisible = connected;
            this.handleVisibleChanged();
            if (this._group && this._group.excludeInvisibles)
                this._group.setBoundsChangedFlag();
        }
    }

    public get gearXY(): GearXY {
        return this.getGear(1) as GearXY;
    }

    public get gearSize(): GearSize {
        return this.getGear(2) as GearSize;
    }

    public get gearLook(): GearLook {
        return this.getGear(3) as GearLook;
    }

    // ---- relations -------------------------------------------------------

    public get relations(): Relations {
        return this._relations;
    }

    public addRelation(target: GObject, relationType: number, usePercent = false): void {
        this._relations.add(target, relationType, usePercent);
    }

    public removeRelation(target: GObject, relationType: number): void {
        this._relations.remove(target, relationType);
    }

    // ---- tree ------------------------------------------------------------

    public get root(): GRoot | null {
        return findRootOf(this);
    }

    public removeFromParent(): void {
        this._parent?.removeChild(this);
    }

    /** Nearest ancestor `GObject`, following the render tree if needed. */
    public findParent(): GObject | null {
        if (this._parent)
            return this._parent;

        let node: IRenderObject | null = this._node.parent;
        while (node) {
            if (node.userData)
                return node.userData as GObject;
            node = node.parent;
        }
        return null;
    }

    public dispose(): void {
        if (this._disposed)
            return;
        this._disposed = true;

        this.removeFromParent();
        this._relations.dispose();
        this._dispatcher.offAll();
        scheduler.cancel(this);

        const node = this._node;
        for (let i = 0; i < 10; i++) {
            this._gears[i]?.dispose();
            this._gears[i] = null;
        }
        node.dispose();
    }

    public get disposed(): boolean {
        return this._disposed;
    }

    // ---- lifecycle -------------------------------------------------------

    /** Called when this object becomes live — see `checkEnabled`. */
    protected onEnable(): void {
    }

    /** Called when this object stops being live — see `checkEnabled`. */
    protected onDisable(): void {
    }

    /**
     * Fires `onEnable`/`onDisable` as this object enters or leaves the stage.
     *
     * The reference got these from Cocos: every node carried a partner component
     * whose `onEnable`/`onDisable` the engine called when the node became active
     * in the scene. Nothing calls them here, so the display list drives them
     * instead — an object is live once it is attached to a root with every
     * ancestor and itself visible. A window is the clearest case: it builds its
     * content on the first `onEnable`, so without this it is shown empty.
     *
     * `GComponent` forwards the result down its subtree, which is what makes a
     * whole branch flip at once rather than only the object that moved.
     *
     * @returns whether the state changed.
     */
    public checkEnabled(): boolean {
        const enabled = this._isLive();
        if (enabled === this._enabled)
            return false;

        this._enabled = enabled;
        if (enabled)
            this.onEnable();
        else
            this.onDisable();
        return true;
    }

    /** Whether this object is attached to a root, itself and every ancestor visible. */
    private _isLive(): boolean {
        let p: GObject | null = this;
        while (p) {
            if (!p._finalVisible)
                return false;
            if ((p as unknown as { isRoot?: boolean }).isRoot)
                return true;
            p = p._parent;
        }
        return false;
    }

    public onUpdate(_dt: number): void {
    }

    protected onDestroy(): void {
    }

    /**
     * Runs `callback` after `delay` seconds.
     *
     * At most one deferred callback per object is pending: registering another
     * replaces the previous one, so there is no need to name the callback when
     * cancelling.
     */
    public callLater(callback: () => void, delay = 0): void {
        scheduler.callLater(this, callback, delay);
    }

    /** Drops this object's pending `callLater` callback, if any. */
    public cancelCallLater(): void {
        scheduler.cancel(this);
    }

    // ---- events ----------------------------------------------------------

    public onClick(listener: Listener, target?: unknown): void {
        this.on(EventType.CLICK, listener, target);
    }

    public onceClick(listener: Listener, target?: unknown): void {
        this.once(EventType.CLICK, listener, target);
    }

    public offClick(listener: Listener, target?: unknown): void {
        this.off(EventType.CLICK, listener, target);
    }

    public clearClick(): void {
        this.off(EventType.CLICK);
    }

    public hasClickListener(): boolean {
        return this._dispatcher.hasListener(EventType.CLICK);
    }

    public on(type: string, listener: Listener, target?: unknown): void {
        if (type === EventType.DISPLAY || type === EventType.UNDISPLAY)
            this._emitDisplayEvents = true;
        this._dispatcher.on(type, listener, target);
    }

    public once(type: string, listener: Listener, target?: unknown): void {
        if (type === EventType.DISPLAY || type === EventType.UNDISPLAY)
            this._emitDisplayEvents = true;
        this._dispatcher.once(type, listener, target);
    }

    public off(type: string, listener?: Listener, target?: unknown): void {
        this._dispatcher.off(type, listener, target);
    }

    /** Fires listeners on this object only. */
    public emit(type: string, ...args: unknown[]): boolean {
        return this._dispatcher.emit(type, ...args);
    }

    /**
     * Fires `evt` on this object and, when `evt.bubbles`, on each ancestor.
     * The dispatch chain skips `GGroup`, which is a sibling concern rather than
     * a real parent in the render tree.
     */
    public dispatchEvent(evt: Event): boolean {
        evt.target ??= this;
        evt.currentTarget = this;
        return this._dispatcher.dispatchEvent(evt, (cur) => (cur as GObject).parent ?? null);
    }

    // ---- dragging --------------------------------------------------------

    public get draggable(): boolean {
        return this._draggable;
    }

    public set draggable(value: boolean) {
        if (this._draggable !== value) {
            this._draggable = value;
            this.initDrag();
        }
    }

    public get dragBounds(): Rect | null {
        return this._dragBounds;
    }

    public set dragBounds(value: Rect | null) {
        this._dragBounds = value;
    }

    public get dragging(): boolean {
        return GObject.draggingObject === this;
    }

    /**
     * Begins a drag.
     *
     * @param touchId the pointer to drag with. Omit it to use whichever pointer
     *   is currently down — which is what `DragDropManager` does, since it is
     *   handed a drag by a widget that never sees the raw pointer id.
     */
    public startDrag(touchId?: number): void {
        if (!this.onStage)
            return;
        this.dragBegin(touchId);
    }

    public stopDrag(): void {
        this.dragEnd();
    }

    private initDrag(): void {
        if (this._draggable) {
            this.on(EventType.TOUCH_BEGIN, this.onTouchBegin_0, this);
            this.on(EventType.TOUCH_MOVE, this.onTouchMove_0, this);
            this.on(EventType.TOUCH_END, this.onTouchEnd_0, this);
        } else {
            this.off(EventType.TOUCH_BEGIN, this.onTouchBegin_0, this);
            this.off(EventType.TOUCH_MOVE, this.onTouchMove_0, this);
            this.off(EventType.TOUCH_END, this.onTouchEnd_0, this);
        }
    }

    private dragBegin(touchId?: number): void {
        if (GObject.draggingObject) {
            const tmp = GObject.draggingObject;
            tmp.stopDrag();
            GObject.draggingObject = null;
            tmp.emit(EventType.DRAG_END);
        }

        const root = this.root;
        if (!root)
            return;

        // Resolving "no id" to the live pointer is what makes a drag started by
        // a widget follow the pointer. A pressed pointer wins over the first
        // live slot: hovering parks a slot too, and attaching the monitor to
        // that one leaves the object created but motionless.
        if (touchId === undefined) {
            const input = root.inputProcessor;
            touchId = input.getPressedTouchId() ?? input.getAllTouches()[0] ?? 0;
        }

        root.getTouchPosition(touchId, sGlobalDragStart);
        this.localToGlobalRect(0, 0, this._width, this._height, sGlobalRect);

        GObject.draggingObject = this;
        this._dragTesting = true;
        root.inputProcessor.addTouchMonitor(touchId, this);

        this.on(EventType.TOUCH_MOVE, this.onTouchMove_0, this);
        this.on(EventType.TOUCH_END, this.onTouchEnd_0, this);
    }

    private dragEnd(): void {
        if (GObject.draggingObject === this) {
            this._dragTesting = false;
            GObject.draggingObject = null;
        }
        sDragQuery = false;
    }

    private onTouchBegin_0 = (evt: Event): void => {
        this._dragStartPos ??= new Point();
        this._dragStartPos.setTo(evt.pos.x, evt.pos.y);
        this._dragTesting = true;
        evt.captureTouch();
    };

    private onTouchMove_0 = (evt: Event): void => {
        if (GObject.draggingObject !== this && this._draggable && this._dragTesting) {
            const sensitivity = UIConfig.touchDragSensitivity;
            if (this._dragStartPos
                && Math.abs(this._dragStartPos.x - evt.pos.x) < sensitivity
                && Math.abs(this._dragStartPos.y - evt.pos.y) < sensitivity)
                return;

            this._dragTesting = false;
            sDragQuery = true;
            this.emit(EventType.DRAG_START, evt);
            if (sDragQuery)
                this.dragBegin(evt.touchId);
        }

        if (GObject.draggingObject === this) {
            let xx = evt.pos.x - sGlobalDragStart.x + sGlobalRect.x;
            let yy = evt.pos.y - sGlobalDragStart.y + sGlobalRect.y;

            const root = this.root;
            if (this._dragBounds && root) {
                const rect = root.localToGlobalRect(
                    this._dragBounds.x, this._dragBounds.y,
                    this._dragBounds.width, this._dragBounds.height,
                    sDragHelperRect,
                );
                if (xx < rect.x) {
                    xx = rect.x;
                } else if (xx + sGlobalRect.width > rect.xMax) {
                    xx = rect.xMax - sGlobalRect.width;
                    if (xx < rect.x)
                        xx = rect.x;
                }

                if (yy < rect.y) {
                    yy = rect.y;
                } else if (yy + sGlobalRect.height > rect.yMax) {
                    yy = rect.yMax - sGlobalRect.height;
                    if (yy < rect.y)
                        yy = rect.y;
                }
            }

            sUpdateInDragging = true;
            const pt = this._parent
                ? this._parent.globalToLocal(xx, yy, sHelperPoint)
                : sHelperPoint.setTo(xx, yy);

            // `xx`/`yy` are the content box's top-left — `sGlobalRect` tracks
            // that box — while `setPosition` anchors at the pivot, so the box
            // has to be put back onto its anchor, the inverse of what `xMin`
            // reports. Skipping it moves an anchored object by its pivot offset
            // on the first move: the drop agent, centred on the pointer when it
            // appears, would trail the pointer by half its own size from then on.
            if (this._pivotAsAnchor) {
                pt.x += this._width * this._node.pivotX;
                pt.y += this._height * this._node.pivotY;
            }

            this.setPosition(Math.round(pt.x), Math.round(pt.y));
            sUpdateInDragging = false;

            this.emit(EventType.DRAG_MOVE, evt);
        }
    };

    private onTouchEnd_0 = (evt: Event): void => {
        if (GObject.draggingObject === this) {
            GObject.draggingObject = null;
            this.emit(EventType.DRAG_END, evt);
        }
    };

    // ---- coordinates -----------------------------------------------------

    public localToGlobal(ax = 0, ay = 0, result?: Point): Point {
        const out = this._node.localToGlobal(ax, ay, result);
        return result ?? out;
    }

    public globalToLocal(ax = 0, ay = 0, result?: Point): Point {
        const out = this._node.globalToLocal(ax, ay, result);
        return result ?? out;
    }

    /** Bounding box of a local rect, expressed in UI-root coordinates. */
    public localToGlobalRect(ax = 0, ay = 0, aw = 0, ah = 0, result?: Rect): Rect {
        const out = result ?? new Rect();
        const pt = this.localToGlobal(ax, ay, sHelperPoint);
        out.x = pt.x;
        out.y = pt.y;
        const pt2 = this.localToGlobal(ax + aw, ay + ah, sHelperPoint);
        out.width = pt2.x - out.x;
        out.height = pt2.y - out.y;
        return out;
    }

    public globalToLocalRect(ax = 0, ay = 0, aw = 0, ah = 0, result?: Rect): Rect {
        const out = result ?? new Rect();
        const pt = this.globalToLocal(ax, ay, sHelperPoint);
        out.x = pt.x;
        out.y = pt.y;
        const pt2 = this.globalToLocal(ax + aw, ay + ah, sHelperPoint);
        out.width = pt2.x - out.x;
        out.height = pt2.y - out.y;
        return out;
    }

    public handleControllerChanged(c: Controller): void {
        this._handlingController = true;
        for (let i = 0; i < 10; i++) {
            const gear = this._gears[i];
            if (gear && gear.controller === c)
                gear.apply();
        }
        this._handlingController = false;
        this.checkGearDisplay();
    }

    // ---- protected hooks overridden by subclasses ------------------------

    /** Places the backend node, accounting for the pivot when it is not an anchor. */
    protected handlePositionChanged(): void {
        let xv = this._x;
        let yv = this._y;
        if (!this._pivotAsAnchor) {
            xv += this._node.pivotX * this._width;
            yv += this._node.pivotY * this._height;
        }
        if (this._pixelSnapping) {
            xv = Math.round(xv);
            yv = Math.round(yv);
        }
        this._node.setPosition(xv, yv);
    }

    protected handleSizeChanged(): void {
        this._node.setContentSize(this._width, this._height);
    }

    protected handleGrayedChanged(): void {
        // Base objects have nothing to re-tint; widgets override.
    }

    /**
     * Whether this object has a silhouette a backend can use as a stencil.
     * Only `GImage` and `GGraph` answer true.
     */
    public get isShapeMask(): boolean {
        return false;
    }

    /** `GGroup` propagates alpha to its members. */
    protected handleAlphaChanged(): void {
    }

    public handleVisibleChanged(): void {
        this._node.visible = this._finalVisible;

        this._parent?.setBoundsChangedFlag();

        // Tell the subtree, so `DISPLAY`/`UNDISPLAY` fire exactly once per
        // transition rather than once per ancestor.
        if (this._emitDisplayEvents)
            this.emit(this._finalVisible ? EventType.DISPLAY : EventType.UNDISPLAY);

        // Liveness follows the same flip: the reference's `handleVisibleChanged`
        // set the node's `active`, which is what made the engine call back.
        this.checkEnabled();
    }

    /** Called by `GComponent` when a child moves; `GList` opts out. */
    public handleChildPositionChanged(_child: GObject): void {
    }

    /** Called after this object's position changed, with the delta. */
    protected onMoved(_dx: number, _dy: number): void {
    }

    /** Called after this object's size changed, with the delta. */
    protected onResized(_dw: number, _dh: number): void {
    }

    // ---- hit testing -----------------------------------------------------

    /**
     * Walks the render tree under `globalPt` and returns the topmost object that
     * accepts a touch, or `null`.
     */
    public hitTest(globalPt: Point, forTouch = true): GObject | null {
        if (forTouch && (this._touchDisabled || !this._touchable || !this._node.visible))
            return null;

        this.globalToLocal(globalPt.x, globalPt.y, this._hitTestPt);
        if (this._pivotAsAnchor) {
            this._hitTestPt.x += this._node.pivotX * this._width;
            this._hitTestPt.y += this._node.pivotY * this._height;
        }
        return this._hitTest(this._hitTestPt, globalPt);
    }

    protected _hitTest(pt: Point, _globalPt: Point): GObject | null {
        return this._node.hitTest(pt.x, pt.y) ? this : null;
    }

    // ---- properties by index ---------------------------------------------

    public getProp(index: number): unknown {
        switch (index) {
            case ObjectPropID.Text: return this.text;
            case ObjectPropID.Icon: return this.icon;
            case ObjectPropID.Color: return null;
            case ObjectPropID.OutlineColor: return null;
            case ObjectPropID.Playing: return false;
            case ObjectPropID.Frame: return 0;
            case ObjectPropID.DeltaTime: return 0;
            case ObjectPropID.TimeScale: return 1;
            case ObjectPropID.FontSize: return 0;
            case ObjectPropID.Selected: return false;
            default: return undefined;
        }
    }

    public setProp(index: number, value: unknown): void {
        switch (index) {
            case ObjectPropID.Text: this.text = value as string; break;
            case ObjectPropID.Icon: this.icon = value as string; break;
        }
    }

    public get text(): string | null {
        return null;
    }

    public set text(_value: string | null) {
    }

    public get icon(): string | null {
        return null;
    }

    public set icon(_value: string | null) {
    }

    public get treeNode(): GTreeNode | undefined {
        return this._treeNode;
    }

    public requestFocus(): void {
    }

    /** Forced-cast accessors, kept for API compatibility with the reference. */
    public get asCom(): GComponent { return this as unknown as GComponent; }
    public get asButton(): GButton { return this as unknown as GButton; }
    public get asLabel(): GLabel { return this as unknown as GLabel; }
    public get asProgress(): GProgressBar { return this as unknown as GProgressBar; }
    public get asTextField(): GTextField { return this as unknown as GTextField; }
    public get asRichTextField(): GRichTextField { return this as unknown as GRichTextField; }
    public get asTextInput(): GTextInput { return this as unknown as GTextInput; }
    public get asLoader(): GLoader { return this as unknown as GLoader; }
    public get asList(): GList { return this as unknown as GList; }
    public get asTree(): GTree { return this as unknown as GTree; }
    public get asGraph(): GGraph { return this as unknown as GGraph; }
    public get asGroup(): GGroup { return this as unknown as GGroup; }
    public get asSlider(): GSlider { return this as unknown as GSlider; }
    public get asComboBox(): GComboBox { return this as unknown as GComboBox; }
    public get asImage(): GImage { return this as unknown as GImage; }
    public get asMovieClip(): GMovieClip { return this as unknown as GMovieClip; }

    /** Recovers the `GObject` behind a backend render object. */
    public static cast(obj: IRenderObject | null): GObject | null {
        return (obj?.userData as GObject) ?? null;
    }

    // ---- construction from package data ----------------------------------

    /** Builds the object's children and properties from its package payload. */
    public constructFromResource(): void {
    }

    public setup_beforeAdd(buffer: ByteBuffer, beginPos: number): void {
        buffer.seek(beginPos, 0);
        buffer.skip(5);

        this._id = buffer.readS() ?? this._id;
        this._name = buffer.readS() ?? '';
        const xv = buffer.readInt();
        const yv = buffer.readInt();
        this.setPosition(xv, yv);

        if (buffer.readBool()) {
            this.initWidth = buffer.readInt();
            this.initHeight = buffer.readInt();
            this.setSize(this.initWidth, this.initHeight, true);
        }

        if (buffer.readBool()) {
            this.minWidth = buffer.readInt();
            this.maxWidth = buffer.readInt();
            this.minHeight = buffer.readInt();
            this.maxHeight = buffer.readInt();
        }

        if (buffer.readBool())
            this.setScale(buffer.readFloat(), buffer.readFloat());

        if (buffer.readBool())
            this.setSkew(buffer.readFloat(), buffer.readFloat());

        if (buffer.readBool()) {
            const px = buffer.readFloat();
            const py = buffer.readFloat();
            this.setPivot(px, py, buffer.readBool());
        }

        const alphaValue = buffer.readFloat();
        if (alphaValue !== 1)
            this.alpha = alphaValue;

        const rotationValue = buffer.readFloat();
        if (rotationValue !== 0)
            this.rotation = rotationValue;

        if (!buffer.readBool())
            this.visible = false;
        if (!buffer.readBool())
            this.touchable = false;
        if (buffer.readBool())
            this.grayed = true;
        this.blendMode = buffer.readByte();

        const filter = buffer.readByte();
        void filter; // filter effects are not modelled yet

        const str = buffer.readS();
        if (str != null)
            this.data = str;
    }

    public setup_afterAdd(buffer: ByteBuffer, beginPos: number): void {
        buffer.seek(beginPos, 1);

        const str = buffer.readS();
        if (str != null)
            this.tooltips = str;

        const groupId = buffer.readShort();
        if (groupId >= 0)
            this.group = this._parent?.getChildAt(groupId) as GGroup ?? null;

        buffer.seek(beginPos, 2);

        const cnt = buffer.readShort();
        for (let i = 0; i < cnt; i++) {
            let nextPos = buffer.readShort();
            nextPos += buffer.position;

            const gear = this.getGear(buffer.readByte());
            gear.setup(buffer);

            buffer.position = nextPos;
        }
    }
}
