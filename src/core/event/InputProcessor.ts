import { Event, EventType } from './Event.js';
import { Point } from '../utils/Geometry.js';

import type { GObject } from '../GObject.js';
import type { GComponent } from '../GComponent.js';

/** Per-pointer state. One entry per active touch, plus one for the mouse. */
class TouchInfo {
    public target: GObject | null = null;
    public pos = new Point();
    /** UI-root-space position where the press started. */
    public downPos = new Point();
    public touchId = 0;
    public clickCount = 0;
    public mouseWheelDelta = 0;
    public button = -1;
    public began = false;
    public clickCancelled = false;
    public lastClickTime = 0;
    public lastRollOver: GObject | null = null;
    public downTargets: GObject[] = [];
    /** Objects that asked to keep receiving this pointer's moves. */
    public touchMonitors: GObject[] = [];
}

/** Seconds between presses that still counts as a double click. */
const DOUBLE_CLICK_THRESHOLD = 0.45;
/** Pointer travel, in pixels, past which a press stops counting as a click. */
const CLICK_SLOP = 50;

/**
 * Turns raw pointer input into FairyGUI events.
 *
 * The host feeds this **UI-root coordinates** — origin at the UI's top-left,
 * y increasing downwards. Screen space already has that orientation, so a
 * backend that draws the UI as a full-screen overlay can pass pointer positions
 * through unchanged; a world-space UI would project them first.
 *
 * The reference took its clock from `ToolSet.getTime()`, which returned
 * `Date.getMilliseconds() / 1000` — the sub-second component only, so it wrapped
 * every second and made double-click detection unreliable. This uses an
 * injectable seconds clock instead, which also lets tests control it.
 */
export class InputProcessor {
    private _owner: GComponent;
    private _touches: TouchInfo[] = [];
    private _rollOutChain: GObject[] = [];
    private _rollOverChain: GObject[] = [];

    /** Invoked at the start of every press, before dispatch. `GRoot` uses it. */
    public onTouchBeginHook: ((evt: Event) => void) | null = null;

    /** Seconds clock. Replace in tests to make double-click timing deterministic. */
    public clock: () => number = () => Date.now() / 1000;

    /** Mirrors the reference's `cc.sys.isMobile`; changes roll-out behaviour. */
    public isMobile = false;

    public constructor(owner: GComponent) {
        this._owner = owner;
    }

    public get owner(): GComponent {
        return this._owner;
    }

    public getAllTouches(touchIds?: number[]): number[] {
        const out = touchIds ?? [];
        for (const ti of this._touches) {
            if (ti.touchId !== -1)
                out.push(ti.touchId);
        }
        return out;
    }

    public getTouchPosition(touchId = -1, result?: Point): Point {
        for (const ti of this._touches) {
            if (ti.touchId !== -1 && (touchId === -1 || ti.touchId === touchId))
                return result ? result.copy(ti.pos) : ti.pos.clone();
        }
        return result ? result.setTo(0, 0) : new Point();
    }

    /**
     * Id of the pointer that is currently pressed, or `null` when none is.
     *
     * Not the same as the first entry of `getAllTouches()`: a plain hover parks
     * a slot of its own, so a host that reports a hover and a press under
     * different ids leaves the hovering slot first in the list.
     */
    public getPressedTouchId(): number | null {
        for (const ti of this._touches) {
            if (ti.touchId !== -1 && ti.began)
                return ti.touchId;
        }
        return null;
    }

    /**
     * Object under the pointer.
     *
     * @param touchId the pointer to look up. Omit it to use the first live
     *   pointer, which a hovering one can be — a caller that means the pointer
     *   in play has to name it.
     */
    public getTouchTarget(touchId = -1): GObject | null {
        for (const ti of this._touches) {
            if (ti.touchId !== -1 && (touchId === -1 || ti.touchId === touchId))
                return ti.target;
        }
        return null;
    }

    public addTouchMonitor(touchId: number, target: GObject): void {
        const ti = this.getInfo(touchId, false);
        if (!ti)
            return;
        if (ti.touchMonitors.indexOf(target) === -1)
            ti.touchMonitors.push(target);
    }

    public removeTouchMonitor(target: GObject): void {
        for (const ti of this._touches) {
            const index = ti.touchMonitors.indexOf(target);
            if (index !== -1)
                ti.touchMonitors.splice(index, 1);
        }
    }

    public cancelClick(touchId: number): void {
        const ti = this.getInfo(touchId, false);
        if (ti)
            ti.clickCancelled = true;
    }

    /** Synthesises a press/release/click on `target` without real input. */
    public simulateClick(target: GObject): void {
        const evt = Event.borrow(EventType.TOUCH_BEGIN, true);
        evt.initiator = target;
        target.localToGlobal(0, 0, evt.pos);
        evt.touchId = 0;
        evt.clickCount = 1;
        evt.button = 0;
        evt._captureRef = this;

        this.onTouchBeginHook?.(evt);
        target.dispatchEvent(evt);

        evt.type = EventType.TOUCH_END;
        target.dispatchEvent(evt);

        evt.type = EventType.CLICK;
        target.dispatchEvent(evt);

        Event.release(evt);
    }

