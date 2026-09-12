import { Point } from '../utils/Geometry.js';

/** Event type constants. The string values are part of the public API. */
export const EventType = {
    TOUCH_BEGIN: 'fui_touch_begin',
    TOUCH_MOVE: 'fui_touch_move',
    TOUCH_END: 'fui_touch_end',
    CLICK: 'fui_click',
    ROLL_OVER: 'fui_roll_over',
    ROLL_OUT: 'fui_roll_out',
    MOUSE_WHEEL: 'fui_mouse_wheel',
    RIGHT_CLICK: 'fui_right_click',
    MIDDLE_CLICK: 'fui_middle_click',

    DISPLAY: 'fui_display',
    UNDISPLAY: 'fui_undisplay',
    GEAR_STOP: 'fui_gear_stop',
    LINK: 'fui_text_link',
    SUBMIT: 'fui_submit',
    TEXT_CHANGE: 'fui_text_change',

    STATUS_CHANGED: 'fui_status_changed',
    XY_CHANGED: 'fui_xy_changed',
    SIZE_CHANGED: 'fui_size_changed',
    SIZE_DELAY_CHANGE: 'fui_size_delay_change',

    DRAG_START: 'fui_drag_start',
    DRAG_MOVE: 'fui_drag_move',
    DRAG_END: 'fui_drag_end',
    DROP: 'fui_drop',

    SCROLL: 'fui_scroll',
    SCROLL_END: 'fui_scroll_end',
    PULL_DOWN_RELEASE: 'fui_pull_down_release',
    PULL_UP_RELEASE: 'fui_pull_up_release',

    CLICK_ITEM: 'fui_click_item',
    CLICK_MENU_ITEM: 'fui_click_menu_item',
    POSITION_CHANGE: 'fui_position_change',
    KEY_DOWN: 'fui_key_down',
    KEY_UP: 'fui_key_up',
    FOCUS_IN: 'fui_focus_in',
    FOCUS_OUT: 'fui_focus_out',
} as const;

export type EventTypeName = typeof EventType[keyof typeof EventType];

/**
 * The event object handed to listeners.
 *
 * `bubbles` is honoured only by `EventDispatcher.dispatchEvent`; `emit` never
 * walks the parent chain, which mirrors the reference's split between
 * `cc.Node.emit` and `dispatchEvent`.
 */
export class Event {
    public type: string;
    public bubbles: boolean;

    /** The object the event was dispatched to. */
    public target: unknown = null;
    /** The object whose listener is currently running, while bubbling. */
    public currentTarget: unknown = null;
    /** Set by the widget that originated the event, when that differs from `target`. */
    public initiator: unknown = null;

    /** Pointer position in UI-root coordinates. */
    public pos: Point = new Point();
    public touchId = 0;
    public clickCount = 0;
    /** 0 left, 1 right, 2 middle. */
    public button = 0;
    /** Bitmask of held modifier keys, as reported by the input layer. */
    public keyModifiers = 0;
    public mouseWheelDelta = 0;
    /** For `SUBMIT` and `TEXT_CHANGE` from a `GTextInput`. */
    public keyCode = 0;

    /** Whatever the originating code wanted to pass along — e.g. a `GListItem`. */
    public data: unknown = null;

    private _stopped = false;
    private _defaultPrevented = false;
    /**
     * The input layer, so `captureTouch` can register a monitor. Kept as a
     * structural type rather than an `InputProcessor` reference, which would
     * make this module depend on the input stack.
     */
    public _captureRef: { addTouchMonitor(touchId: number, target: unknown): void } | null = null;

    public constructor(type: string, bubbles = false) {
        this.type = type;
        this.bubbles = bubbles;
    }

    public stopPropagation(): void {
        this._stopped = true;
    }

    public preventDefault(): void {
        this._defaultPrevented = true;
    }

    /** @internal Read and reset in one go by the dispatcher. */
    public get _propagationStopped(): boolean {
        return this._stopped;
    }

    public get defaultPrevented(): boolean {
        return this._defaultPrevented;
    }

    public get isShiftDown(): boolean {
        return (this.keyModifiers & 1) !== 0;
    }

    public get isCtrlDown(): boolean {
        return (this.keyModifiers & 2) !== 0;
    }

    public get isAltDown(): boolean {
        return (this.keyModifiers & 4) !== 0;
    }

    /**
     * Asks the input layer to keep sending this touch to `currentTarget`, even
     * once the pointer leaves it — how a slider keeps a drag it started.
     */
    public captureTouch(): void {
        if (this._captureRef && this.currentTarget)
            this._captureRef.addTouchMonitor(this.touchId, this.currentTarget);
    }

    /** Restores the event to a clean state so it can be pooled. */
    public reset(): void {
        this.target = null;
        this.currentTarget = null;
        this.initiator = null;
        this.data = null;
        this._stopped = false;
        this._defaultPrevented = false;
        this.clickCount = 0;
        this.mouseWheelDelta = 0;
        this.keyCode = 0;
        this.pos.setTo(0, 0);
    }

    /** @internal */
    public static pool: Event[] = [];

    /** Takes an event from the pool, or makes one. */
    public static borrow(type: string, bubbles = false): Event {
        const evt = Event.pool.pop() ?? new Event(type, bubbles);
        evt.type = type;
        evt.bubbles = bubbles;
        return evt;
    }

    /** Returns an event to the pool. */
    public static release(evt: Event): void {
        evt.reset();
        // Keep the pool bounded; a burst of events should not pin memory.
        if (Event.pool.length < 32)
            Event.pool.push(evt);
    }
}
