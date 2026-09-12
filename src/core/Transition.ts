import { Color } from './utils/Color.js';
import { EaseType } from './tween/EaseType.js';
import { GPath } from './tween/GPath.js';
import { CurveType, GPathPoint } from './tween/GPathPoint.js';
import { GTween } from './tween/GTween.js';
import { UIPackage } from './UIPackage.js';
import { ObjectPropID } from './FieldTypes.js';
import { getStage } from './Stage.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { GComponent } from './GComponent.js';
import type { GObject } from './GObject.js';
import type { GTweener } from './tween/GTweener.js';

const OPTION_IGNORE_DISPLAY_CONTROLLER = 1;
const OPTION_AUTO_STOP_DISABLED = 2;
const OPTION_AUTO_STOP_AT_END = 4;

/** What one transition item does to its target. */
export enum ActionType {
    XY = 0,
    Size = 1,
    Scale = 2,
    Pivot = 3,
    Alpha = 4,
    Rotation = 5,
    Color = 6,
    Animation = 7,
    Visible = 8,
    Sound = 9,
    Transition = 10,
    Shake = 11,
    ColorFilter = 12,
    Skew = 13,
    Text = 14,
    Icon = 15,
    Unknown = 16,
}

/**
 * One item's payload.
 *
 * Deliberately a bag rather than a class hierarchy: the reference stored
 * whatever an action needed in a `{}` literal and read it back by name, and the
 * editor's format decides which fields an item carries. The numeric and boolean
 * fields are declared non-optional with defaults rather than being left
 * undefined, so the arithmetic below reads the same values the reference did —
 * the reference's implicit "absent means 0/false" is just spelled out.
 *
 * Two defaults are load-bearing and must stay as they are: `frame` is `-1`
 * because `skipAnimations` tests `!= -1` for "no frame given", and `stopTime`
 * is `-1` because `applyValue` tests `>= 0` for "clip a nested transition here".
 */
interface TValue {
    visible: boolean;

    frame: number;
    playing: boolean;
    flag: boolean;

    sound: string | null;
    volume: number;
    audioClip: unknown;

    transName: string | null;
    playTimes: number;
    trans: Transition | null;
    stopTime: number;

    amplitude: number;
    duration: number;
    offsetX: number;
    offsetY: number;
    lastOffsetX: number;
    lastOffsetY: number;

    text: string | null;

    f1: number;
    f2: number;
    f3: number;
    f4: number;

    b1: boolean;
    b2: boolean;
    b3: boolean;
}

/** The reference filled a `{}` literal in field by field; this is the same bag. */
function createTValue(b1 = false, b2 = false): TValue {
    return {
        visible: false,

        frame: -1,
        playing: false,
        flag: false,

        sound: null,
        volume: 0,
        audioClip: null,

        transName: null,
        playTimes: 0,
        trans: null,
        stopTime: -1,

        amplitude: 0,
        duration: 0,
        offsetX: 0,
        offsetY: 0,
        lastOffsetX: 0,
        lastOffsetY: 0,

        text: null,

        f1: 0,
        f2: 0,
        f3: 0,
        f4: 0,

        b1,
        b2,
        b3: false,
    };
}

function toFloat(value: unknown): number {
    return parseFloat(value as string);
}

function toInt(value: unknown): number {
    return parseInt(value as string, 10);
}

/** A tweened or instant action on one target. */
class Item {
    public time = 0;
    public targetId = '';
    public type: ActionType;
    public tweenConfig: TweenConfig | null = null;
    public label: string | null = null;
    public value: TValue;
    public hook: ((label?: string) => void) | null = null;

    public tweener: GTweener | null = null;
    public target: GObject | null = null;
    public displayLockToken = 0;

    public constructor(type: ActionType) {
        this.type = type;
        this.value = createTValue();
    }
}

/**
 * The action types whose value can be interpolated.
 *
 * The reference's `playItem` built a tweener in a switch and then called
 * `setDelay` on it unconditionally, so a tweened item of any other type — the
 * editor can publish a tween on Pivot, Visible, Text and friends — threw at
 * runtime and took playback with it. Such an item now takes the instant path,
 * which is the only thing a tween on a discrete property could mean.
 */
function isTweenableType(type: ActionType): boolean {
    return type === ActionType.XY || type === ActionType.Size || type === ActionType.Scale
        || type === ActionType.Skew || type === ActionType.Alpha || type === ActionType.Rotation
        || type === ActionType.Color || type === ActionType.ColorFilter;
}

/** The tweened half of an item: from `startValue` to `endValue` over `duration`. */
class TweenConfig {
    public duration = 0;
    public easeType: number = EaseType.QuadOut;
    public repeat = 0;
    public yoyo = false;
    public startValue: TValue;
    public endValue: TValue;
    public endLabel: string | null = null;
    public endHook: ((label?: string) => void) | null = null;
    public path: GPath | null = null;

    public constructor() {
        this.startValue = createTValue(true, true);
        this.endValue = createTValue(true, true);
    }
}