    // ---- entry points the host calls -------------------------------------

    public touchBegin(touchId: number, x: number, y: number, button = 0): void {
        const ti = this.updateInfo(touchId, x, y);
        ti.button = button;
        this.setBegin(ti);

        const evt = this.getEvent(ti, ti.target!, EventType.TOUCH_BEGIN, true);
        this.onTouchBeginHook?.(evt);
        ti.target!.dispatchEvent(evt);
        Event.release(evt);

        this.handleRollOver(ti, ti.target);
    }

    public touchMove(touchId: number, x: number, y: number): void {
        const ti = this.updateInfo(touchId, x, y);
        this.handleRollOver(ti, ti.target);

        if (!ti.began)
            return;

        const evt = this.getEvent(ti, ti.target!, EventType.TOUCH_MOVE, false);
        let done = false;

        for (const mm of ti.touchMonitors) {
            if (!mm.onStage)
                continue;

            evt.type = EventType.TOUCH_MOVE;
            evt.initiator = mm;
            mm.dispatchEvent(evt);
            if (mm === this._owner)
                done = true;
        }

        if (!done && this._owner.onStage) {
            evt.type = EventType.TOUCH_MOVE;
            evt.initiator = this._owner;
            this._owner.dispatchEvent(evt);
        }

        Event.release(evt);
    }

    public touchEnd(touchId: number, x: number, y: number): void {
        const ti = this.updateInfo(touchId, x, y);
        this.setEnd(ti);

        const evt = this.getEvent(ti, ti.target!, EventType.TOUCH_END, false);

        // Monitors other than the target itself hear about the release, which
        // is how a slider that captured the pointer learns the drag is over.
        for (const mm of ti.touchMonitors) {
            if (mm === ti.target || !mm.onStage || isAncestor(mm, ti.target))
                continue;

            evt.type = EventType.TOUCH_END;
            evt.initiator = mm;
            mm.dispatchEvent(evt);
        }
        ti.touchMonitors.length = 0;

        if (ti.target && !ti.target.disposed) {
            evt.type = EventType.TOUCH_END;
            evt.bubbles = true;
            evt.initiator = ti.target;
            ti.target.dispatchEvent(evt);
        }

        const clickTarget = this.clickTest(ti);
        if (clickTarget) {
            evt.type = EventType.CLICK;
            evt.bubbles = true;
            evt.initiator = clickTarget;
            clickTarget.dispatchEvent(evt);
        }

        Event.release(evt);

        // On touch platforms the pointer effectively leaves on release, so
        // there is no lingering hover state to keep.
        this.handleRollOver(ti, this.isMobile ? null : ti.target);

        ti.target = null;
        ti.touchId = -1;
        ti.button = -1;
    }

    /** Pointer cancelled by the system, or the window lost focus. */
    public touchCancel(touchId: number, x: number, y: number): void {
        const ti = this.updateInfo(touchId, x, y);
        const evt = this.getEvent(ti, ti.target!, EventType.TOUCH_END, false);

        for (const mm of ti.touchMonitors) {
            if (mm === ti.target || !mm.onStage || isAncestor(mm, ti.target))
                continue;

            evt.initiator = mm;
            mm.dispatchEvent(evt);
        }
        ti.touchMonitors.length = 0;

        if (ti.target && !ti.target.disposed) {
            evt.bubbles = true;
            ti.target.dispatchEvent(evt);
        }

        Event.release(evt);

        this.handleRollOver(ti, null);

        ti.target = null;
        ti.touchId = -1;
        ti.button = -1;
    }

    public mouseWheel(delta: number, x: number, y: number): void {
        const ti = this.updateInfo(0, x, y);
        ti.mouseWheelDelta = delta;

        const target = ti.target ?? this._owner;
        const evt = this.getEvent(ti, target, EventType.MOUSE_WHEEL, true);
        target.dispatchEvent(evt);
        Event.release(evt);
    }

    /** Pointer moved without a button held — drives roll-over/roll-out. */
    public mouseMove(x: number, y: number): void {
        const existing = this.getInfo(0, false);
        if (existing
            && Math.abs(existing.pos.x - x) < 1
            && Math.abs(existing.pos.y - y) < 1)
            return;

        const ti = this.updateInfo(0, x, y);
        this.handleRollOver(ti, ti.target);
    }

    // ---- internals -------------------------------------------------------

    private updateInfo(touchId: number, x: number, y: number): TouchInfo {
        const target = this._owner.hitTest(new Point(x, y)) ?? this._owner;

        const ti = this.obtainInfo(touchId);
        ti.target = target;
        ti.pos.setTo(x, y);
        return ti;
    }

