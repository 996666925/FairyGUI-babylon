import { EventType, type Event } from './event/Event.js';
import { GObject } from './GObject.js';
import { Margin } from './Margin.js';
import { ScrollBarDisplayType, ScrollType } from './FieldTypes.js';
import { Point, Rect } from './utils/Geometry.js';
import { ToolSet } from './utils/ToolSet.js';
import { UIConfig } from './UIConfig.js';
import { UIPackage } from './UIPackage.js';
import { GTween } from './tween/GTween.js';
import { getRenderFactory, type IRenderObject } from './render/IRenderObject.js';
import { getStage } from './Stage.js';
import { scheduler } from './Scheduler.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { Controller } from './Controller.js';
import type { GComponent } from './GComponent.js';
import type { GList } from './GList.js';
import type { GScrollBar } from './GScrollBar.js';
import type { GTweener } from './tween/GTweener.js';

/**
 * Engine facts the reference read off Cocos globals.
 *
 * `cc.sys.isMobile` and `cc.winSize` are used for one thing only: the fling
 * velocity is scaled to a 1136-pixel reference resolution on mobile, and the
 * "is this fast enough to bother flinging" thresholds double there. There is no
 * window here, so the backend may set these; the desktop behaviour, which does
 * no reference-resolution scaling at all, is the default.
 */
export const ScrollPaneEnv = {
    isMobile: false,
    screenWidth: 1136,
    screenHeight: 640,
};

/**
 * A scrolling viewport over a `GComponent`'s content.
 *
 * ## Layout against the reference
 *
 * The reference wrapped the owner's `_container` in a `cc.Mask` node and moved
 * that container by the negative of the scroll offset; the mask node carried a
 * rectangular clip sized to the view. This port keeps the same three-node
 * shape — `_node` → `_maskContainer` → `_container` — but expresses the clip
 * with `IRenderObject.scrollRect` instead of a `cc.Mask` component, which is
 * why the offset survives as a plain position on the container node.
 *
 * ## The y axis
 *
 * Cocos' y points up, so the reference scrolled *down* by moving the container
 * to `+yPos` and read the offset back as `-container.y`. Its tween maths,
 * clamps and bounce thresholds are all written against that quantity. This port
 * is y-down throughout, so the container sits at `-yPos` and the quantity the
 * maths wants is `container.positionY` itself. Every read of the reference's
 * `-container.y` is therefore `positionY`, and every write of its
 * `container.y = v` becomes `positionY = -v`; nothing else about the algorithm
 * changes.
 *
 * ## Time
 *
 * The reference took `ToolSet.getTime()` (a wall clock) for the drag velocity
 * and the momentum decay. Nothing here consults a clock: `update(dt)` advances
 * an internal second counter, and the touch handlers read that. Momentum decay
 * is therefore exactly reproducible for a given `dt` sequence.
 */
export class ScrollPane {
    /** Non-zero when the pane loops its content; set by `GList`. 1 = x, 2 = y. */
    public _loop = 0;
    /** When set, a scroll bar is hidden entirely while its axis fits the view. */
    public _displayInDemand = false;

    /** The pane currently being dragged. Only one at a time. */
    public static draggingPane: ScrollPane | null = null;

    private _owner: GComponent;
    private _container: IRenderObject;
    /**
     * Carries the clip rect and holds the container, the header and the footer.
     * Mirrors the reference's `cc.Mask` node; see the class comment.
     */
    private _maskContainer: IRenderObject;

    private _scrollType: ScrollType = ScrollType.Vertical;
    private _scrollStep = UIConfig.defaultScrollStep;
    private _mouseWheelStep = UIConfig.defaultScrollStep * 2;
    private _decelerationRate: number = UIConfig.defaultScrollDecelerationRate;
    private _scrollBarMargin = new Margin();
    private _bouncebackEffect: boolean = UIConfig.defaultScrollBounceEffect;
    private _touchEffect: boolean = UIConfig.defaultScrollTouchEffect;
    private _scrollBarDisplayAuto = false;
    private _vScrollNone = false;
    private _hScrollNone = false;
    private _needRefresh = false;
    private _refreshBarAxis: 'x' | 'y' = 'y';

    private _displayOnLeft = false;
    private _snapToItem = false;
    private _snappingPolicy = 0;
    private _mouseWheelEnabled = true;
    private _pageMode = false;
    private _inertiaDisabled = false;
    private _floating = false;
    private _dontClipMargin = false;

    private _xPos = 0;
    private _yPos = 0;

    private _viewSize = new Point();
    private _contentSize = new Point();
    private _overlapSize = new Point();
    private _pageSize = new Point(1, 1);
    private _containerPos = new Point();
    private _beginTouchPos = new Point();
    private _lastTouchPos = new Point();
    private _lastTouchGlobalPos = new Point();
    private _velocity = new Point();
    private _velocityScale = 1;
    private _lastMoveTime = 0;
    private _isHoldAreaDone = false;
    private _aniFlag = 0;
    private _headerLockedSize = 0;
    private _footerLockedSize = 0;
    private _refreshEventDispatching = false;
    private _dragged = false;
    private _hover = false;

    private _tweening = 0;
    private _tweenTime = new Point();
    private _tweenDuration = new Point();
    private _tweenStart = new Point();
    private _tweenChange = new Point();

    private _pageController: Controller | null = null;

    private _hzScrollBar: GScrollBar | null = null;
    private _vtScrollBar: GScrollBar | null = null;
    private _header: GComponent | null = null;
    private _footer: GComponent | null = null;

    /**
     * Seconds accumulated by `update`. Stands in for the engine clock the
     * reference read from `ToolSet.getTime()`.
     */
    private _clock = 0;

    public constructor(owner: GComponent) {
        this._owner = owner;
        this._container = owner._container;

        // The clip has to hang off a node that does not move with the scroll, so
        // the container is re-parented under a fresh node of our own.
        this._maskContainer = getRenderFactory().createObject();
        owner.node.addChild(this._maskContainer);
        this._maskContainer.addChild(this._container);

        this.setSize(owner.width, owner.height);
    }

    /** @internal Called by `GComponent.setupScroll` with the component payload. */
    public setup(buffer: ByteBuffer): void {
        // A pane is not a node in the display list — it is a collaborator that
        // lives on its owner — so nothing else routes input to it. Without this
        // the pane renders and scrolls its bars, but never reacts to a drag:
        // every entry point below is published, and none of them is connected.
        const owner = this._owner;
        owner.on(EventType.TOUCH_BEGIN, this.onTouchBegin, this);
        owner.on(EventType.TOUCH_MOVE, this.onTouchMove, this);
        owner.on(EventType.TOUCH_END, this.onTouchEnd, this);
        owner.on(EventType.MOUSE_WHEEL, this.onMouseWheel, this);

        this._scrollType = buffer.readByte();
        let scrollBarDisplay: ScrollBarDisplayType = buffer.readByte();
        const flags: number = buffer.readInt();

        if (buffer.readBool()) {
            this._scrollBarMargin.top = buffer.readInt();
            this._scrollBarMargin.bottom = buffer.readInt();
            this._scrollBarMargin.left = buffer.readInt();
            this._scrollBarMargin.right = buffer.readInt();
        }

        const vtScrollBarRes: string | null = buffer.readS();
        const hzScrollBarRes: string | null = buffer.readS();
        const headerRes: string | null = buffer.readS();
        const footerRes: string | null = buffer.readS();

        if ((flags & 1) !== 0)
            this._displayOnLeft = true;
        if ((flags & 2) !== 0)
            this._snapToItem = true;
        if ((flags & 4) !== 0)
            this._displayInDemand = true;
        if ((flags & 8) !== 0)
            this._pageMode = true;
        if (flags & 16)
            this._touchEffect = true;
        else if (flags & 32)
            this._touchEffect = false;
        else
            this._touchEffect = UIConfig.defaultScrollTouchEffect;
        if (flags & 64)
            this._bouncebackEffect = true;
        else if (flags & 128)
            this._bouncebackEffect = false;
        else
            this._bouncebackEffect = UIConfig.defaultScrollBounceEffect;
        if ((flags & 256) !== 0)
            this._inertiaDisabled = true;
        // Flag 512 asked the reference for a `cc.Mask` on the mask container.
        // The clip now lives in `_maskContainer.scrollRect`, which the backend
        // applies unconditionally, so the flag has nothing left to switch.
        if ((flags & 1024) !== 0)
            this._floating = true;
        if ((flags & 2048) !== 0)
            this._dontClipMargin = true;

        if (scrollBarDisplay === ScrollBarDisplayType.Default)
            scrollBarDisplay = UIConfig.defaultScrollBarDisplay;

        if (scrollBarDisplay !== ScrollBarDisplayType.Hidden) {
            if (this._scrollType === ScrollType.Both || this._scrollType === ScrollType.Vertical) {
                const res = vtScrollBarRes ? vtScrollBarRes : UIConfig.verticalScrollBar;
                if (res) {
                    this._vtScrollBar = this.createScrollBar(res, true);
                    this._owner.node.addChild(this._vtScrollBar.node);
                }
            }
            if (this._scrollType === ScrollType.Both || this._scrollType === ScrollType.Horizontal) {
                const res = hzScrollBarRes ? hzScrollBarRes : UIConfig.horizontalScrollBar;
                if (res) {
                    this._hzScrollBar = this.createScrollBar(res, false);
                    this._owner.node.addChild(this._hzScrollBar.node);
                }
            }

            if (scrollBarDisplay === ScrollBarDisplayType.Auto)
                this._scrollBarDisplayAuto = true;
            if (this._scrollBarDisplayAuto) {
                if (this._vtScrollBar)
                    this._vtScrollBar.visible = false;
                if (this._hzScrollBar)
                    this._hzScrollBar.visible = false;
                // The reference bound ROLL_OVER/ROLL_OUT on the owner here. This
                // port has no listener of its own: the input layer calls
                // `onRollOver`/`onRollOut`, the same way it calls the touch
                // handlers.
            }
        }

        if (headerRes) {
            const header = UIPackage.createObjectFromURL(headerRes);
            if (!header)
                throw new Error('cannot create scrollPane header from ' + headerRes);
            this._header = header as unknown as GComponent;
            this._maskContainer.addChildAt(this._header.node, 0);
        }

        if (footerRes) {
            const footer = UIPackage.createObjectFromURL(footerRes);
            if (!footer)
                throw new Error('cannot create scrollPane footer from ' + footerRes);
            this._footer = footer as unknown as GComponent;
            this._maskContainer.addChildAt(this._footer.node, 0);
        }

        this._refreshBarAxis = (this._scrollType === ScrollType.Both || this._scrollType === ScrollType.Vertical) ? 'y' : 'x';

        this.setSize(this._owner.width, this._owner.height);
    }