/**
 * A scripted animation over a component: a timed list of items that move,
 * resize, tween or trigger things.
 *
 * ## Placement
 *
 * `GComponent` builds one per transition payload and drives playback through
 * `play`/`stop`/`changePlayTimes` — `PlayTransitionAction` is the controller
 * action that reaches them.
 *
 * ## Time
 *
 * Nothing here reads a clock. Every timed part of a transition — the items'
 * delays, their tweens, and `play`'s start delay — is a `GTween`, and
 * `TweenManager.update(dt)` (called from `GRoot.update`) advances them. The
 * only per-frame entry point is `update`, which exists so a host can tick a
 * transition uniformly with the rest of the runtime.
 *
 * ## Rollback
 *
 * Each tweened item keeps both ends of its range, so `playReverse` runs the
 * same items backwards from their end values. `_ownerBaseX/Y` are captured when
 * playback starts, letting an XY item that only names one axis stay put on the
 * other.
 */
export class Transition {
    public name = '';

    private _owner: GComponent;
    private _ownerBaseX = 0;
    private _ownerBaseY = 0;
    private _items: Item[] = [];
    private _totalTimes = 0;
    private _totalTasks = 0;
    private _playing = false;
    private _paused = false;
    private _onComplete: (() => void) | null = null;
    private _options = 0;
    private _reversed = false;
    private _totalDuration = 0;
    private _autoPlay = false;
    private _autoPlayTimes = 1;
    private _autoPlayDelay = 0;
    private _timeScale = 1;
    private _startTime = 0;
    private _endTime = 0;

    public constructor(owner: GComponent) {
        this._owner = owner;
    }

    /**
     * Plays the transition.
     *
     * @param onComplete fired when the last repetition finishes.
     * @param times repetitions; negative loops forever.
     * @param delay seconds before anything starts.
     * @param startTime seconds into the script to begin at.
     * @param endTime seconds into the script to stop at; `-1` for the end.
     */
    public play(onComplete?: (() => void) | null, times?: number, delay?: number, startTime?: number, endTime?: number): void {
        this._play(onComplete ?? null, times, delay, startTime, endTime, false);
    }

    /** Plays the transition backwards, from its end values to its start values. */
    public playReverse(onComplete?: (() => void) | null, times?: number, delay?: number): void {
        this._play(onComplete ?? null, times, delay, 0, -1, true);
    }

    /** Replaces the repetition count of a transition that is already running. */
    public changePlayTimes(value: number): void {
        this._totalTimes = value;
    }

    public setAutoPlay(value: boolean, times = -1, delay = 0): void {
        if (this._autoPlay !== value) {
            this._autoPlay = value;
            this._autoPlayTimes = times;
            this._autoPlayDelay = delay;

            if (this._autoPlay) {
                if (this._owner.onStage)
                    this.play(null, this._autoPlayTimes, this._autoPlayDelay);
            } else {
                // The reference stops an auto-play transition on the way *out*
                // of the stage, which is why the test is inverted here.
                if (!this._owner.onStage)
                    this.stop(false, true);
            }
        }
    }

    private _play(onComplete: (() => void) | null, times = 1, delay = 0,
        startTime = 0, endTime = -1, reversed = false): void {

        this.stop(true, true);

        this._totalTimes = times;
        this._reversed = reversed;
        this._startTime = startTime;
        this._endTime = endTime;
        this._playing = true;
        this._paused = false;
        this._onComplete = onComplete;

        const cnt: number = this._items.length;
        for (let i = 0; i < cnt; i++) {
            const item: Item = this._items[i];
            if (item.target === null) {
                if (item.targetId)
                    item.target = this._owner.getChildById(item.targetId);
                else
                    item.target = this._owner;
            } else if (item.target !== this._owner && item.target.parent !== this._owner) {
                item.target = null;
            }

            if (item.target && item.type === ActionType.Transition) {
                let trans: Transition | null = (item.target as GComponent).getTransition(item.value.transName as string);
                if (trans === this)
                    trans = null;
                if (trans) {
                    if (item.value.playTimes === 0) {
                        // An item that stops a nested transition instead of
                        // starting it: find the item that started it and record
                        // how long it should run for.
                        let j: number;
                        for (j = i - 1; j >= 0; j--) {
                            const item2: Item = this._items[j];
                            if (item2.type === ActionType.Transition) {
                                if (item2.value.trans === trans) {
                                    item2.value.stopTime = item.time - item2.time;
                                    break;
                                }
                            }
                        }
                        if (j < 0)
                            item.value.stopTime = 0;
                        else
                            trans = null; // the stop is handled by the item above
                    } else {
                        item.value.stopTime = -1;
                    }
                }
                item.value.trans = trans;
            }
        }

        if (delay === 0)
            this.onDelayedPlay();
        else
            GTween.delayedCall(delay).setTarget(this).onComplete(this.onDelayedPlay, this);
    }

