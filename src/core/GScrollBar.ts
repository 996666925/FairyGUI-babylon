import { GComponent } from './GComponent.js';
import { Point } from './utils/Geometry.js';
import { EventType } from './event/Event.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { Event } from './event/Event.js';
import type { GObject } from './GObject.js';
import type { ScrollPane } from './ScrollPane.js';

/** Scratch for pointer-to-local conversions, so dragging allocates nothing. */
const sVec2 = new Point();

/**
 * The bar `ScrollPane` drives.
 *
 * Published as a component with a `bar` track, a `grip` handle and optional
 * `arrow1`/`arrow2` buttons. It is purely a view: every interaction forwards to
 * the `ScrollPane` it was bound to with `setScrollPane`, which owns the
 * position.
 */
export class GScrollBar extends GComponent {
    private _grip: GObject | null = null;
    private _arrowButton1: GObject | null = null;
    private _arrowButton2: GObject | null = null;
    private _bar: GObject | null = null;
    private _target: ScrollPane | null = null;

    private _vertical = false;
    private _scrollPerc = 0;
    private _fixedGripSize = false;

    private _dragOffset = new Point();
    private _gripDragging = false;

    /** Binds this bar to the pane it drives. Set once, by the pane. */
    public setScrollPane(target: ScrollPane, vertical: boolean): void {
        this._target = target;
        this._vertical = vertical;
    }

    /**
     * Sizes and places the grip for a visible fraction.
     *
     * `value` is how much of the content is on screen; a bar showing everything
     * (or nothing) hides its grip, since there is nowhere to move it.
     */
    public setDisplayPerc(value: number): void {
        if (!this._grip || !this._bar)
            return;

        if (this._vertical) {
            if (!this._fixedGripSize)
                this._grip.height = Math.floor(value * this._bar.height);
            this._grip.y = this._bar.y + (this._bar.height - this._grip.height) * this._scrollPerc;
        } else {
            if (!this._fixedGripSize)
                this._grip.width = Math.floor(value * this._bar.width);
            this._grip.x = this._bar.x + (this._bar.width - this._grip.width) * this._scrollPerc;
        }
        this._grip.visible = value !== 0 && value !== 1;
    }

    public setScrollPerc(val: number): void {
        this._scrollPerc = val;
        if (!this._grip || !this._bar)
            return;

        if (this._vertical)
            this._grip.y = this._bar.y + (this._bar.height - this._grip.height) * this._scrollPerc;
        else
            this._grip.x = this._bar.x + (this._bar.width - this._grip.width) * this._scrollPerc;
    }

    /** Space the arrow buttons take, which the grip may never intrude on. */
    public get minSize(): number {
        if (this._vertical)
            return (this._arrowButton1 ? this._arrowButton1.height : 0) + (this._arrowButton2 ? this._arrowButton2.height : 0);
        return (this._arrowButton1 ? this._arrowButton1.width : 0) + (this._arrowButton2 ? this._arrowButton2.width : 0);
    }

    public get gripDragging(): boolean {
        return this._gripDragging;
    }

    protected constructExtension(buffer: ByteBuffer): void {
        buffer.seek(0, 6);

        this._fixedGripSize = buffer.readBool();

        this._grip = this.getChild('grip');
        if (!this._grip) {
            console.error('fairygui: a scroll bar needs a child named "grip"');
            return;
        }

        this._bar = this.getChild('bar');
        if (!this._bar) {
            console.error('fairygui: a scroll bar needs a child named "bar"');
            return;
        }

        this._arrowButton1 = this.getChild('arrow1');
        this._arrowButton2 = this.getChild('arrow2');

        this._grip.on(EventType.TOUCH_BEGIN, this.onGripTouchDown, this);
        this._grip.on(EventType.TOUCH_MOVE, this.onGripTouchMove, this);
        this._grip.on(EventType.TOUCH_END, this.onGripTouchEnd, this);

        if (this._arrowButton1)
            this._arrowButton1.on(EventType.TOUCH_BEGIN, this.onClickArrow1, this);
        if (this._arrowButton2)
            this._arrowButton2.on(EventType.TOUCH_BEGIN, this.onClickArrow2, this);

        this.on(EventType.TOUCH_BEGIN, this.onBarTouchBegin, this);
    }

    private onGripTouchDown(evt: Event): void {
        evt.stopPropagation();
        evt.captureTouch();

        this._gripDragging = true;
        this._target?.updateScrollBarVisible();

        this.globalToLocal(evt.pos.x, evt.pos.y, this._dragOffset);
        this._dragOffset.x -= this._grip!.x;
        this._dragOffset.y -= this._grip!.y;
    }

    private onGripTouchMove(evt: Event): void {
        if (!this.onStage)
            return;

        const pt = this.globalToLocal(evt.pos.x, evt.pos.y, sVec2);
        if (this._vertical) {
            const curY = pt.y - this._dragOffset.y;
            this._target?.setPercY((curY - this._bar!.y) / (this._bar!.height - this._grip!.height), false);
        } else {
            const curX = pt.x - this._dragOffset.x;
            this._target?.setPercX((curX - this._bar!.x) / (this._bar!.width - this._grip!.width), false);
        }
    }

    private onGripTouchEnd(): void {
        if (!this.onStage)
            return;

        this._gripDragging = false;
        this._target?.updateScrollBarVisible();
    }

    private onClickArrow1(evt: Event): void {
        evt.stopPropagation();

        if (this._vertical)
            this._target?.scrollUp();
        else
            this._target?.scrollLeft();
    }

    private onClickArrow2(evt: Event): void {
        evt.stopPropagation();

        if (this._vertical)
            this._target?.scrollDown();
        else
            this._target?.scrollRight();
    }

    private onBarTouchBegin(evt: Event): void {
        const pt = this._grip!.globalToLocal(evt.pos.x, evt.pos.y, sVec2);
        if (this._vertical) {
            if (pt.y < 0)
                this._target?.scrollUp(4);
            else
                this._target?.scrollDown(4);
        } else {
            if (pt.x < 0)
                this._target?.scrollLeft(4);
            else
                this._target?.scrollRight(4);
        }
    }
}