    private createScrollBar(url: string, vertical: boolean): GScrollBar {
        const bar = UIPackage.createObjectFromURL(url) as unknown as GScrollBar | null;
        if (!bar)
            throw new Error('cannot create scrollbar from ' + url);
        bar.setScrollPane(this, vertical);
        return bar;
    }

    /**
     * Tears the pane down.
     *
     * Named `destroy` rather than the reference's `onDestroy` component hook;
     * `GComponent.dispose` calls it. The container is handed back to the
     * owner's node first, so a backend that cascades a disposal into children
     * does not take the component's whole display list with it.
     */
    public destroy(): void {
        const owner = this._owner;
        owner.off(EventType.TOUCH_BEGIN, this.onTouchBegin, this);
        owner.off(EventType.TOUCH_MOVE, this.onTouchMove, this);
        owner.off(EventType.TOUCH_END, this.onTouchEnd, this);
        owner.off(EventType.MOUSE_WHEEL, this.onMouseWheel, this);

        this._pageController = null;

        scheduler.cancel(this);

        this._owner.node.addChild(this._container);
        this._maskContainer.dispose();

        if (this._hzScrollBar)
            this._hzScrollBar.dispose();
        if (this._vtScrollBar)
            this._vtScrollBar.dispose();
        if (this._header)
            this._header.dispose();
        if (this._footer)
            this._footer.dispose();

        this._hzScrollBar = null;
        this._vtScrollBar = null;
        this._header = null;
        this._footer = null;
    }

    public hitTest(pt: Point, globalPt: Point): GObject | null {
        let target: GObject | null;
        if (this._vtScrollBar) {
            target = this._vtScrollBar.hitTest(globalPt);
            if (target)
                return target;
        }
        if (this._hzScrollBar) {
            target = this._hzScrollBar.hitTest(globalPt);
            if (target)
                return target;
        }
        if (this._header && this._header.node.visible) {
            target = this._header.hitTest(globalPt);
            if (target)
                return target;
        }
        if (this._footer && this._footer.node.visible) {
            target = this._footer.hitTest(globalPt);
            if (target)
                return target;
        }

        if (pt.x >= this._owner.margin.left && pt.y >= this._owner.margin.top
            && pt.x < this._owner.margin.left + this._viewSize.x
            && pt.y < this._owner.margin.top + this._viewSize.y)
            return this._owner;
        return null;
    }

    public get owner(): GComponent {
        return this._owner;
    }

    public get hzScrollBar(): GScrollBar | null {
        return this._hzScrollBar;
    }

    public get vtScrollBar(): GScrollBar | null {
        return this._vtScrollBar;
    }

    public get header(): GComponent | null {
        return this._header;
    }

    public get footer(): GComponent | null {
        return this._footer;
    }

    public get bouncebackEffect(): boolean {
        return this._bouncebackEffect;
    }

    public set bouncebackEffect(sc: boolean) {
        this._bouncebackEffect = sc;
    }

    public get touchEffect(): boolean {
        return this._touchEffect;
    }

    public set touchEffect(sc: boolean) {
        this._touchEffect = sc;
    }

    public set scrollStep(val: number) {
        this._scrollStep = val;
        if (this._scrollStep === 0)
            this._scrollStep = UIConfig.defaultScrollStep;
        this._mouseWheelStep = this._scrollStep * 2;
    }

    public get scrollStep(): number {
        return this._scrollStep;
    }

    public get decelerationRate(): number {
        return this._decelerationRate;
    }

    public set decelerationRate(val: number) {
        this._decelerationRate = val;
    }

    public get snapToItem(): boolean {
        return this._snapToItem;
    }

    public set snapToItem(value: boolean) {
        this._snapToItem = value;
    }

    public get snappingPolicy(): number {
        return this._snappingPolicy;
    }

    public set snappingPolicy(value: number) {
        this._snappingPolicy = value;
    }

    public get mouseWheelEnabled(): boolean {
        return this._mouseWheelEnabled;
    }

    public set mouseWheelEnabled(value: boolean) {
        this._mouseWheelEnabled = value;
    }

    public get isDragged(): boolean {
        return this._dragged;
    }

    public get percX(): number {
        return this._overlapSize.x === 0 ? 0 : this._xPos / this._overlapSize.x;
    }

    public set percX(value: number) {
        this.setPercX(value, false);
    }

    public setPercX(value: number, ani?: boolean): void {
        this._owner.ensureBoundsCorrect();
        this.setPosX(this._overlapSize.x * ToolSet.clamp01(value), ani);
    }

    public get percY(): number {
        return this._overlapSize.y === 0 ? 0 : this._yPos / this._overlapSize.y;
    }

    public set percY(value: number) {
        this.setPercY(value, false);
    }

    public setPercY(value: number, ani?: boolean): void {
        this._owner.ensureBoundsCorrect();
        this.setPosY(this._overlapSize.y * ToolSet.clamp01(value), ani);
    }

    public get posX(): number {
        return this._xPos;
    }

    public set posX(value: number) {
        this.setPosX(value, false);
    }

    public setPosX(value: number, ani?: boolean): void {
        this._owner.ensureBoundsCorrect();

        if (this._loop === 1)
            value = this.loopCheckingNewPos(value, 'x');

        value = ToolSet.clamp(value, 0, this._overlapSize.x);
        if (value !== this._xPos) {
            this._xPos = value;
            this.posChanged(ani ?? false);
        }
    }

    public get posY(): number {
        return this._yPos;
    }

    public set posY(value: number) {
        this.setPosY(value, false);
    }

    public setPosY(value: number, ani?: boolean): void {
        this._owner.ensureBoundsCorrect();

        if (this._loop === 2)
            value = this.loopCheckingNewPos(value, 'y');

        value = ToolSet.clamp(value, 0, this._overlapSize.y);
        if (value !== this._yPos) {
            this._yPos = value;
            this.posChanged(ani ?? false);
        }
    }

    public get contentWidth(): number {
        return this._contentSize.x;
    }

    public get contentHeight(): number {
        return this._contentSize.y;
    }

    public get viewWidth(): number {
        return this._viewSize.x;
    }

    public set viewWidth(value: number) {
        value = value + this._owner.margin.left + this._owner.margin.right;
        if (this._vtScrollBar && !this._floating)
            value += this._vtScrollBar.width;
        this._owner.width = value;
    }

    public get viewHeight(): number {
        return this._viewSize.y;
    }

    public set viewHeight(value: number) {
        value = value + this._owner.margin.top + this._owner.margin.bottom;
        if (this._hzScrollBar && !this._floating)
            value += this._hzScrollBar.height;
        this._owner.height = value;
    }

    public get currentPageX(): number {
        if (!this._pageMode)
            return 0;

        let page: number = Math.floor(this._xPos / this._pageSize.x);
        if (this._xPos - page * this._pageSize.x > this._pageSize.x * 0.5)
            page++;

        return page;
    }

    public set currentPageX(value: number) {
        this.setCurrentPageX(value, false);
    }

    public get currentPageY(): number {
        if (!this._pageMode)
            return 0;

        let page: number = Math.floor(this._yPos / this._pageSize.y);
        if (this._yPos - page * this._pageSize.y > this._pageSize.y * 0.5)
            page++;

        return page;
    }