    /**
     * Stops playback.
     *
     * @param setToComplete jump every item to its final value rather than
     *   freezing it where it stands.
     * @param processCallback fire the completion callback that was passed to
     *   `play`.
     */
    public stop(setToComplete = true, processCallback = false): void {
        if (!this._playing)
            return;

        this._playing = false;
        this._totalTasks = 0;
        this._totalTimes = 0;
        const func = this._onComplete;
        this._onComplete = null;

        GTween.kill(this); // the start delay, if one is pending

        const cnt: number = this._items.length;
        if (this._reversed) {
            for (let i = cnt - 1; i >= 0; i--) {
                const item: Item = this._items[i];
                if (item.target === null)
                    continue;

                this.stopItem(item, setToComplete);
            }
        } else {
            for (let i = 0; i < cnt; i++) {
                const item: Item = this._items[i];
                if (item.target === null)
                    continue;

                this.stopItem(item, setToComplete);
            }
        }

        if (processCallback && func !== null)
            func();
    }

    private stopItem(item: Item, setToComplete: boolean): void {
        if (item.displayLockToken !== 0) {
            item.target!.releaseDisplayLock(item.displayLockToken);
            item.displayLockToken = 0;
        }

        if (item.tweener) {
            item.tweener.kill(setToComplete);
            item.tweener = null;

            if (item.type === ActionType.Shake && !setToComplete) {
                // A shake has to return to its origin, or the next one starts
                // from further and further away.
                item.target!._gearLocked = true;
                item.target!.setPosition(item.target!.x - item.value.lastOffsetX, item.target!.y - item.value.lastOffsetY);
                item.target!._gearLocked = false;
            }
        }

        if (item.type === ActionType.Transition) {
            const trans: Transition | null = item.value.trans;
            if (trans)
                trans.stop(setToComplete, false);
        }
    }

    public setPaused(paused: boolean): void {
        if (!this._playing || this._paused === paused)
            return;

        this._paused = paused;
        const tweener: GTweener | null = GTween.getTween(this);
        if (tweener)
            tweener.setPaused(paused);

        const cnt: number = this._items.length;
        for (let i = 0; i < cnt; i++) {
            const item: Item = this._items[i];
            if (item.target === null)
                continue;

            if (item.type === ActionType.Transition) {
                if (item.value.trans)
                    item.value.trans.setPaused(paused);
            } else if (item.type === ActionType.Animation) {
                if (paused) {
                    item.value.flag = item.target.getProp(ObjectPropID.Playing) as boolean;
                    item.target.setProp(ObjectPropID.Playing, false);
                } else {
                    item.target.setProp(ObjectPropID.Playing, item.value.flag);
                }
            }

            if (item.tweener)
                item.tweener.setPaused(paused);
        }
    }

    public dispose(): void {
        if (this._playing)
            GTween.kill(this); // the start delay, if one is pending

        const cnt: number = this._items.length;
        for (let i = 0; i < cnt; i++) {
            const item: Item = this._items[i];
            if (item.tweener) {
                item.tweener.kill();
                item.tweener = null;
            }

            item.target = null;
            item.hook = null;
            if (item.tweenConfig)
                item.tweenConfig.endHook = null;
        }

        this._items.length = 0;
        this._playing = false;
        this._onComplete = null;
    }

    public get playing(): boolean {
        return this._playing;
    }

    /**
     * Retargets the items carrying `label` with new values, for a transition
     * whose script is being rebuilt at runtime.
     *
     * `args` are positional and interpreted per action type; see the switch.
     */
    public setValue(label: string, ...args: unknown[]): void {
        const cnt: number = this._items.length;
        for (let i = 0; i < cnt; i++) {
            const item: Item = this._items[i];
            let value: TValue;
            if (item.label === label) {
                if (item.tweenConfig)
                    value = item.tweenConfig.startValue;
                else
                    value = item.value;
            } else if (item.tweenConfig && item.tweenConfig.endLabel === label) {
                value = item.tweenConfig.endValue;
            } else {
                continue;
            }

            switch (item.type) {
                case ActionType.XY:
                case ActionType.Size:
                case ActionType.Pivot:
                case ActionType.Scale:
                case ActionType.Skew:
                    value.b1 = true;
                    value.b2 = true;
                    value.f1 = toFloat(args[0]);
                    value.f2 = toFloat(args[1]);
                    break;

                case ActionType.Alpha:
                    value.f1 = toFloat(args[0]);
                    break;

                case ActionType.Rotation:
                    value.f1 = toFloat(args[0]);
                    break;

                case ActionType.Color:
                    value.f1 = toFloat(args[0]);
                    break;

                case ActionType.Animation:
                    value.frame = toInt(args[0]);
                    if (args.length > 1)
                        value.playing = args[1] as boolean;
                    break;

                case ActionType.Visible:
                    value.visible = args[0] as boolean;
                    break;

                case ActionType.Sound:
                    value.sound = args[0] as string;
                    if (args.length > 1)
                        value.volume = toFloat(args[1]);
                    break;

                case ActionType.Transition:
                    value.transName = args[0] as string;
                    if (args.length > 1)
                        value.playTimes = toInt(args[1]);
                    break;

                case ActionType.Shake:
                    value.amplitude = toFloat(args[0]);
                    if (args.length > 1)
                        value.duration = toFloat(args[1]);
                    break;

                case ActionType.ColorFilter:
                    value.f1 = toFloat(args[0]);
                    value.f2 = toFloat(args[1]);
                    value.f3 = toFloat(args[2]);
                    value.f4 = toFloat(args[3]);
                    break;

                case ActionType.Text:
                case ActionType.Icon:
                    value.text = args[0] as string;
                    break;
            }
        }
    }