    /**
     * Finds the slot for `touchId`, taking a released one or appending.
     *
     * Split from `getInfo` so the hot path returns a non-nullable `TouchInfo`
     * without an assertion — a slot is always available here.
     */
    private obtainInfo(touchId: number): TouchInfo {
        let spare: TouchInfo | null = null;
        for (const ti of this._touches) {
            if (ti.touchId === touchId)
                return ti;
            if (ti.touchId === -1)
                spare = ti;
        }

        if (!spare) {
            spare = new TouchInfo();
            this._touches.push(spare);
        }
        spare.touchId = touchId;
        return spare;
    }

    /**
     * Finds the slot for `touchId`, or `null`.
     *
     * A released slot is taken before a new one is appended, which is the
     * reference's recycling and keeps the array from growing without bound
     * across a session's touches.
     */
    private getInfo(touchId: number, createIfNotExists = true): TouchInfo | null {
        let spare: TouchInfo | null = null;
        for (const ti of this._touches) {
            if (ti.touchId === touchId)
                return ti;
            if (ti.touchId === -1)
                spare = ti;
        }

        if (!spare) {
            if (!createIfNotExists)
                return null;
            spare = new TouchInfo();
            this._touches.push(spare);
        }
        spare.touchId = touchId;
        return spare;
    }

    private setBegin(ti: TouchInfo): void {
        ti.began = true;
        ti.clickCancelled = false;
        ti.downPos.setTo(ti.pos.x, ti.pos.y);

        // The chain of ancestors under the press is what a click may fall back
        // to if the pressed object disappears before release.
        ti.downTargets.length = 0;
        let obj: GObject | null = ti.target;
        while (obj) {
            ti.downTargets.push(obj);
            obj = obj.findParent();
        }
    }

    private setEnd(ti: TouchInfo): void {
        ti.began = false;

        const now = this.clock();
        const elapsed = now - ti.lastClickTime;

        if (elapsed < DOUBLE_CLICK_THRESHOLD) {
            // Cap at two so a triple click does not look like a triple.
            ti.clickCount = ti.clickCount === 2 ? 1 : ti.clickCount + 1;
        } else {
            ti.clickCount = 1;
        }
        ti.lastClickTime = now;
    }

    private clickTest(ti: TouchInfo): GObject | null {
        if (ti.downTargets.length === 0
            || ti.clickCancelled
            || Math.abs(ti.pos.x - ti.downPos.x) > CLICK_SLOP
            || Math.abs(ti.pos.y - ti.downPos.y) > CLICK_SLOP)
            return null;

        const first = ti.downTargets[0];
        if (first && !first.disposed && first.onStage)
            return first;

        // The pressed object is gone; fall back to the nearest ancestor still
        // standing that was also under the press.
        let obj: GObject | null = ti.target;
        while (obj) {
            if (ti.downTargets.indexOf(obj) !== -1 && !obj.disposed && obj.onStage)
                return obj;
            obj = obj.findParent();
        }

        return null;
    }

    private handleRollOver(ti: TouchInfo, target: GObject | null): void {
        if (ti.lastRollOver === target)
            return;

        // Walk both chains from their common ancestor; everything below is
        // leaving, everything above is entering.
        let element: GObject | null = ti.lastRollOver;
        while (element && !element.disposed) {
            this._rollOutChain.push(element);
            element = element.findParent();
        }

        element = target;
        while (element && !element.disposed) {
            const i = this._rollOutChain.indexOf(element);
            if (i !== -1) {
                this._rollOutChain.length = i;
                break;
            }
            this._rollOverChain.push(element);
            element = element.findParent();
        }

        ti.lastRollOver = target;

        for (const e of this._rollOutChain) {
            if (!e.disposed && e.onStage) {
                const evt = this.getEvent(ti, e, EventType.ROLL_OUT, false);
                e.dispatchEvent(evt);
                Event.release(evt);
            }
        }

        for (const e of this._rollOverChain) {
            if (!e.disposed && e.onStage) {
                const evt = this.getEvent(ti, e, EventType.ROLL_OVER, false);
                e.dispatchEvent(evt);
                Event.release(evt);
            }
        }

        this._rollOutChain.length = 0;
        this._rollOverChain.length = 0;
    }

    private getEvent(ti: TouchInfo, target: GObject, type: string, bubbles: boolean): Event {
        const evt = Event.borrow(type, bubbles);
        evt.initiator = target;
        evt.pos.setTo(ti.pos.x, ti.pos.y);
        evt.touchId = ti.touchId;
        evt.clickCount = ti.clickCount;
        evt.button = ti.button;
        evt.mouseWheelDelta = ti.mouseWheelDelta;
        evt._captureRef = this;
        return evt;
    }
}

/** Duck-typed ancestor check, so this module need not import `GComponent`. */
function isAncestor(candidate: GObject, target: GObject | null): boolean {
    const com = candidate as unknown as GComponent;
    return typeof com.isAncestorOf === 'function' && com.isAncestorOf(target);
}