    public set currentPageY(value: number) {
        this.setCurrentPageY(value, false);
    }

    public setCurrentPageX(value: number, ani?: boolean): void {
        if (!this._pageMode)
            return;

        this._owner.ensureBoundsCorrect();

        if (this._overlapSize.x > 0)
            this.setPosX(value * this._pageSize.x, ani);
    }

    public setCurrentPageY(value: number, ani?: boolean): void {
        if (!this._pageMode)
            return;

        this._owner.ensureBoundsCorrect();

        if (this._overlapSize.y > 0)
            this.setPosY(value * this._pageSize.y, ani);
    }

    public get isBottomMost(): boolean {
        return this._yPos === this._overlapSize.y || this._overlapSize.y === 0;
    }

    public get isRightMost(): boolean {
        return this._xPos === this._overlapSize.x || this._overlapSize.x === 0;
    }

    public get pageController(): Controller | null {
        return this._pageController;
    }

    public set pageController(value: Controller | null) {
        this._pageController = value;
    }

    public get scrollingPosX(): number {
        return ToolSet.clamp(-this._container.positionX, 0, this._overlapSize.x);
    }

    public get scrollingPosY(): number {
        // `-positionY` is the positive downward offset; see the class comment.
        return ToolSet.clamp(-this._container.positionY, 0, this._overlapSize.y);
    }

    public scrollTop(ani?: boolean): void {
        this.setPercY(0, ani);
    }

    public scrollBottom(ani?: boolean): void {
        this.setPercY(1, ani);
    }

    public scrollUp(ratio?: number, ani?: boolean): void {
        if (ratio === undefined)
            ratio = 1;
        if (this._pageMode)
            this.setPosY(this._yPos - this._pageSize.y * ratio, ani);
        else
            this.setPosY(this._yPos - this._scrollStep * ratio, ani);
    }

    public scrollDown(ratio?: number, ani?: boolean): void {
        if (ratio === undefined)
            ratio = 1;
        if (this._pageMode)
            this.setPosY(this._yPos + this._pageSize.y * ratio, ani);
        else
            this.setPosY(this._yPos + this._scrollStep * ratio, ani);
    }

    public scrollLeft(ratio?: number, ani?: boolean): void {
        if (ratio === undefined)
            ratio = 1;
        if (this._pageMode)
            this.setPosX(this._xPos - this._pageSize.x * ratio, ani);
        else
            this.setPosX(this._xPos - this._scrollStep * ratio, ani);
    }

    public scrollRight(ratio?: number, ani?: boolean): void {
        if (ratio === undefined)
            ratio = 1;
        if (this._pageMode)
            this.setPosX(this._xPos + this._pageSize.x * ratio, ani);
        else
            this.setPosX(this._xPos + this._scrollStep * ratio, ani);
    }

    /**
     * Scrolls `target` into the viewport.
     *
     * @param target the object to reveal, or a rect in the owner's local space.
     * @param setFirst scroll so the target sits at the leading edge, even if it
     *   is already visible.
     */
    public scrollToView(target: GObject | Rect, ani?: boolean, setFirst?: boolean): void {
        this._owner.ensureBoundsCorrect();
        if (this._needRefresh)
            this.refresh();

        let rect: Rect;
        if (target instanceof GObject) {
            if (target.parent !== this._owner) {
                target.parent!.localToGlobalRect(
                    target.x, target.y, target.width, target.height, s_rect);
                rect = this._owner.globalToLocalRect(
                    s_rect.x, s_rect.y, s_rect.width, s_rect.height, s_rect);
            } else {
                rect = s_rect;
                rect.x = target.x;
                rect.y = target.y;
                rect.width = target.width;
                rect.height = target.height;
            }
        } else {
            rect = target;
        }

        if (this._overlapSize.y > 0) {
            const bottom: number = this._yPos + this._viewSize.y;
            if (setFirst || rect.y <= this._yPos || rect.height >= this._viewSize.y) {
                if (this._pageMode)
                    this.setPosY(Math.floor(rect.y / this._pageSize.y) * this._pageSize.y, ani);
                else
                    this.setPosY(rect.y, ani);
            } else if (rect.y + rect.height > bottom) {
                if (this._pageMode)
                    this.setPosY(Math.floor(rect.y / this._pageSize.y) * this._pageSize.y, ani);
                else if (rect.height <= this._viewSize.y / 2)
                    this.setPosY(rect.y + rect.height * 2 - this._viewSize.y, ani);
                else
                    this.setPosY(rect.y + rect.height - this._viewSize.y, ani);
            }
        }
        if (this._overlapSize.x > 0) {
            const right: number = this._xPos + this._viewSize.x;
            if (setFirst || rect.x <= this._xPos || rect.width >= this._viewSize.x) {
                if (this._pageMode)
                    this.setPosX(Math.floor(rect.x / this._pageSize.x) * this._pageSize.x, ani);
                else
                    this.setPosX(rect.x, ani);
            } else if (rect.x + rect.width > right) {
                if (this._pageMode)
                    this.setPosX(Math.floor(rect.x / this._pageSize.x) * this._pageSize.x, ani);
                else if (rect.width <= this._viewSize.x / 2)
                    this.setPosX(rect.x + rect.width * 2 - this._viewSize.x, ani);
                else
                    this.setPosX(rect.x + rect.width - this._viewSize.x, ani);
            }
        }

        if (!ani && this._needRefresh)
            this.refresh();
    }

    public isChildInView(obj: GObject): boolean {
        if (this._overlapSize.y > 0) {
            // `container.positionY` is the negated downward offset, so adding
            // it is the same as subtracting the scroll position.
            const dist: number = obj.y + this._container.positionY;
            if (dist < -obj.height || dist > this._viewSize.y)
                return false;
        }

        if (this._overlapSize.x > 0) {
            const dist: number = obj.x + this._container.positionX;
            if (dist < -obj.width || dist > this._viewSize.x)
                return false;
        }

        return true;
    }

    public cancelDragging(): void {
        if (ScrollPane.draggingPane === this)
            ScrollPane.draggingPane = null;

        _gestureFlag = 0;
        this._dragged = false;
    }

    /** Reserves space at the leading edge for a pull-down refresh bar. */
    public lockHeader(size: number): void {
        if (this._headerLockedSize === size)
            return;

        const cx: number = this._container.positionX;
        const cy: number = this._container.positionY;
        const cr: number = this._refreshBarAxis === 'x' ? cx : cy;

        this._headerLockedSize = size;

        if (!this._refreshEventDispatching && cr >= 0) {
            this._tweenStart.x = cx;
            this._tweenStart.y = cy;
            this._tweenChange.setTo(0, 0);
            this._tweenChange[this._refreshBarAxis] = this._headerLockedSize - this._tweenStart[this._refreshBarAxis];
            this._tweenDuration.x = this._tweenDuration.y = TWEEN_TIME_DEFAULT;
            this.startTween(2);
        }
    }

    /** Reserves space at the trailing edge for a pull-up refresh bar. */
    public lockFooter(size: number): void {
        if (this._footerLockedSize === size)
            return;

        const cx: number = this._container.positionX;
        const cy: number = this._container.positionY;
        const cr: number = this._refreshBarAxis === 'x' ? cx : cy;

        this._footerLockedSize = size;

        if (!this._refreshEventDispatching && cr <= -this._overlapSize[this._refreshBarAxis]) {
            this._tweenStart.x = cx;
            this._tweenStart.y = cy;
            this._tweenChange.setTo(0, 0);
            let max: number = this._overlapSize[this._refreshBarAxis];
            if (max === 0)
                max = Math.max(this._contentSize[this._refreshBarAxis] + this._footerLockedSize - this._viewSize[this._refreshBarAxis], 0);
            else
                max += this._footerLockedSize;
            this._tweenChange[this._refreshBarAxis] = -max - this._tweenStart[this._refreshBarAxis];
            this._tweenDuration.x = this._tweenDuration.y = TWEEN_TIME_DEFAULT;
            this.startTween(2);
        }
    }

    public onOwnerSizeChanged(): void {
        this.setSize(this._owner.width, this._owner.height);
        this.posChanged(false);
    }

    public handleControllerChanged(c: Controller): void {
        if (this._pageController === c) {
            if (this._scrollType === ScrollType.Horizontal)
                this.setCurrentPageX(c.selectedIndex, true);
            else
                this.setCurrentPageY(c.selectedIndex, true);
        }
    }

    private updatePageController(): void {
        if (this._pageController && !this._pageController.changing) {
            let index: number;
            if (this._scrollType === ScrollType.Horizontal)
                index = this.currentPageX;
            else
                index = this.currentPageY;
            if (index < this._pageController.pageCount) {
                const c: Controller = this._pageController;
                // Cleared around the assignment so the resulting
                // `handleControllerChanged` does not scroll us back.
                this._pageController = null;
                c.selectedIndex = index;
                this._pageController = c;
            }
        }
    }