    /**
     * Registers a callback for the item labelled `label`.
     *
     * A tweened item has two labels — the start and `endLabel` — and the hook
     * fires when the corresponding end is reached.
     */
    public setHook(label: string, callback: (label?: string) => void): void {
        const cnt: number = this._items.length;
        for (let i = 0; i < cnt; i++) {
            const item: Item = this._items[i];
            if (item.label === label) {
                item.hook = callback;
                break;
            } else if (item.tweenConfig && item.tweenConfig.endLabel === label) {
                item.tweenConfig.endHook = callback;
                break;
            }
        }
    }

    public clearHooks(): void {
        const cnt: number = this._items.length;
        for (let i = 0; i < cnt; i++) {
            const item: Item = this._items[i];
            item.hook = null;
            if (item.tweenConfig)
                item.tweenConfig.endHook = null;
        }
    }

    public setTarget(label: string, newTarget: GObject): void {
        const cnt: number = this._items.length;
        for (let i = 0; i < cnt; i++) {
            const item: Item = this._items[i];
            if (item.label === label) {
                item.targetId = newTarget.id;
                item.target = null;
            }
        }
    }

    public setDuration(label: string, value: number): void {
        const cnt: number = this._items.length;
        for (let i = 0; i < cnt; i++) {
            const item: Item = this._items[i];
            if (item.tweenConfig && item.label === label)
                item.tweenConfig.duration = value;
        }
    }

    /** When the item labelled `label` runs, in seconds; `NaN` if there is none. */
    public getLabelTime(label: string): number {
        const cnt: number = this._items.length;
        for (let i = 0; i < cnt; i++) {
            const item: Item = this._items[i];
            if (item.label === label)
                return item.time;
            else if (item.tweenConfig && item.tweenConfig.endLabel === label)
                return item.time + item.tweenConfig.duration;
        }

        return Number.NaN;
    }

    public get timeScale(): number {
        return this._timeScale;
    }

    public set timeScale(value: number) {
        if (this._timeScale !== value) {
            this._timeScale = value;
            if (this._playing) {
                const cnt: number = this._items.length;
                for (let i = 0; i < cnt; i++) {
                    const item: Item = this._items[i];
                    if (item.tweener)
                        item.tweener.setTimeScale(value);
                    else if (item.type === ActionType.Transition) {
                        if (item.value.trans)
                            item.value.trans.timeScale = value;
                    } else if (item.type === ActionType.Animation) {
                        if (item.target)
                            item.target.setProp(ObjectPropID.TimeScale, value);
                    }
                }
            }
        }
    }

    /** Shifts every XY item bound to `targetId`, after its target moved. */
    public updateFromRelations(targetId: string, dx: number, dy: number): void {
        const cnt: number = this._items.length;
        if (cnt === 0)
            return;

        for (let i = 0; i < cnt; i++) {
            const item: Item = this._items[i];
            if (item.type === ActionType.XY && item.targetId === targetId) {
                if (item.tweenConfig) {
                    item.tweenConfig.startValue.f1 += dx;
                    item.tweenConfig.startValue.f2 += dy;
                    item.tweenConfig.endValue.f1 += dx;
                    item.tweenConfig.endValue.f2 += dy;
                } else {
                    item.value.f1 += dx;
                    item.value.f2 += dy;
                }
            }
        }
    }

    public onEnable(): void {
        if (this._autoPlay && !this._playing)
            this.play(null, this._autoPlayTimes, this._autoPlayDelay);
    }

    public onDisable(): void {
        if ((this._options & OPTION_AUTO_STOP_DISABLED) === 0)
            this.stop((this._options & OPTION_AUTO_STOP_AT_END) !== 0 ? true : false, false);
    }

    /**
     * Per-frame hook.
     *
     * The reference had no such method, and neither does this port need one
     * internally: every timed part of a transition is a `GTween`, and
     * `TweenManager.update(dt)` advances them. It exists so a host can tick a
     * transition uniformly with the rest of the runtime, and does nothing else.
     */
    public update(_dt: number): void {
    }

    private onDelayedPlay = (): void => {
        this.internalPlay();

        this._playing = this._totalTasks > 0;
        if (this._playing) {
            if ((this._options & OPTION_IGNORE_DISPLAY_CONTROLLER) !== 0) {
                const cnt: number = this._items.length;
                for (let i = 0; i < cnt; i++) {
                    const item: Item = this._items[i];
                    if (item.target && item.target !== this._owner)
                        item.displayLockToken = item.target.addDisplayLock();
                }
            }
        } else if (this._onComplete !== null) {
            const func = this._onComplete;
            this._onComplete = null;
            func();
        }
    };

