import { beforeEach, describe, expect, test } from '@rstest/core';
import { GComponent } from '../src/core/GComponent.js';
import { ActionType, Transition } from '../src/core/Transition.js';
import { EaseType } from '../src/core/tween/EaseType.js';
import { TweenManager } from '../src/core/tween/TweenManager.js';
import { ByteBuffer } from '../src/core/utils/ByteBuffer.js';
import { setRenderFactory } from '../src/core/render/IRenderObject.js';
import { MockRenderer } from './helpers/mockRender.js';

const STRINGS = ['anim', 'move', 'moved', 'fade'];

/**
 * Writes the package format big-endian, the way `ByteBuffer` reads it.
 *
 * The same shape `tests/gears.test.ts` uses; a transition payload is smaller
 * than a real `.fui` and building it here keeps the test independent of the
 * widgets a fixture would pull in.
 */
class ByteWriter {
    private _bytes: number[] = [];

    public byte(v: number): this {
        this._bytes.push(v & 0xff);
        return this;
    }

    public bool(v: boolean): this {
        return this.byte(v ? 1 : 0);
    }

    public short(v: number): this {
        this._bytes.push((v >> 8) & 0xff, v & 0xff);
        return this;
    }

    public int(v: number): this {
        this._bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
        return this;
    }

    public float(v: number): this {
        const view = new DataView(new ArrayBuffer(4));
        view.setFloat32(0, v);
        for (let i = 0; i < 4; i++)
            this._bytes.push(view.getUint8(i));
        return this;
    }

    /** A string-table reference; 65534 is the format's null marker. */
    public s(name: string | null): this {
        return this.short(name === null ? 65534 : STRINGS.indexOf(name));
    }

    public raw(bytes: number[]): this {
        for (const b of bytes)
            this._bytes.push(b);
        return this;
    }

    public toBytes(): number[] {
        return this._bytes.slice();
    }

    public toBuffer(): ByteBuffer {
        const buffer = new ByteBuffer(new Uint8Array(this._bytes).buffer as ArrayBuffer);
        buffer.stringTable = STRINGS;
        return buffer;
    }
}

/**
 * Wraps an item's parts in its index table.
 *
 * `Transition.setup` addresses each part through `ByteBuffer.seek`, which reads
 * a segment count, a width flag and one relative offset per segment; a zero
 * offset means that part is absent.
 */
function frame(segments: Array<number[] | null>): number[] {
    let offset = 2 + 2 * segments.length;
    const offsets: number[] = [];
    for (const seg of segments) {
        if (seg && seg.length > 0) {
            offsets.push(offset);
            offset += seg.length;
        } else {
            offsets.push(0);
        }
    }

    const out: number[] = [segments.length, 1];
    for (const o of offsets)
        out.push((o >> 8) & 0xff, o & 0xff);
    for (const seg of segments) {
        if (seg)
            out.push(...seg);
    }
    return out;
}

/**
 * Item header: type, start time, target index (-1 = the owner), label, and
 * whether a tween config follows.
 */
function header(type: ActionType, time: number, label: string | null, hasTween: boolean): number[] {
    return new ByteWriter().byte(type).float(time).short(-1).s(label).bool(hasTween).toBytes();
}

/** Tweens the owner's position from (0,0) to (100,50) over one second. */
function xyItem(): number[] {
    return frame([
        header(ActionType.XY, 0, 'move', true),
        new ByteWriter().float(1).byte(EaseType.Linear).int(0).bool(false).s('moved').toBytes(),
        new ByteWriter().bool(true).bool(true).float(0).float(0).toBytes(),
        new ByteWriter().bool(true).bool(true).float(100).float(50).toBytes(),
    ]);
}

/** Sets the owner's alpha once, half a second in. */
function alphaItem(): number[] {
    return frame([
        header(ActionType.Alpha, 0.5, 'fade', false),
        null,
        new ByteWriter().float(0.25).toBytes(),
    ]);
}

function buildTransition(items: number[][], autoPlay = false): ByteBuffer {
    const writer = new ByteWriter();
    writer.s('anim').int(0).bool(autoPlay).int(1).float(0).short(items.length);
    for (const item of items)
        writer.short(item.length).raw(item);
    return writer.toBuffer();
}

interface Harness {
    comp: GComponent;
    trans: Transition;
}

function makeTransition(autoPlay = false): Harness {
    const comp = new GComponent();
    comp.setSize(200, 100);

    const trans = new Transition(comp);
    trans.setup(buildTransition([xyItem(), alphaItem()], autoPlay));

    return { comp, trans };
}

/** Runs the tween manager's clock, which is what drives a transition. */
function advance(seconds: number, step: number = seconds): void {
    const ticks = Math.max(1, Math.round(seconds / step));
    for (let i = 0; i < ticks; i++)
        TweenManager.update(step);
}

beforeEach(() => {
    setRenderFactory(new MockRenderer());
});