    /**
     * Places the clip node and the container for the owner's current box.
     *
     * The reference expressed this with a Cocos anchor, which is the same thing
     * as saying where the clip rect's top-left sits relative to the container's
     * origin; this port says it directly in `scrollRect`.
     */
    public adjustMaskContainer(): void {
        let mx = 0;
        if (this._displayOnLeft && this._vtScrollBar && !this._floating)
            mx = this._vtScrollBar.width;

        const o = this._owner;

        if (o._customMask) {
            // With a custom mask `GComponent` positions the container itself,
            // so the clip node holds still at the offset the reference gave it.
            this._maskContainer.setPosition(mx + o._alignOffset.x, o._alignOffset.y);
        } else {
            this._maskContainer.setPosition(
                o._pivotCorrectX + mx + o._alignOffset.x,
                o._pivotCorrectY + o._alignOffset.y);
        }

        let maskWidth: number = this._viewSize.x;
        let maskHeight: number = this._viewSize.y;
        if (this._vScrollNone && this._vtScrollBar)
            maskWidth += this._vtScrollBar.width;
        if (this._hScrollNone && this._hzScrollBar)
            maskHeight += this._hzScrollBar.height;

        let originX = 0;
        let originY = 0;
        if (this._dontClipMargin) {
            maskWidth += o.margin.left + o.margin.right;
            maskHeight += o.margin.top + o.margin.bottom;
            originX = -(o.margin.left + o._alignOffset.x);
            originY = -(o.margin.top + o._alignOffset.y);
        }

        this._maskContainer.setContentSize(maskWidth, maskHeight);

        const clip = this._maskContainer.scrollRect;
        if (clip)
            clip.setTo(originX, originY, maskWidth, maskHeight);
        else
            this._maskContainer.scrollRect = new Rect(originX, originY, maskWidth, maskHeight);
    }

    public setSize(aWidth: number, aHeight: number): void {
        if (this._hzScrollBar) {
            this._hzScrollBar.y = aHeight - this._hzScrollBar.height;
            if (this._vtScrollBar) {
                this._hzScrollBar.width = aWidth - this._vtScrollBar.width - this._scrollBarMargin.left - this._scrollBarMargin.right;
                if (this._displayOnLeft)
                    this._hzScrollBar.x = this._scrollBarMargin.left + this._vtScrollBar.width;
                else
                    this._hzScrollBar.x = this._scrollBarMargin.left;
            } else {
                this._hzScrollBar.width = aWidth - this._scrollBarMargin.left - this._scrollBarMargin.right;
                this._hzScrollBar.x = this._scrollBarMargin.left;
            }
        }
        if (this._vtScrollBar) {
            if (!this._displayOnLeft)
                this._vtScrollBar.x = aWidth - this._vtScrollBar.width;
            if (this._hzScrollBar)
                this._vtScrollBar.height = aHeight - this._hzScrollBar.height - this._scrollBarMargin.top - this._scrollBarMargin.bottom;
            else
                this._vtScrollBar.height = aHeight - this._scrollBarMargin.top - this._scrollBarMargin.bottom;
            this._vtScrollBar.y = this._scrollBarMargin.top;
        }

        this._viewSize.x = aWidth;
        this._viewSize.y = aHeight;
        if (this._hzScrollBar && !this._floating)
            this._viewSize.y -= this._hzScrollBar.height;
        if (this._vtScrollBar && !this._floating)
            this._viewSize.x -= this._vtScrollBar.width;
        this._viewSize.x -= this._owner.margin.left + this._owner.margin.right;
        this._viewSize.y -= this._owner.margin.top + this._owner.margin.bottom;

        this._viewSize.x = Math.max(1, this._viewSize.x);
        this._viewSize.y = Math.max(1, this._viewSize.y);
        this._pageSize.x = this._viewSize.x;
        this._pageSize.y = this._viewSize.y;

        this.adjustMaskContainer();
        this.handleSizeChanged();
    }

    public setContentSize(aWidth: number, aHeight: number): void {
        if (this._contentSize.x === aWidth && this._contentSize.y === aHeight)
            return;

        this._contentSize.x = aWidth;
        this._contentSize.y = aHeight;
        this.handleSizeChanged();

        // A looping pane holds several copies of its items and belongs in the
        // middle of them, with room to scroll either way. Nothing else gets it
        // there on the first pass: the position starts at 0 — the very left of
        // the first copy — and only the loop's own re-basing, which runs on a
        // scroll, moves it. The first frame of a loop list was therefore drawn
        // from the end of the strip and snapped into place as soon as anything
        // was scrolled.
        if (this._loop !== 0)
            this.loopCheckingCurrent();

        if (this._snapToItem && this._snappingPolicy !== 0 && this._xPos === 0 && this._yPos === 0)
            this.posChanged(false);
    }

    public changeContentSizeOnScrolling(deltaWidth: number, deltaHeight: number,
        deltaPosX: number, deltaPosY: number): void {
        const isRightmost: boolean = this._xPos === this._overlapSize.x;
        const isBottom: boolean = this._yPos === this._overlapSize.y;

        this._contentSize.x += deltaWidth;
        this._contentSize.y += deltaHeight;
        this.handleSizeChanged();

        if (this._tweening === 1) {
            // Was pinned to the trailing edge; stay pinned as content grows.
            if (deltaWidth !== 0 && isRightmost && this._tweenChange.x < 0) {
                this._xPos = this._overlapSize.x;
                this._tweenChange.x = -this._xPos - this._tweenStart.x;
            }

            if (deltaHeight !== 0 && isBottom && this._tweenChange.y < 0) {
                this._yPos = this._overlapSize.y;
                this._tweenChange.y = -this._yPos - this._tweenStart.y;
            }
        } else if (this._tweening === 2) {
            // Re-anchor the fling so it keeps travelling smoothly.
            if (deltaPosX !== 0) {
                this._container.setPosition(this._container.positionX - deltaPosX, this._container.positionY);
                this._tweenStart.x -= deltaPosX;
                this._xPos = -this._container.positionX;
            }
            if (deltaPosY !== 0) {
                this._container.setPosition(this._container.positionX, this._container.positionY - deltaPosY);
                this._tweenStart.y -= deltaPosY;
                this._yPos = -this._container.positionY;
            }
        } else if (this._dragged) {
            if (deltaPosX !== 0) {
                this._container.setPosition(this._container.positionX - deltaPosX, this._container.positionY);
                this._containerPos.x -= deltaPosX;
                this._xPos = -this._container.positionX;
            }
            if (deltaPosY !== 0) {
                this._container.setPosition(this._container.positionX, this._container.positionY - deltaPosY);
                this._containerPos.y -= deltaPosY;
                this._yPos = -this._container.positionY;
            }
        } else {
            // Was pinned to the trailing edge; stay pinned as content grows.
            if (deltaWidth !== 0 && isRightmost) {
                this._xPos = this._overlapSize.x;
                this._container.setPosition(-this._xPos, this._container.positionY);
            }

            if (deltaHeight !== 0 && isBottom) {
                this._yPos = this._overlapSize.y;
                this._container.setPosition(this._container.positionX, -this._yPos);
            }
        }

        if (this._pageMode)
            this.updatePageController();
    }

    private handleSizeChanged(): void {
        if (this._displayInDemand) {
            this._vScrollNone = this._contentSize.y <= this._viewSize.y;
            this._hScrollNone = this._contentSize.x <= this._viewSize.x;
        }

        if (this._vtScrollBar) {
            if (this._contentSize.y === 0)
                this._vtScrollBar.setDisplayPerc(0);
            else
                this._vtScrollBar.setDisplayPerc(Math.min(1, this._viewSize.y / this._contentSize.y));
        }
        if (this._hzScrollBar) {
            if (this._contentSize.x === 0)
                this._hzScrollBar.setDisplayPerc(0);
            else
                this._hzScrollBar.setDisplayPerc(Math.min(1, this._viewSize.x / this._contentSize.x));
        }

        this.updateScrollBarVisible();
        this.adjustMaskContainer();

        // The reference nudged the bars, header and footer here because Cocos
        // nodes do not follow a size change on their own. `GObject`'s setters
        // already do, so there is nothing to call.

        if (this._scrollType === ScrollType.Horizontal || this._scrollType === ScrollType.Both)
            this._overlapSize.x = Math.ceil(Math.max(0, this._contentSize.x - this._viewSize.x));
        else
            this._overlapSize.x = 0;
        if (this._scrollType === ScrollType.Vertical || this._scrollType === ScrollType.Both)
            this._overlapSize.y = Math.ceil(Math.max(0, this._contentSize.y - this._viewSize.y));
        else
            this._overlapSize.y = 0;

        // Boundary check.
        this._xPos = ToolSet.clamp(this._xPos, 0, this._overlapSize.x);
        this._yPos = ToolSet.clamp(this._yPos, 0, this._overlapSize.y);

        let max: number = this._overlapSize[this._refreshBarAxis];
        if (max === 0)
            max = Math.max(this._contentSize[this._refreshBarAxis] + this._footerLockedSize - this._viewSize[this._refreshBarAxis], 0);
        else
            max += this._footerLockedSize;

        const cx = this._container.positionX;
        const cy = this._container.positionY;
        if (this._refreshBarAxis === 'x')
            this._container.setPosition(
                ToolSet.clamp(cx, -max, this._headerLockedSize),
                ToolSet.clamp(cy, -this._overlapSize.y, 0));
        else
            this._container.setPosition(
                ToolSet.clamp(cx, -this._overlapSize.x, 0),
                ToolSet.clamp(cy, -max, this._headerLockedSize));

        if (this._header) {
            if (this._refreshBarAxis === 'x')
                this._header.height = this._viewSize.y;
            else
                this._header.width = this._viewSize.x;
        }

        if (this._footer) {
            if (this._refreshBarAxis === 'y')
                this._footer.height = this._viewSize.y;
            else
                this._footer.width = this._viewSize.x;
        }

        this.updateScrollBarPos();
        if (this._pageMode)
            this.updatePageController();
    }