    private internalPlay(): void {
        this._ownerBaseX = this._owner.x;
        this._ownerBaseY = this._owner.y;

        this._totalTasks = 1;

        const cnt: number = this._items.length;
        let needSkipAnimations = false;

        if (!this._reversed) {
            for (let i = 0; i < cnt; i++) {
                const item: Item = this._items[i];
                if (item.target === null)
                    continue;

                if (item.type === ActionType.Animation && this._startTime !== 0 && item.time <= this._startTime) {
                    needSkipAnimations = true;
                    item.value.flag = false;
                } else {
                    this.playItem(item);
                }
            }
        } else {
            for (let i = cnt - 1; i >= 0; i--) {
                const item: Item = this._items[i];
                if (item.target === null)
                    continue;

                this.playItem(item);
            }
        }

        if (needSkipAnimations)
            this.skipAnimations();

        this._totalTasks--;
    }

    private playItem(item: Item): void {
        let time: number;
        const config: TweenConfig | null = isTweenableType(item.type) ? item.tweenConfig : null;
        if (config) {
            if (this._reversed)
                time = (this._totalDuration - item.time - config.duration);
            else
                time = item.time;
            if (this._endTime === -1 || time <= this._endTime) {
                let startValue: TValue;
                let endValue: TValue;
                if (this._reversed) {
                    startValue = config.endValue;
                    endValue = config.startValue;
                } else {
                    startValue = config.startValue;
                    endValue = config.endValue;
                }

                item.value.b1 = startValue.b1 || endValue.b1;
                item.value.b2 = startValue.b2 || endValue.b2;

                switch (item.type) {
                    case ActionType.XY:
                    case ActionType.Size:
                    case ActionType.Scale:
                    case ActionType.Skew:
                        item.tweener = GTween.to2(startValue.f1, startValue.f2, endValue.f1, endValue.f2, config.duration);
                        break;

                    case ActionType.Alpha:
                    case ActionType.Rotation:
                        item.tweener = GTween.to(startValue.f1, endValue.f1, config.duration);
                        break;

                    case ActionType.Color:
                        item.tweener = GTween.toColor(startValue.f1, endValue.f1, config.duration);
                        break;

                    case ActionType.ColorFilter:
                        item.tweener = GTween.to4(startValue.f1, startValue.f2, startValue.f3, startValue.f4,
                            endValue.f1, endValue.f2, endValue.f3, endValue.f4, config.duration);
                        break;

                    default:
                        break;
                }

                item.tweener!.setDelay(time)
                    .setEase(config.easeType)
                    .setRepeat(config.repeat, config.yoyo)
                    .setTimeScale(this._timeScale)
                    .setTarget(item)
                    .onStart(this.onTweenStart, this)
                    .onUpdate(this.onTweenUpdate, this)
                    .onComplete(this.onTweenComplete, this);

                if (this._endTime >= 0)
                    item.tweener!.setBreakpoint(this._endTime - time);

                this._totalTasks++;
            }
        } else if (item.type === ActionType.Shake) {
            if (this._reversed)
                time = (this._totalDuration - item.time - item.value.duration);
            else
                time = item.time;

            item.value.offsetX = item.value.offsetY = 0;
            item.value.lastOffsetX = item.value.lastOffsetY = 0;
            item.tweener = GTween.shake(0, 0, item.value.amplitude, item.value.duration)
                .setDelay(time)
                .setTimeScale(this._timeScale)
                .setTarget(item)
                .onUpdate(this.onTweenUpdate, this)
                .onComplete(this.onTweenComplete, this);

            if (this._endTime >= 0)
                item.tweener.setBreakpoint(this._endTime - item.time);

            this._totalTasks++;
        } else {
            if (this._reversed)
                time = (this._totalDuration - item.time);
            else
                time = item.time;

            if (time <= this._startTime) {
                this.applyValue(item);
                this.callHook(item, false);
            } else if (this._endTime === -1 || time <= this._endTime) {
                this._totalTasks++;
                item.tweener = GTween.delayedCall(time)
                    .setTimeScale(this._timeScale)
                    .setTarget(item)
                    .onComplete(this.onDelayedPlayItem, this);
            }
        }

        if (item.tweener)
            item.tweener.seek(this._startTime);
    }

    /**
     * Fast-forwards the animation items that play before `_startTime`, so a
     * transition that starts mid-script shows the right frame instead of the
     * first one.
     */
    private skipAnimations(): void {
        let frame: number;
        let playStartTime: number;
        let playTotalTime: number;

        const cnt: number = this._items.length;
        for (let i = 0; i < cnt; i++) {
            let item: Item = this._items[i];
            if (item.type !== ActionType.Animation || item.time > this._startTime)
                continue;

            if (item.value.flag)
                continue;

            const target: GObject = item.target!;
            frame = target.getProp(ObjectPropID.Frame) as number;
            playStartTime = (target.getProp(ObjectPropID.Playing) as boolean) ? 0 : -1;
            playTotalTime = 0;

            for (let j: number = i; j < cnt; j++) {
                item = this._items[j];
                if (item.type !== ActionType.Animation || item.target !== target || item.time > this._startTime)
                    continue;

                const value = item.value;
                value.flag = true;

                if (value.frame !== -1) {
                    frame = value.frame;
                    if (value.playing)
                        playStartTime = item.time;
                    else
                        playStartTime = -1;
                    playTotalTime = 0;
                } else {
                    if (value.playing) {
                        if (playStartTime < 0)
                            playStartTime = item.time;
                    } else {
                        if (playStartTime >= 0)
                            playTotalTime += (item.time - playStartTime);
                        playStartTime = -1;
                    }
                }

                this.callHook(item, false);
            }

            if (playStartTime >= 0)
                playTotalTime += (this._startTime - playStartTime);

            target.setProp(ObjectPropID.Playing, playStartTime >= 0);
            target.setProp(ObjectPropID.Frame, frame);
            if (playTotalTime > 0)
                target.setProp(ObjectPropID.DeltaTime, playTotalTime);
        }
    }