describe('Transition.setup', () => {
    test('reads the script and its timings', () => {
        const { trans } = makeTransition();

        expect(trans.name).toBe('anim');
        expect(trans.playing).toBe(false);

        // `moved` is the XY item's end label, so it sits one duration in.
        expect(trans.getLabelTime('move')).toBe(0);
        expect(trans.getLabelTime('moved')).toBe(1);
        expect(trans.getLabelTime('fade')).toBe(0.5);
        expect(Number.isNaN(trans.getLabelTime('nothing'))).toBe(true);
    });

    test('honours the payload autoPlay flag', () => {
        const { trans } = makeTransition(true);
        expect(trans.playing).toBe(false);

        trans.onEnable();

        expect(trans.playing).toBe(true);
        trans.stop();
    });
});

describe('Transition playback', () => {
    test('plays the script, tweening and applying items at their times', () => {
        const { comp, trans } = makeTransition();

        let completed = 0;
        trans.play(() => completed++);

        expect(trans.playing).toBe(true);
        expect(comp.alpha).toBe(1);

        advance(0.5);
        expect(comp.x).toBeCloseTo(50, 10);
        expect(comp.y).toBeCloseTo(25, 10);
        expect(comp.alpha).toBeCloseTo(0.25, 10);
        expect(completed).toBe(0);
        expect(trans.playing).toBe(true);

        advance(0.5);
        expect(comp.x).toBeCloseTo(100, 10);
        expect(comp.y).toBeCloseTo(50, 10);
        expect(completed).toBe(1);
        expect(trans.playing).toBe(false);
    });

    test('runs the item hooks at the labels they were registered for', () => {
        const { trans } = makeTransition();
        const seen: string[] = [];

        trans.setHook('move', (label) => seen.push('start:' + label));
        trans.setHook('moved', (label) => seen.push('end:' + label));
        trans.setHook('fade', (label) => seen.push('applied:' + label));

        trans.play();
        advance(0.5);
        expect(seen).toEqual(['start:move', 'applied:fade']);

        advance(0.5);
        // The end hook is registered by `endLabel` but is handed the item's own
        // label, which is what the reference did.
        expect(seen).toEqual(['start:move', 'applied:fade', 'end:move']);

        trans.clearHooks();
        trans.play();
        advance(1);
        expect(seen).toHaveLength(3);
    });

    test('changePlayTimes adds repetitions to a running transition', () => {
        const { trans } = makeTransition();

        let completed = 0;
        trans.play(() => completed++);
        advance(0.5);

        trans.changePlayTimes(2);
        advance(0.5); // the first pass ends, one repetition left
        expect(completed).toBe(0);
        expect(trans.playing).toBe(true);

        advance(1);
        expect(completed).toBe(1);
        expect(trans.playing).toBe(false);
    });

    test('timeScale slows the tweens down', () => {
        const { comp, trans } = makeTransition();

        trans.timeScale = 0.5;
        trans.play();

        advance(0.5);
        expect(comp.x).toBeCloseTo(25, 10);

        advance(1.5);
        expect(comp.x).toBeCloseTo(100, 10);
    });

    test('the update hook does not drive anything by itself', () => {
        const { comp, trans } = makeTransition();

        trans.play();
        trans.update(10);

        // TweenManager owns the clock; the hook is only there so a host can
        // tick a transition alongside the rest of the runtime.
        expect(comp.x).toBe(0);
        expect(trans.playing).toBe(true);

        trans.stop();
    });
});

describe('Transition stop and rollback', () => {
    test('stop jumps every item to its end value', () => {
        const { comp, trans } = makeTransition();

        trans.play();
        advance(0.25);
        expect(comp.x).toBeCloseTo(25, 10);

        trans.stop();

        expect(trans.playing).toBe(false);
        expect(comp.x).toBeCloseTo(100, 10);
        expect(comp.y).toBeCloseTo(50, 10);
    });

    test('stop(false) freezes the items where they are', () => {
        const { comp, trans } = makeTransition();

        trans.play();
        advance(0.25);

        trans.stop(false);
        expect(comp.x).toBeCloseTo(25, 10);

        advance(1);
        expect(comp.x).toBeCloseTo(25, 10);
        expect(trans.playing).toBe(false);
    });

    test('playReverse runs the recorded range backwards', () => {
        const { comp, trans } = makeTransition();

        let completed = 0;
        trans.playReverse(() => completed++);

        expect(trans.playing).toBe(true);

        advance(0.25);
        expect(comp.x).toBeCloseTo(75, 10);
        expect(comp.y).toBeCloseTo(37.5, 10);

        advance(0.75);
        expect(comp.x).toBeCloseTo(0, 10);
        expect(comp.y).toBeCloseTo(0, 10);
        expect(completed).toBe(1);
        expect(trans.playing).toBe(false);
    });

    test('dispose kills the items and forgets the script', () => {
        const { comp, trans } = makeTransition();

        trans.play();
        advance(0.25);
        const mid = comp.x;

        trans.dispose();

        expect(trans.playing).toBe(false);
        advance(1);
        expect(comp.x).toBeCloseTo(mid, 10);
        expect(Number.isNaN(trans.getLabelTime('move'))).toBe(true);
    });
});