    private posChanged(ani: boolean): void {
        if (this._aniFlag === 0)
            this._aniFlag = ani ? 1 : -1;
        else if (this._aniFlag === 1 && !ani)
            this._aniFlag = -1;

        this._needRefresh = true;
        scheduler.callLater(this, () => this.refresh());
    }

    /**
     * Applies a deferred position change: snapping, page alignment, and starting
     * an animated move when the change asked for one.
     *
     * Runs from the scheduler, so a caller that changes the position several
     * times in one frame only pays for one refresh.
     */
    private refresh(): void {
        this._needRefresh = false;
        scheduler.cancel(this);

        if (this._pageMode || this._snapToItem) {
            sEndPos.x = -this._xPos;
            sEndPos.y = -this._yPos;
            this.alignPosition(sEndPos, false);
            this._xPos = -sEndPos.x;
            this._yPos = -sEndPos.y;
        }

        this.refresh2();

        this._owner.emit(EventType.SCROLL, this._owner);
        if (this._needRefresh) {
            // A SCROLL listener may have moved us; refresh once more so the
            // frame does not show the stale position.
            this._needRefresh = false;
            scheduler.cancel(this);

            this.refresh2();
        }

        this.updateScrollBarPos();
        this._aniFlag = 0;
    }

    private refresh2(): void {
        if (this._aniFlag === 1 && !this._dragged) {
            let posX: number;
            let posY: number;

            if (this._overlapSize.x > 0)
                posX = -Math.floor(this._xPos);
            else {
                if (this._container.positionX !== 0)
                    this._container.setPosition(0, this._container.positionY);
                posX = 0;
            }
            if (this._overlapSize.y > 0)
                posY = -Math.floor(this._yPos);
            else {
                if (this._container.positionY !== 0)
                    this._container.setPosition(this._container.positionX, 0);
                posY = 0;
            }

            if (posX !== this._container.positionX || posY !== this._container.positionY) {
                this._tweenDuration.x = this._tweenDuration.y = TWEEN_TIME_GO;
                this._tweenStart.x = this._container.positionX;
                this._tweenStart.y = this._container.positionY;
                this._tweenChange.x = posX - this._tweenStart.x;
                this._tweenChange.y = posY - this._tweenStart.y;
                this.startTween(1);
            } else if (this._tweening !== 0)
                this.killTween();
        } else {
            if (this._tweening !== 0)
                this.killTween();

            this._container.setPosition(Math.floor(-this._xPos), Math.floor(-this._yPos));

            this.loopCheckingCurrent();
        }

        if (this._pageMode)
            this.updatePageController();
    }

    // ---- input -----------------------------------------------------------
    //
    // The input layer owns hit testing and dispatch; these four entry points are
    // what it calls. Positions arrive in UI-root space, exactly as the reference
    // read them off Cocos' event objects.

    public onTouchBegin(evt: Event): void {
        if (!this._touchEffect)
            return;

        evt.captureTouch();

        if (this._tweening !== 0) {
            this.killTween();
            getStage()?.inputProcessor.cancelClick(evt.touchId);
            this._dragged = true;
        } else {
            this._dragged = false;
        }

        const pt: Point = this._owner.globalToLocal(evt.pos.x, evt.pos.y, s_vec2);

        this._containerPos.x = this._container.positionX;
        this._containerPos.y = this._container.positionY;
        this._beginTouchPos.setTo(pt.x, pt.y);
        this._lastTouchPos.setTo(pt.x, pt.y);
        this._lastTouchGlobalPos.setTo(evt.pos.x, evt.pos.y);
        this._isHoldAreaDone = false;
        this._velocity.setTo(0, 0);
        this._velocityScale = 1;
        this._lastMoveTime = this._clock;
    }

    public onTouchMove(evt: Event): void {
        if (!this._touchEffect)
            return;

        if (GObject.draggingObject && GObject.draggingObject.onStage)
            return;

        if (ScrollPane.draggingPane && ScrollPane.draggingPane !== this && ScrollPane.draggingPane._owner.onStage)
            return;

        const pt: Point = this._owner.globalToLocal(evt.pos.x, evt.pos.y, s_vec2);

        const sensitivity: number = UIConfig.touchScrollSensitivity;
        let diff: number;
        let diff2: number;
        let sv = false;
        let sh = false;

        if (this._scrollType === ScrollType.Vertical) {
            if (!this._isHoldAreaDone) {
                // A vertical gesture is being watched for.
                _gestureFlag |= 1;

                diff = Math.abs(this._beginTouchPos.y - pt.y);
                if (diff < sensitivity)
                    return;

                if ((_gestureFlag & 2) !== 0) {
                    // Horizontally ambiguous; require a clearly vertical move.
                    diff2 = Math.abs(this._beginTouchPos.x - pt.x);
                    if (diff < diff2)
                        return;
                }
            }

            sv = true;
        } else if (this._scrollType === ScrollType.Horizontal) {
            if (!this._isHoldAreaDone) {
                _gestureFlag |= 2;

                diff = Math.abs(this._beginTouchPos.x - pt.x);
                if (diff < sensitivity)
                    return;

                if ((_gestureFlag & 1) !== 0) {
                    diff2 = Math.abs(this._beginTouchPos.y - pt.y);
                    if (diff < diff2)
                        return;
                }
            }

            sh = true;
        } else {
            _gestureFlag = 3;

            if (!this._isHoldAreaDone) {
                diff = Math.abs(this._beginTouchPos.y - pt.y);
                if (diff < sensitivity) {
                    diff = Math.abs(this._beginTouchPos.x - pt.x);
                    if (diff < sensitivity)
                        return;
                }
            }

            sv = sh = true;
        }

        let newPosX: number = Math.floor(this._containerPos.x + pt.x - this._beginTouchPos.x);
        let newPosY: number = Math.floor(this._containerPos.y + pt.y - this._beginTouchPos.y);

        if (sv) {
            if (newPosY > 0) {
                if (!this._bouncebackEffect)
                    this._container.setPosition(this._container.positionX, 0);
                else if (this._header && this._header.maxHeight !== 0)
                    this._container.setPosition(this._container.positionX, Math.floor(Math.min(newPosY * 0.5, this._header.maxHeight)));
                else
                    this._container.setPosition(this._container.positionX, Math.floor(Math.min(newPosY * 0.5, this._viewSize.y * PULL_RATIO)));
            } else if (newPosY < -this._overlapSize.y) {
                if (!this._bouncebackEffect)
                    this._container.setPosition(this._container.positionX, -this._overlapSize.y);
                else if (this._footer && this._footer.maxHeight > 0)
                    this._container.setPosition(this._container.positionX,
                        Math.floor(Math.max((newPosY + this._overlapSize.y) * 0.5, -this._footer.maxHeight) - this._overlapSize.y));
                else
                    this._container.setPosition(this._container.positionX,
                        Math.floor(Math.max((newPosY + this._overlapSize.y) * 0.5, -this._viewSize.y * PULL_RATIO) - this._overlapSize.y));
            } else {
                this._container.setPosition(this._container.positionX, newPosY);
            }
        }

        if (sh) {
            if (newPosX > 0) {
                if (!this._bouncebackEffect)
                    this._container.setPosition(0, this._container.positionY);
                else if (this._header && this._header.maxWidth !== 0)
                    this._container.setPosition(Math.floor(Math.min(newPosX * 0.5, this._header.maxWidth)), this._container.positionY);
                else
                    this._container.setPosition(Math.floor(Math.min(newPosX * 0.5, this._viewSize.x * PULL_RATIO)), this._container.positionY);
            } else if (newPosX < 0 - this._overlapSize.x) {
                if (!this._bouncebackEffect)
                    this._container.setPosition(-this._overlapSize.x, this._container.positionY);
                else if (this._footer && this._footer.maxWidth > 0)
                    this._container.setPosition(Math.floor(Math.max((newPosX + this._overlapSize.x) * 0.5, -this._footer.maxWidth) - this._overlapSize.x),
                        this._container.positionY);
                else
                    this._container.setPosition(Math.floor(Math.max((newPosX + this._overlapSize.x) * 0.5, -this._viewSize.x * PULL_RATIO) - this._overlapSize.x),
                        this._container.positionY);
            } else {
                this._container.setPosition(newPosX, this._container.positionY);
            }
        }

        // Update the velocity.
        const now: number = this._clock;
        const deltaTime: number = Math.max(now - this._lastMoveTime, 1 / 60);
        let deltaPositionX: number = pt.x - this._lastTouchPos.x;
        let deltaPositionY: number = pt.y - this._lastTouchPos.y;
        if (!sh)
            deltaPositionX = 0;
        if (!sv)
            deltaPositionY = 0;
        if (deltaTime !== 0) {
            const frameRate = 60;
            const elapsed: number = deltaTime * frameRate - 1;
            if (elapsed > 1) {
                const factor: number = Math.pow(0.833, elapsed);
                this._velocity.x = this._velocity.x * factor;
                this._velocity.y = this._velocity.y * factor;
            }
            this._velocity.x = ToolSet.lerp(this._velocity.x, deltaPositionX * 60 / frameRate / deltaTime, deltaTime * 10);
            this._velocity.y = ToolSet.lerp(this._velocity.y, deltaPositionY * 60 / frameRate / deltaTime, deltaTime * 10);
        }

        // Velocity is computed from the local displacement, but the fling maths
        // needs screen displacement, so keep the ratio between them.
        const deltaGlobalPositionX: number = this._lastTouchGlobalPos.x - evt.pos.x;
        const deltaGlobalPositionY: number = this._lastTouchGlobalPos.y - evt.pos.y;
        if (deltaPositionX !== 0)
            this._velocityScale = Math.abs(deltaGlobalPositionX / deltaPositionX);
        else if (deltaPositionY !== 0)
            this._velocityScale = Math.abs(deltaGlobalPositionY / deltaPositionY);

        this._lastTouchPos.setTo(pt.x, pt.y);
        this._lastTouchGlobalPos.setTo(evt.pos.x, evt.pos.y);
        this._lastMoveTime = now;

        // Keep the pos values in step with the container.
        if (this._overlapSize.x > 0)
            this._xPos = ToolSet.clamp(-this._container.positionX, 0, this._overlapSize.x);
        if (this._overlapSize.y > 0)
            this._yPos = ToolSet.clamp(-this._container.positionY, 0, this._overlapSize.y);

        // Looping needs a special check after the wrap.
        if (this._loop !== 0) {
            newPosX = this._container.positionX;
            newPosY = this._container.positionY;
            if (this.loopCheckingCurrent()) {
                this._containerPos.x += this._container.positionX - newPosX;
                this._containerPos.y += this._container.positionY - newPosY;
            }
        }

        ScrollPane.draggingPane = this;
        this._isHoldAreaDone = true;
        this._dragged = true;

        this.updateScrollBarPos();
        this.updateScrollBarVisible();
        if (this._pageMode)
            this.updatePageController();

        // The reference's comma operator dropped the owner argument here.
        this._owner.emit(EventType.SCROLL, this._owner);
    }