    private onDelayedPlayItem = (tweener: GTweener): void => {
        const item = tweener.target as Item;
        item.tweener = null;
        this._totalTasks--;

        this.applyValue(item);
        this.callHook(item, false);

        this.checkAllComplete();
    };

    private onTweenStart = (tweener: GTweener): void => {
        const item = tweener.target as Item;

        // Position and size only have their final start values once the tween
        // actually begins.
        if (item.type === ActionType.XY || item.type === ActionType.Size) {
            const config = item.tweenConfig!;
            let startValue: TValue;
            let endValue: TValue;

            if (this._reversed) {
                startValue = config.endValue;
                endValue = config.startValue;
            } else {
                startValue = config.startValue;
                endValue = config.endValue;
            }

            if (item.type === ActionType.XY) {
                if (item.target !== this._owner) {
                    if (!startValue.b1)
                        tweener.startValue.x = item.target!.x;
                    else if (startValue.b3) // percent
                        tweener.startValue.x = startValue.f1 * this._owner.width;

                    if (!startValue.b2)
                        tweener.startValue.y = item.target!.y;
                    else if (startValue.b3) // percent
                        tweener.startValue.y = startValue.f2 * this._owner.height;

                    if (!endValue.b1)
                        tweener.endValue.x = tweener.startValue.x;
                    else if (endValue.b3)
                        tweener.endValue.x = endValue.f1 * this._owner.width;

                    if (!endValue.b2)
                        tweener.endValue.y = tweener.startValue.y;
                    else if (endValue.b3)
                        tweener.endValue.y = endValue.f2 * this._owner.height;
                } else {
                    // The owner's own XY items are relative to where it stood
                    // when playback began.
                    if (!startValue.b1)
                        tweener.startValue.x = item.target!.x - this._ownerBaseX;
                    if (!startValue.b2)
                        tweener.startValue.y = item.target!.y - this._ownerBaseY;

                    if (!endValue.b1)
                        tweener.endValue.x = tweener.startValue.x;
                    if (!endValue.b2)
                        tweener.endValue.y = tweener.startValue.y;
                }
            } else {
                if (!startValue.b1)
                    tweener.startValue.x = item.target!.width;
                if (!startValue.b2)
                    tweener.startValue.y = item.target!.height;

                if (!endValue.b1)
                    tweener.endValue.x = tweener.startValue.x;
                if (!endValue.b2)
                    tweener.endValue.y = tweener.startValue.y;
            }

            if (config.path) {
                item.value.b1 = item.value.b2 = true;
                tweener.setPath(config.path);
            }
        }

        this.callHook(item, false);
    };

    private onTweenUpdate = (tweener: GTweener): void => {
        const item = tweener.target as Item;
        switch (item.type) {
            case ActionType.XY:
            case ActionType.Size:
            case ActionType.Scale:
            case ActionType.Skew:
                item.value.f1 = tweener.value.x;
                item.value.f2 = tweener.value.y;
                if (item.tweenConfig && item.tweenConfig.path) {
                    // A path describes a displacement, not an absolute point.
                    item.value.f1 += tweener.startValue.x;
                    item.value.f2 += tweener.startValue.y;
                }
                break;

            case ActionType.Alpha:
            case ActionType.Rotation:
                item.value.f1 = tweener.value.x;
                break;

            case ActionType.Color:
                item.value.f1 = tweener.value.color;
                break;

            case ActionType.ColorFilter:
                item.value.f1 = tweener.value.x;
                item.value.f2 = tweener.value.y;
                item.value.f3 = tweener.value.z;
                item.value.f4 = tweener.value.w;
                break;

            case ActionType.Shake:
                item.value.offsetX = tweener.deltaValue.x;
                item.value.offsetY = tweener.deltaValue.y;
                break;
        }

        this.applyValue(item);
    };

    private onTweenComplete = (tweener: GTweener): void => {
        const item = tweener.target as Item;
        item.tweener = null;
        this._totalTasks--;

        // When the whole run ends part-way through this tween, the end hook is
        // not what the author asked for.
        if (tweener.allCompleted)
            this.callHook(item, true);

        this.checkAllComplete();
    };

    private onPlayTransCompleted(item: Item): void {
        void item;
        this._totalTasks--;

        this.checkAllComplete();
    }