    public onTouchEnd(_evt: Event): void {
        if (ScrollPane.draggingPane === this)
            ScrollPane.draggingPane = null;

        _gestureFlag = 0;

        if (!this._dragged || !this._touchEffect || !this._owner.onStage) {
            this._dragged = false;
            return;
        }

        this._dragged = false;

        this._tweenStart.x = this._container.positionX;
        this._tweenStart.y = this._container.positionY;

        sEndPos.setTo(this._tweenStart.x, this._tweenStart.y);
        let flag = false;
        if (this._container.positionX > 0) {
            sEndPos.x = 0;
            flag = true;
        } else if (this._container.positionX < -this._overlapSize.x) {
            sEndPos.x = -this._overlapSize.x;
            flag = true;
        }
        if (this._container.positionY > 0) {
            sEndPos.y = 0;
            flag = true;
        } else if (this._container.positionY < -this._overlapSize.y) {
            sEndPos.y = -this._overlapSize.y;
            flag = true;
        }
        if (flag) {
            this._tweenChange.x = sEndPos.x - this._tweenStart.x;
            this._tweenChange.y = sEndPos.y - this._tweenStart.y;
            if (this._tweenChange.x < -UIConfig.touchDragSensitivity || this._tweenChange.y < -UIConfig.touchDragSensitivity) {
                this._refreshEventDispatching = true;
                this._owner.emit(EventType.PULL_DOWN_RELEASE, this._owner);
                this._refreshEventDispatching = false;
            } else if (this._tweenChange.x > UIConfig.touchDragSensitivity || this._tweenChange.y > UIConfig.touchDragSensitivity) {
                this._refreshEventDispatching = true;
                this._owner.emit(EventType.PULL_UP_RELEASE, this._owner);
                this._refreshEventDispatching = false;
            }

            if (this._headerLockedSize > 0 && sEndPos[this._refreshBarAxis] === 0) {
                sEndPos[this._refreshBarAxis] = this._headerLockedSize;
                this._tweenChange.x = sEndPos.x - this._tweenStart.x;
                this._tweenChange.y = sEndPos.y - this._tweenStart.y;
            } else if (this._footerLockedSize > 0 && sEndPos[this._refreshBarAxis] === -this._overlapSize[this._refreshBarAxis]) {
                let max: number = this._overlapSize[this._refreshBarAxis];
                if (max === 0)
                    max = Math.max(this._contentSize[this._refreshBarAxis] + this._footerLockedSize - this._viewSize[this._refreshBarAxis], 0);
                else
                    max += this._footerLockedSize;
                sEndPos[this._refreshBarAxis] = -max;
                this._tweenChange.x = sEndPos.x - this._tweenStart.x;
                this._tweenChange.y = sEndPos.y - this._tweenStart.y;
            }

            this._tweenDuration.x = this._tweenDuration.y = TWEEN_TIME_DEFAULT;
        } else {
            // Update the velocity one last time.
            if (!this._inertiaDisabled) {
                const frameRate = 60;
                const elapsed: number = (this._clock - this._lastMoveTime) * frameRate - 1;
                if (elapsed > 1) {
                    const factor: number = Math.pow(0.833, elapsed);
                    this._velocity.x = this._velocity.x * factor;
                    this._velocity.y = this._velocity.y * factor;
                }
                // Target position and duration from the velocity.
                this.updateTargetAndDuration(this._tweenStart, sEndPos);
            } else {
                this._tweenDuration.x = this._tweenDuration.y = TWEEN_TIME_DEFAULT;
            }
            sOldChange.x = sEndPos.x - this._tweenStart.x;
            sOldChange.y = sEndPos.y - this._tweenStart.y;

            // Adjust the target.
            this.loopCheckingTarget(sEndPos);
            if (this._pageMode || this._snapToItem)
                this.alignPosition(sEndPos, true);

            this._tweenChange.x = sEndPos.x - this._tweenStart.x;
            this._tweenChange.y = sEndPos.y - this._tweenStart.y;
            if (this._tweenChange.x === 0 && this._tweenChange.y === 0) {
                this.updateScrollBarVisible();
                return;
            }

            // The target moved, so the duration has to follow.
            if (this._pageMode || this._snapToItem) {
                this.fixDuration('x', sOldChange.x);
                this.fixDuration('y', sOldChange.y);
            }
        }

        this.startTween(2);
    }

    /** Called by the input layer when the pointer enters the pane. */
    public onRollOver(): void {
        this._hover = true;
        this.updateScrollBarVisible();
    }

    /** Called by the input layer when the pointer leaves the pane. */
    public onRollOut(): void {
        this._hover = false;
        this.updateScrollBarVisible();
    }

    public onMouseWheel(evt: Event): void {
        if (!this._mouseWheelEnabled)
            return;

        const delta = evt.mouseWheelDelta > 0 ? -1 : 1;
        if (this._overlapSize.x > 0 && this._overlapSize.y === 0) {
            if (this._pageMode)
                this.setPosX(this._xPos + this._pageSize.x * delta, false);
            else
                this.setPosX(this._xPos + this._mouseWheelStep * delta, false);
        } else {
            if (this._pageMode)
                this.setPosY(this._yPos + this._pageSize.y * delta, false);
            else
                this.setPosY(this._yPos + this._mouseWheelStep * delta, false);
        }
    }

    private updateScrollBarPos(): void {
        if (this._vtScrollBar)
            this._vtScrollBar.setScrollPerc(this._overlapSize.y === 0 ? 0 : ToolSet.clamp(-this._container.positionY, 0, this._overlapSize.y) / this._overlapSize.y);

        if (this._hzScrollBar)
            this._hzScrollBar.setScrollPerc(this._overlapSize.x === 0 ? 0 : ToolSet.clamp(-this._container.positionX, 0, this._overlapSize.x) / this._overlapSize.x);

        this.checkRefreshBar();
    }

    public updateScrollBarVisible(): void {
        if (this._vtScrollBar) {
            if (this._viewSize.y <= this._vtScrollBar.minSize || this._vScrollNone)
                this._vtScrollBar.visible = false;
            else
                this.updateScrollBarVisible2(this._vtScrollBar);
        }

        if (this._hzScrollBar) {
            if (this._viewSize.x <= this._hzScrollBar.minSize || this._hScrollNone)
                this._hzScrollBar.visible = false;
            else
                this.updateScrollBarVisible2(this._hzScrollBar);
        }
    }

    private updateScrollBarVisible2(bar: GScrollBar): void {
        if (this._scrollBarDisplayAuto)
            GTween.kill(bar, false, 'alpha');

        if (this._scrollBarDisplayAuto && !this._hover && this._tweening === 0 && !this._dragged && !bar.gripDragging) {
            if (bar.visible)
                GTween.to(1, 0, 0.5).setDelay(0.5).onComplete(this.onBarTweenComplete, this).setTarget(bar, 'alpha');
        } else {
            bar.alpha = 1;
            bar.visible = true;
        }
    }

    private onBarTweenComplete(tweener: GTweener): void {
        const bar: GObject = tweener.target as GObject;
        bar.alpha = 1;
        // The reference switched the *node's* active flag, leaving `GObject`'s
        // own visibility alone; going through `visible` keeps the two in step.
        bar.visible = false;
    }

    private getLoopPartSize(division: number, axis: 'x' | 'y'): number {
        const owner = this._owner as unknown as GList;
        return (this._contentSize[axis] + (axis === 'x' ? owner.columnGap : owner.lineGap)) / division;
    }

    private loopCheckingCurrent(): boolean {
        let changed = false;
        if (this._loop === 1 && this._overlapSize.x > 0) {
            if (this._xPos < 0.001) {
                this._xPos += this.getLoopPartSize(2, 'x');
                changed = true;
            } else if (this._xPos >= this._overlapSize.x) {
                this._xPos -= this.getLoopPartSize(2, 'x');
                changed = true;
            }
        } else if (this._loop === 2 && this._overlapSize.y > 0) {
            if (this._yPos < 0.001) {
                this._yPos += this.getLoopPartSize(2, 'y');
                changed = true;
            } else if (this._yPos >= this._overlapSize.y) {
                this._yPos -= this.getLoopPartSize(2, 'y');
                changed = true;
            }
        }

        if (changed)
            this._container.setPosition(Math.floor(-this._xPos), Math.floor(-this._yPos));

        return changed;
    }

    private loopCheckingTarget(endPos: Point): void {
        if (this._loop === 1)
            this.loopCheckingTarget2(endPos, 'x');

        if (this._loop === 2)
            this.loopCheckingTarget2(endPos, 'y');
    }

    private loopCheckingTarget2(endPos: Point, axis: 'x' | 'y'): void {
        let halfSize: number;
        let tmp: number;
        if (endPos[axis] > 0) {
            halfSize = this.getLoopPartSize(2, axis);
            tmp = this._tweenStart[axis] - halfSize;
            if (tmp <= 0 && tmp >= -this._overlapSize[axis]) {
                endPos[axis] -= halfSize;
                this._tweenStart[axis] = tmp;
            }
        } else if (endPos[axis] < -this._overlapSize[axis]) {
            halfSize = this.getLoopPartSize(2, axis);
            tmp = this._tweenStart[axis] + halfSize;
            if (tmp <= 0 && tmp >= -this._overlapSize[axis]) {
                endPos[axis] += halfSize;
                this._tweenStart[axis] = tmp;
            }
        }
    }

    private loopCheckingNewPos(value: number, axis: 'x' | 'y'): number {
        if (this._overlapSize[axis] === 0)
            return value;

        let pos: number = axis === 'x' ? this._xPos : this._yPos;
        let changed = false;
        let v: number;
        if (value < 0.001) {
            value += this.getLoopPartSize(2, axis);
            if (value > pos) {
                v = this.getLoopPartSize(6, axis);
                v = Math.ceil((value - pos) / v) * v;
                pos = ToolSet.clamp(pos + v, 0, this._overlapSize[axis]);
                changed = true;
            }
        } else if (value >= this._overlapSize[axis]) {
            value -= this.getLoopPartSize(2, axis);
            if (value < pos) {
                v = this.getLoopPartSize(6, axis);
                v = Math.ceil((pos - value) / v) * v;
                pos = ToolSet.clamp(pos - v, 0, this._overlapSize[axis]);
                changed = true;
            }
        }

        if (changed) {
            if (axis === 'x')
                this._container.setPosition(-Math.floor(pos), this._container.positionY);
            else
                this._container.setPosition(this._container.positionX, -Math.floor(pos));
        }

        return value;
    }

    private alignPosition(pos: Point, inertialScrolling: boolean): void {
        let ax = 0;
        let ay = 0;
        if (this._snappingPolicy === 1) {
            if (this._owner.numChildren > 0) {
                // Assumes every child is the same size.
                const obj = this._owner.getChildAt(0);
                ax = Math.floor(this._viewSize.x * 0.5 - obj.width * 0.5);
                ay = Math.floor(this._viewSize.y * 0.5 - obj.height * 0.5);
            }
        } else if (this._snappingPolicy === 2) {
            if (this._owner.numChildren > 0) {
                // Assumes every child is the same size.
                const obj = this._owner.getChildAt(0);
                ax = Math.floor(this._viewSize.x - obj.width);
                ay = Math.floor(this._viewSize.y - obj.height);
            }
        }

        pos.x -= ax;
        pos.y -= ay;
        if (this._pageMode) {
            pos.x = this.alignByPage(pos.x, 'x', inertialScrolling);
            pos.y = this.alignByPage(pos.y, 'y', inertialScrolling);
        } else if (this._snapToItem) {
            const pt: Point = this._owner.getSnappingPosition(-pos.x, -pos.y, s_vec2);
            if (pos.x < 0 && pos.x > -this._overlapSize.x)
                pos.x = -pt.x;
            if (pos.y < 0 && pos.y > -this._overlapSize.y)
                pos.y = -pt.y;
        }
        pos.x += ax;
        pos.y += ay;
    }

    private alignByPage(pos: number, axis: 'x' | 'y', inertialScrolling: boolean): number {
        let page: number;

        if (pos > 0) {
            page = 0;
        } else if (pos < -this._overlapSize[axis]) {
            page = Math.ceil(this._contentSize[axis] / this._pageSize[axis]) - 1;
        } else {
            page = Math.floor(-pos / this._pageSize[axis]);
            const change: number = inertialScrolling
                ? (pos - this._containerPos[axis])
                : (pos - (axis === 'x' ? this._container.positionX : this._container.positionY));
            const testPageSize: number = Math.min(this._pageSize[axis], this._contentSize[axis] - (page + 1) * this._pageSize[axis]);
            const delta: number = -pos - page * this._pageSize[axis];

            // Page snapping policy.
            if (Math.abs(change) > this._pageSize[axis]) {
                // More than a page of travel: past the halfway mark is enough.
                if (delta > testPageSize * 0.5)
                    page++;
            } else {
                // Otherwise a third of the page, adjusted for the direction.
                if (delta > testPageSize * (change < 0 ? 0.3 : 0.7))
                    page++;
            }

            // Recompute the destination.
            pos = -page * this._pageSize[axis];
            if (pos < -this._overlapSize[axis]) // the last page may be short
                pos = -this._overlapSize[axis];
        }

        // While flinging, try not to travel more than one page.
        if (inertialScrolling) {
            const oldPos: number = this._tweenStart[axis];
            let oldPage: number;
            if (oldPos > 0)
                oldPage = 0;
            else if (oldPos < -this._overlapSize[axis])
                oldPage = Math.ceil(this._contentSize[axis] / this._pageSize[axis]) - 1;
            else
                oldPage = Math.floor(-oldPos / this._pageSize[axis]);
            const startPage: number = Math.floor(-this._containerPos[axis] / this._pageSize[axis]);
            if (Math.abs(page - startPage) > 1 && Math.abs(oldPage - startPage) <= 1) {
                if (page > startPage)
                    page = startPage + 1;
                else
                    page = startPage - 1;
                pos = -page * this._pageSize[axis];
            }
        }

        return pos;
    }

    private updateTargetAndDuration(orignPos: Point, resultPos: Point): void {
        resultPos.x = this.updateTargetAndDuration2(orignPos.x, 'x');
        resultPos.y = this.updateTargetAndDuration2(orignPos.y, 'y');
    }