    private callHook(item: Item, tweenEnd: boolean): void {
        if (tweenEnd) {
            if (item.tweenConfig && item.tweenConfig.endHook !== null)
                item.tweenConfig.endHook(item.label ?? undefined);
        } else {
            if (item.time >= this._startTime && item.hook !== null)
                item.hook(item.label ?? undefined);
        }
    }

    private checkAllComplete(): void {
        if (this._playing && this._totalTasks === 0) {
            if (this._totalTimes < 0) {
                this.internalPlay();
                if (this._totalTasks === 0)
                    GTween.delayedCall(0).setTarget(this).onComplete(this.checkAllComplete, this);
            } else {
                this._totalTimes--;
                if (this._totalTimes > 0) {
                    this.internalPlay();
                    if (this._totalTasks === 0)
                        GTween.delayedCall(0).setTarget(this).onComplete(this.checkAllComplete, this);
                } else {
                    this._playing = false;

                    const cnt: number = this._items.length;
                    for (let i = 0; i < cnt; i++) {
                        const item: Item = this._items[i];
                        if (item.target && item.displayLockToken !== 0) {
                            item.target.releaseDisplayLock(item.displayLockToken);
                            item.displayLockToken = 0;
                        }
                    }

                    if (this._onComplete !== null) {
                        const func = this._onComplete;
                        this._onComplete = null;
                        func();
                    }
                }
            }
        }
    }

    private applyValue(item: Item): void {
        const target: GObject = item.target!;
        target._gearLocked = true;
        const value: TValue = item.value;

        switch (item.type) {
            case ActionType.XY:
                if (target === this._owner) {
                    if (value.b1 && value.b2)
                        target.setPosition(value.f1 + this._ownerBaseX, value.f2 + this._ownerBaseY);
                    else if (value.b1)
                        target.x = value.f1 + this._ownerBaseX;
                    else
                        target.y = value.f2 + this._ownerBaseY;
                } else {
                    if (value.b3) { // position in percent
                        if (value.b1 && value.b2)
                            target.setPosition(value.f1 * this._owner.width, value.f2 * this._owner.height);
                        else if (value.b1)
                            target.x = value.f1 * this._owner.width;
                        else if (value.b2)
                            target.y = value.f2 * this._owner.height;
                    } else {
                        if (value.b1 && value.b2)
                            target.setPosition(value.f1, value.f2);
                        else if (value.b1)
                            target.x = value.f1;
                        else if (value.b2)
                            target.y = value.f2;
                    }
                }
                break;

            case ActionType.Size:
                if (!value.b1)
                    value.f1 = target.width;
                if (!value.b2)
                    value.f2 = target.height;
                target.setSize(value.f1, value.f2);
                break;

            case ActionType.Pivot:
                target.setPivot(value.f1, value.f2, target.pivotAsAnchor);
                break;

            case ActionType.Alpha:
                target.alpha = value.f1;
                break;

            case ActionType.Rotation:
                target.rotation = value.f1;
                break;

            case ActionType.Scale:
                target.setScale(value.f1, value.f2);
                break;

            case ActionType.Skew:
                target.setSkew(value.f1, value.f2);
                break;

            case ActionType.Color: {
                const color = target.getProp(ObjectPropID.Color);
                if (color instanceof Color) {
                    // The packed value is 0xRRGGBB; alpha is left alone, as the
                    // reference left it.
                    const i = Math.floor(value.f1);
                    color.r = (i >> 16) & 0xFF;
                    color.g = (i >> 8) & 0xFF;
                    color.b = i & 0xFF;
                    target.setProp(ObjectPropID.Color, color);
                }
                break;
            }

            case ActionType.Animation:
                if (value.frame >= 0)
                    target.setProp(ObjectPropID.Frame, value.frame);
                target.setProp(ObjectPropID.Playing, value.playing);
                target.setProp(ObjectPropID.TimeScale, this._timeScale);
                break;

            case ActionType.Visible:
                target.visible = value.visible;
                break;

            case ActionType.Transition:
                if (this._playing) {
                    const trans: Transition | null = value.trans;
                    if (trans) {
                        this._totalTasks++;
                        const startTime: number = this._startTime > item.time ? (this._startTime - item.time) : 0;
                        let endTime: number = this._endTime >= 0 ? (this._endTime - item.time) : -1;
                        if (value.stopTime >= 0 && (endTime < 0 || endTime > value.stopTime))
                            endTime = value.stopTime;
                        trans.timeScale = this._timeScale;
                        trans._play(() => this.onPlayTransCompleted(item), value.playTimes, 0, startTime, endTime, this._reversed);
                    }
                }
                break;

            case ActionType.Sound:
                if (this._playing && item.time >= this._startTime) {
                    if (value.audioClip == null) {
                        const pi = UIPackage.getItemByURL(value.sound as string);
                        if (pi)
                            value.audioClip = pi.owner.getItemAsset(pi);
                    }
                    if (value.audioClip)
                        getStage()?.playOneShotSound(value.audioClip, value.volume);
                }
                break;

            case ActionType.Shake:
                target.setPosition(
                    target.x - value.lastOffsetX + value.offsetX,
                    target.y - value.lastOffsetY + value.offsetY);
                value.lastOffsetX = value.offsetX;
                value.lastOffsetY = value.offsetY;
                break;

            case ActionType.ColorFilter:
                // Filter effects are not modelled; the reference left the same
                // TODO here.
                break;

            case ActionType.Text:
                target.text = value.text;
                break;

            case ActionType.Icon:
                target.icon = value.text;
                break;
        }

        target._gearLocked = false;
    }