    private updateTargetAndDuration2(pos: number, axis: 'x' | 'y'): number {
        let v: number = this._velocity[axis];
        let duration = 0;
        if (pos > 0) {
            pos = 0;
        } else if (pos < -this._overlapSize[axis]) {
            pos = -this._overlapSize[axis];
        } else {
            // Screen pixels are the yardstick.
            const isMobile: boolean = ScrollPaneEnv.isMobile;
            let v2: number = Math.abs(v) * this._velocityScale;
            // On mobile the speed thresholds are taken against a 1136-pixel
            // reference resolution.
            if (isMobile)
                v2 *= 1136 / Math.max(ScrollPaneEnv.screenWidth, ScrollPaneEnv.screenHeight);
            // Below the threshold, a slow drag should not fling at all.
            let ratio = 0;

            if (this._pageMode || !isMobile) {
                if (v2 > 500)
                    ratio = Math.pow((v2 - 500) / 500, 2);
            } else {
                if (v2 > 1000)
                    ratio = Math.pow((v2 - 1000) / 1000, 2);
            }
            if (ratio !== 0) {
                if (ratio > 1)
                    ratio = 1;

                v2 *= ratio;
                v *= ratio;
                this._velocity[axis] = v;

                // `v * decelerationRate^n == 60` at the frame the fling stops,
                // assuming 60 frames a second.
                duration = Math.log(60 / v2) / Math.log(this._decelerationRate) / 60;

                // The theoretical distance falls short; the reference used this
                // empirical factor instead.
                const change: number = Math.floor(v * duration * 0.4);
                pos += change;
            }
        }

        if (duration < TWEEN_TIME_DEFAULT)
            duration = TWEEN_TIME_DEFAULT;
        this._tweenDuration[axis] = duration;

        return pos;
    }

    private fixDuration(axis: 'x' | 'y', oldChange: number): void {
        if (this._tweenChange[axis] === 0 || Math.abs(this._tweenChange[axis]) >= Math.abs(oldChange))
            return;

        let newDuration: number = Math.abs(this._tweenChange[axis] / oldChange) * this._tweenDuration[axis];
        if (newDuration < TWEEN_TIME_DEFAULT)
            newDuration = TWEEN_TIME_DEFAULT;

        this._tweenDuration[axis] = newDuration;
    }

    private startTween(type: number): void {
        this._tweenTime.setTo(0, 0);
        this._tweening = type;
        this.updateScrollBarVisible();
    }

    private killTween(): void {
        if (this._tweening === 1) {
            // Killing an animated move has to land on the destination at once.
            this._container.setPosition(
                this._tweenStart.x + this._tweenChange.x,
                this._tweenStart.y + this._tweenChange.y);
            this._owner.emit(EventType.SCROLL, this._owner);
        }

        this._tweening = 0;

        this.updateScrollBarVisible();

        this._owner.emit(EventType.SCROLL_END, this._owner);
    }

    private checkRefreshBar(): void {
        if (this._header === null && this._footer === null)
            return;

        const pos: number = this._refreshBarAxis === 'x' ? this._container.positionX : this._container.positionY;
        if (this._header) {
            if (pos > 0) {
                this._header.visible = true;
                let w = this._header.width;
                let h = this._header.height;
                if (this._refreshBarAxis === 'x')
                    w = pos;
                else
                    h = pos;
                this._header.setSize(w, h);
            } else {
                this._header.visible = false;
            }
        }

        if (this._footer) {
            const max: number = this._overlapSize[this._refreshBarAxis];
            if (pos < -max || max === 0 && this._footerLockedSize > 0) {
                this._footer.visible = true;

                let px = this._footer.x;
                let py = this._footer.y;
                if (max > 0) {
                    if (this._refreshBarAxis === 'x')
                        px = pos + this._contentSize.x;
                    else
                        py = pos + this._contentSize.y;
                } else {
                    const v = Math.max(Math.min(pos + this._viewSize[this._refreshBarAxis], this._viewSize[this._refreshBarAxis] - this._footerLockedSize),
                        this._viewSize[this._refreshBarAxis] - this._contentSize[this._refreshBarAxis]);
                    if (this._refreshBarAxis === 'x')
                        px = v;
                    else
                        py = v;
                }
                this._footer.setPosition(px, py);

                let fw = this._footer.width;
                let fh = this._footer.height;
                if (max > 0) {
                    if (this._refreshBarAxis === 'x')
                        fw = -max - pos;
                    else
                        fh = -max - pos;
                } else {
                    const v = this._viewSize[this._refreshBarAxis] - (this._refreshBarAxis === 'x' ? this._footer.width : this._footer.height);
                    if (this._refreshBarAxis === 'x')
                        fw = v;
                    else
                        fh = v;
                }
                this._footer.setSize(fw, fh);
            } else {
                this._footer.visible = false;
            }
        }
    }

    /**
     * Advances the momentum animation.
     *
     * @param dt elapsed seconds. The reference read the frame delta off the
     *   engine; here it is explicit, which is what makes the decay exactly
     *   reproducible.
     */
    public update(dt: number): void {
        this._clock += dt;

        if (this._tweening === 0)
            return;

        const nx: number = this.runTween('x', dt);
        const ny: number = this.runTween('y', dt);

        this._container.setPosition(nx, ny);

        if (this._tweening === 2) {
            if (this._overlapSize.x > 0)
                this._xPos = ToolSet.clamp(-nx, 0, this._overlapSize.x);
            if (this._overlapSize.y > 0)
                this._yPos = ToolSet.clamp(-ny, 0, this._overlapSize.y);

            if (this._pageMode)
                this.updatePageController();
        }

        if (this._tweenChange.x === 0 && this._tweenChange.y === 0) {
            this._tweening = 0;

            this.loopCheckingCurrent();

            this.updateScrollBarPos();
            this.updateScrollBarVisible();

            this._owner.emit(EventType.SCROLL, this._owner);
            this._owner.emit(EventType.SCROLL_END, this._owner);
        } else {
            this.updateScrollBarPos();
            this._owner.emit(EventType.SCROLL, this._owner);
        }
    }

    private runTween(axis: 'x' | 'y', dt: number): number {
        let newValue: number;
        if (this._tweenChange[axis] !== 0) {
            this._tweenTime[axis] += dt;
            if (this._tweenTime[axis] >= this._tweenDuration[axis]) {
                newValue = this._tweenStart[axis] + this._tweenChange[axis];
                this._tweenChange[axis] = 0;
            } else {
                const ratio: number = easeFunc(this._tweenTime[axis], this._tweenDuration[axis]);
                newValue = this._tweenStart[axis] + Math.floor(this._tweenChange[axis] * ratio);
            }

            let threshold1 = 0;
            let threshold2: number = -this._overlapSize[axis];
            if (this._headerLockedSize > 0 && this._refreshBarAxis === axis)
                threshold1 = this._headerLockedSize;
            if (this._footerLockedSize > 0 && this._refreshBarAxis === axis) {
                let max: number = this._overlapSize[this._refreshBarAxis];
                if (max === 0)
                    max = Math.max(this._contentSize[this._refreshBarAxis] + this._footerLockedSize - this._viewSize[this._refreshBarAxis], 0);
                else
                    max += this._footerLockedSize;
                threshold2 = -max;
            }

            if (this._tweening === 2 && this._bouncebackEffect) {
                if (newValue > 20 + threshold1 && this._tweenChange[axis] > 0
                    || newValue > threshold1 && this._tweenChange[axis] === 0) {
                    // Start bouncing back.
                    this._tweenTime[axis] = 0;
                    this._tweenDuration[axis] = TWEEN_TIME_DEFAULT;
                    this._tweenChange[axis] = -newValue + threshold1;
                    this._tweenStart[axis] = newValue;
                } else if (newValue < threshold2 - 20 && this._tweenChange[axis] < 0
                    || newValue < threshold2 && this._tweenChange[axis] === 0) {
                    // Start bouncing back.
                    this._tweenTime[axis] = 0;
                    this._tweenDuration[axis] = TWEEN_TIME_DEFAULT;
                    this._tweenChange[axis] = threshold2 - newValue;
                    this._tweenStart[axis] = newValue;
                }
            } else {
                if (newValue > threshold1) {
                    newValue = threshold1;
                    this._tweenChange[axis] = 0;
                } else if (newValue < threshold2) {
                    newValue = threshold2;
                    this._tweenChange[axis] = 0;
                }
            }
        } else {
            newValue = axis === 'x' ? this._container.positionX : this._container.positionY;
        }

        return newValue;
    }
}

/** Vertical gestures seen this drag; bit 1 vertical, bit 2 horizontal. */
let _gestureFlag = 0;

const TWEEN_TIME_GO = 0.5; // animation time for an animated SetPos
const TWEEN_TIME_DEFAULT = 0.3; // minimum momentum animation time
const PULL_RATIO = 0.5; // how far past the end an over-pull may reach, as a fraction of the view

const s_vec2 = new Point();
const s_rect = new Rect();
const sEndPos = new Point();
const sOldChange = new Point();

function easeFunc(t: number, d: number): number {
    return (t = t / d - 1) * t * t + 1; // cubicOut
}