    /** @internal Called by `GComponent.constructFromResource2`. */
    public setup(buffer: ByteBuffer): void {
        this.name = buffer.readS() ?? '';
        this._options = buffer.readInt();
        this._autoPlay = buffer.readBool();
        this._autoPlayTimes = buffer.readInt();
        this._autoPlayDelay = buffer.readFloat();

        const cnt: number = buffer.readShort();
        for (let i = 0; i < cnt; i++) {
            const dataLen: number = buffer.readShort();
            const curPos: number = buffer.position;

            buffer.seek(curPos, 0);

            const item: Item = new Item(buffer.readByte());
            this._items[i] = item;

            item.time = buffer.readFloat();
            const targetId: number = buffer.readShort();
            if (targetId < 0)
                item.targetId = '';
            else
                item.targetId = this._owner.getChildAt(targetId).id;
            item.label = buffer.readS();

            if (buffer.readBool()) {
                buffer.seek(curPos, 1);

                const config = new TweenConfig();
                item.tweenConfig = config;
                config.duration = buffer.readFloat();
                if (item.time + config.duration > this._totalDuration)
                    this._totalDuration = item.time + config.duration;
                config.easeType = buffer.readByte();
                config.repeat = buffer.readInt();
                config.yoyo = buffer.readBool();
                config.endLabel = buffer.readS();

                buffer.seek(curPos, 2);

                this.decodeValue(item, buffer, config.startValue);

                buffer.seek(curPos, 3);

                this.decodeValue(item, buffer, config.endValue);

                if (buffer.version >= 2) {
                    const pathLen: number = buffer.readInt();
                    if (pathLen > 0) {
                        config.path = new GPath();
                        const pts: GPathPoint[] = [];

                        for (let j = 0; j < pathLen; j++) {
                            const curveType: number = buffer.readByte();
                            switch (curveType) {
                                case CurveType.Bezier:
                                    pts.push(GPathPoint.newBezierPoint(buffer.readFloat(), buffer.readFloat(),
                                        buffer.readFloat(), buffer.readFloat()));
                                    break;

                                case CurveType.CubicBezier:
                                    pts.push(GPathPoint.newCubicBezierPoint(buffer.readFloat(), buffer.readFloat(),
                                        buffer.readFloat(), buffer.readFloat(),
                                        buffer.readFloat(), buffer.readFloat()));
                                    break;

                                default:
                                    pts.push(GPathPoint.newPoint(buffer.readFloat(), buffer.readFloat(), curveType));
                                    break;
                            }
                        }

                        config.path.create(pts);
                    }
                }
            } else {
                if (item.time > this._totalDuration)
                    this._totalDuration = item.time;

                buffer.seek(curPos, 2);

                this.decodeValue(item, buffer, item.value);
            }

            buffer.position = curPos + dataLen;
        }
    }

    private decodeValue(item: Item, buffer: ByteBuffer, value: TValue): void {
        switch (item.type) {
            case ActionType.XY:
            case ActionType.Size:
            case ActionType.Pivot:
            case ActionType.Skew:
                value.b1 = buffer.readBool();
                value.b2 = buffer.readBool();
                value.f1 = buffer.readFloat();
                value.f2 = buffer.readFloat();

                if (buffer.version >= 2 && item.type === ActionType.XY)
                    value.b3 = buffer.readBool(); // percent
                break;

            case ActionType.Alpha:
            case ActionType.Rotation:
                value.f1 = buffer.readFloat();
                break;

            case ActionType.Scale:
                value.f1 = buffer.readFloat();
                value.f2 = buffer.readFloat();
                break;

            case ActionType.Color: {
                const color = buffer.readColor();
                value.f1 = (color.r << 16) + (color.g << 8) + color.b;
                break;
            }

            case ActionType.Animation:
                value.playing = buffer.readBool();
                value.frame = buffer.readInt();
                break;

            case ActionType.Visible:
                value.visible = buffer.readBool();
                break;

            case ActionType.Sound:
                value.sound = buffer.readS();
                value.volume = buffer.readFloat();
                break;

            case ActionType.Transition:
                value.transName = buffer.readS();
                value.playTimes = buffer.readInt();
                break;

            case ActionType.Shake:
                value.amplitude = buffer.readFloat();
                value.duration = buffer.readFloat();
                break;

            case ActionType.ColorFilter:
                value.f1 = buffer.readFloat();
                value.f2 = buffer.readFloat();
                value.f3 = buffer.readFloat();
                value.f4 = buffer.readFloat();
                break;

            case ActionType.Text:
            case ActionType.Icon:
                value.text = buffer.readS();
                break;
        }
    }
}
