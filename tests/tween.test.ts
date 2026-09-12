import { describe, expect, test } from '@rstest/core';
import { EaseType } from '../src/core/tween/EaseType.js';
import { evaluateEase } from '../src/core/tween/EaseManager.js';
import { GPath } from '../src/core/tween/GPath.js';
import { CurveType, GPathPoint } from '../src/core/tween/GPathPoint.js';
import { GTween } from '../src/core/tween/GTween.js';
import { TweenManager } from '../src/core/tween/TweenManager.js';
import { TweenValue } from '../src/core/tween/TweenValue.js';
import { Color } from '../src/core/utils/Color.js';
import { Point } from '../src/core/utils/Geometry.js';

/** Every ease the manager knows, from `Linear` through `Custom`. */
const EASE_TYPES: number[] = [];
for (let ease = EaseType.Linear; ease <= EaseType.Custom; ease++)
    EASE_TYPES.push(ease);

const OVERSHOOT = 1.70158;

/** Runs the manager's clock for `seconds` in `step`-sized ticks. */
function advance(seconds: number, step: number = seconds): void {
    const ticks = Math.max(1, Math.round(seconds / step));
    for (let i = 0; i < ticks; i++)
        TweenManager.update(step);
}

describe('evaluateEase', () => {
    test('starts at 0 and ends at 1 for every ease type', () => {
        for (const ease of EASE_TYPES) {
            expect(evaluateEase(ease, 0, 1, OVERSHOOT, 0), `ease ${ease} at t=0`).toBeCloseTo(0, 6);
            expect(evaluateEase(ease, 1, 1, OVERSHOOT, 0), `ease ${ease} at t=1`).toBeCloseTo(1, 6);
        }
    });

    test('hits the closed-form values in between', () => {
        expect(evaluateEase(EaseType.Linear, 0.25, 1, OVERSHOOT, 0)).toBeCloseTo(0.25, 10);
        expect(evaluateEase(EaseType.QuadOut, 0.25, 1, OVERSHOOT, 0)).toBeCloseTo(0.4375, 10);
        expect(evaluateEase(EaseType.QuadIn, 0.5, 1, OVERSHOOT, 0)).toBeCloseTo(0.25, 10);
        expect(evaluateEase(EaseType.CubicIn, 0.5, 1, OVERSHOOT, 0)).toBeCloseTo(0.125, 10);
    });

    test('scales with the duration instead of assuming one second', () => {
        expect(evaluateEase(EaseType.Linear, 1, 4, OVERSHOOT, 0)).toBeCloseTo(0.25, 10);
        expect(evaluateEase(EaseType.Linear, 4, 4, OVERSHOOT, 0)).toBeCloseTo(1, 10);
    });

    test('overshooting eases pass 1 in the middle', () => {
        // BackOut leans on overshootOrAmplitude, so with the default it goes past the end.
        expect(evaluateEase(EaseType.BackOut, 0.5, 1, OVERSHOOT, 0)).toBeGreaterThan(1);
    });

    test('an unknown ease type falls back to QuadOut', () => {
        expect(evaluateEase(99, 0.25, 1, OVERSHOOT, 0)).toBeCloseTo(0.4375, 10);
        expect(evaluateEase(EaseType.Custom, 0.25, 1, OVERSHOOT, 0)).toBeCloseTo(0.4375, 10);
    });
});

describe('TweenValue', () => {
    test('packs and unpacks a colour in 0xAARRGGBB order', () => {
        const value = new TweenValue();
        value.color = 0x336699;

        expect([value.x, value.y, value.z, value.w]).toEqual([0x33, 0x66, 0x99, 0]);
        expect(value.color).toBe(0x336699);
    });

    test('addresses the channels by index', () => {
        const value = new TweenValue();
        for (let i = 0; i < 4; i++)
            value.setField(i, i + 1);

        expect([value.x, value.y, value.z, value.w]).toEqual([1, 2, 3, 4]);
        expect(value.getField(3)).toBe(4);
        expect(() => value.getField(4)).toThrow();
        expect(() => value.setField(4, 0)).toThrow();

        value.setZero();
        expect([value.x, value.y, value.z, value.w]).toEqual([0, 0, 0, 0]);
    });

    test('exposes the channels as a Color as well', () => {
        const value = new TweenValue();
        value.setColor(new Color(0x33, 0x66, 0x99, 0xff));

        expect([value.x, value.y, value.z, value.w]).toEqual([0x33, 0x66, 0x99, 0xff]);
        expect(value.getColor().equals(new Color(0x33, 0x66, 0x99, 0xff))).toBe(true);
    });
});

describe('GTween', () => {
    test('interpolates a linear tween and completes exactly once', () => {
        const target = { x: 0 };
        let completed = 0;
        GTween.to(0, 10, 2).setEase(EaseType.Linear).setTarget(target, 'x').onComplete(() => completed++);

        advance(1);
        expect(target.x).toBeCloseTo(5, 10);
        expect(completed).toBe(0);
        expect(GTween.isTweening(target)).toBe(true);

        advance(1);
        expect(target.x).toBeCloseTo(10, 10);
        expect(completed).toBe(1);

        // Further ticks must not re-fire the completion callback.
        advance(1);
        advance(1);
        expect(completed).toBe(1);
        expect(GTween.isTweening(target)).toBe(false);
    });

    test('defaults to QuadOut', () => {
        const target = { x: 0 };
        GTween.to(0, 10, 1).setTarget(target, 'x');

        advance(0.5);
        // QuadOut(0.5) = 0.75, not the 0.5 a linear tween would give.
        expect(target.x).toBeCloseTo(7.5, 10);
    });

    test('setDelay holds the value back until the delay is over', () => {
        const target = { x: 0 };
        const tweener = GTween.to(0, 10, 1).setEase(EaseType.Linear).setDelay(0.5).setTarget(target, 'x');

        advance(0.25);
        expect(target.x).toBe(0);
        expect(tweener.normalizedTime).toBe(0);

        // At exactly the delay the tween starts, still at its start value.
        advance(0.25);
        expect(target.x).toBe(0);

        advance(0.5);
        expect(target.x).toBeCloseTo(5, 10);

        advance(0.5);
        expect(target.x).toBeCloseTo(10, 10);
    });

    test('fires start once, before the first update, and complete last', () => {
        const order: string[] = [];
        const target = { x: 0 };
        GTween.to(0, 1, 1).setEase(EaseType.Linear).setDelay(0.25).setTarget(target, 'x')
            .onStart(() => order.push('start'))
            .onUpdate(() => order.push('update'))
            .onComplete(() => order.push('complete'));

        advance(0.25);
        expect(order).toEqual(['start', 'update']);

        // The delay eats into the clock, so the tween ends at delay + duration.
        advance(1);
        expect(order[order.length - 1]).toBe('complete');
        expect(order.filter(step => step === 'start')).toHaveLength(1);
        expect(order.filter(step => step === 'complete')).toHaveLength(1);
    });

    test('delayedCall completes without touching the target', () => {
        const target = {};
        let completed = 0;
        GTween.delayedCall(0.5).setTarget(target).onComplete(() => completed++);

        advance(0.25);
        expect(completed).toBe(0);

        advance(0.25);
        expect(completed).toBe(1);

        advance(1);
        expect(completed).toBe(1);
    });

    test('repeats the tween before completing', () => {
        const target = { x: 0 };
        let completed = 0;
        GTween.to(0, 10, 0.5).setEase(EaseType.Linear).setRepeat(1).setTarget(target, 'x')
            .onComplete(() => completed++);

        advance(0.25);
        expect(target.x).toBeCloseTo(5, 10);

        // Second round starts over from the start value.
        advance(0.25);
        expect(target.x).toBeCloseTo(0, 10);

        advance(0.25);
        expect(target.x).toBeCloseTo(5, 10);

        advance(0.25);
        expect(target.x).toBeCloseTo(10, 10);
        expect(completed).toBe(1);
    });

    test('yoyo plays the odd rounds backwards', () => {
        const target = { x: 0 };
        GTween.to(0, 10, 0.5).setEase(EaseType.Linear).setRepeat(1, true).setTarget(target, 'x');

        // 0.1s into the second round, which runs from 10 back to 0.
        advance(0.6);
        expect(target.x).toBeCloseTo(8, 10);
    });

    test('kill freezes the value, kill(true) runs it to the end', () => {
        const frozen = { x: 0 };
        let completed = 0;
        GTween.to(0, 10, 1).setEase(EaseType.Linear).setTarget(frozen, 'x').onComplete(() => completed++);

        advance(0.5);
        GTween.kill(frozen, false);
        expect(GTween.isTweening(frozen)).toBe(false);

        advance(0.5);
        expect(frozen.x).toBeCloseTo(5, 10);
        expect(completed).toBe(0);

        const finished = { x: 0 };
        let completedOnce = 0;
        GTween.to(0, 10, 1).setEase(EaseType.Linear).setTarget(finished, 'x').onComplete(() => completedOnce++);

        advance(0.25);
        GTween.kill(finished, true);
        expect(finished.x).toBeCloseTo(10, 10);
        expect(completedOnce).toBe(1);
    });

    test('a paused tween does not advance', () => {
        const target = { x: 0 };
        const tweener = GTween.to(0, 10, 1).setEase(EaseType.Linear).setTarget(target, 'x');

        advance(0.25);
        tweener.setPaused(true);
        advance(0.5);
        expect(target.x).toBeCloseTo(2.5, 10);

        tweener.setPaused(false);
        advance(0.25);
        expect(target.x).toBeCloseTo(5, 10);
    });

    test('seek moves the tween without consuming clock time', () => {
        const target = { x: 0 };
        const tweener = GTween.to(0, 10, 1).setEase(EaseType.Linear).setTarget(target, 'x');

        tweener.seek(0.25);
        expect(target.x).toBeCloseTo(2.5, 10);
        expect(tweener.normalizedTime).toBeCloseTo(0.25, 10);

        advance(0.25);
        expect(target.x).toBeCloseTo(5, 10);
    });

    test('finds and filters tweens by target and property', () => {
        const target = { x: 0, y: 0 };
        const tweener = GTween.to(0, 10, 1).setTarget(target, 'x');

        expect(GTween.isTweening(target)).toBe(true);
        expect(GTween.isTweening(target, 'x')).toBe(true);
        expect(GTween.isTweening(target, 'y')).toBe(false);
        expect(GTween.getTween(target, 'x')).toBe(tweener);
        expect(GTween.getTween(target, 'y')).toBeNull();
        expect(GTween.isTweening({ x: 0 })).toBe(false);
        expect(GTween.getTween(null)).toBeNull();

        GTween.kill(target, false, 'x');
        expect(GTween.isTweening(target)).toBe(false);
    });

    test('drops tweens whose target reports itself gone', () => {
        const gone = { x: 0, disposed: false };
        GTween.to(0, 10, 1).setEase(EaseType.Linear).setTarget(gone, 'x');

        advance(0.25);
        expect(gone.x).toBeCloseTo(2.5, 10);

        gone.disposed = true;
        advance(0.25);
        expect(GTween.isTweening(gone)).toBe(false);

        // A target whose node has been dropped is gone from the start.
        const orphan = { x: 0, node: null };
        GTween.to(0, 10, 1).setTarget(orphan, 'x');
        advance(0.25);
        expect(GTween.isTweening(orphan)).toBe(false);
    });

    test('drives two and four value tweens', () => {
        const positions: Array<Array<number>> = [];
        GTween.to2(0, 0, 10, 20, 1).setEase(EaseType.Linear)
            .setTarget({}, (x: number, y: number) => positions.push([x, y]));
        advance(0.5);
        expect(positions[positions.length - 1]).toEqual([5, 10]);

        const four: Array<Array<number>> = [];
        GTween.to4(0, 0, 0, 0, 1, 2, 3, 4, 1).setEase(EaseType.Linear)
            .setTarget({}, (x: number, y: number, z: number, w: number) => four.push([x, y, z, w]));
        advance(1);
        expect(four[four.length - 1]).toEqual([1, 2, 3, 4]);
    });

    test('tweens a packed colour', () => {
        const colors: number[] = [];
        GTween.toColor(0x000000, 0xffffff, 1).setEase(EaseType.Linear)
            .setTarget({}, (color: number) => colors.push(color));

        advance(0.5);
        // Halfway through: 127.5 in every channel, packed by the TweenValue getter.
        expect(colors[colors.length - 1]).toBeCloseTo((127 << 16) + (127 << 8) + 127.5, 10);

        advance(0.5);
        expect(colors[colors.length - 1]).toBe(0xffffff);
    });

    test('shake offsets the start point and settles back onto it', () => {
        const offsets: Array<number> = [];
        GTween.shake(5, 6, 10, 1).setEase(EaseType.Linear)
            .setTarget({}, (x: number, y: number) => offsets.push(x, y));

        advance(0.5);
        // Somewhere around the start point, but not on it.
        expect(Math.abs(offsets[offsets.length - 2] - 5)).toBeGreaterThan(0);
        expect(Math.abs(offsets[offsets.length - 2] - 5)).toBeLessThanOrEqual(10);
        expect(Math.abs(offsets[offsets.length - 1] - 6)).toBeLessThanOrEqual(10);

        advance(0.5);
        expect(offsets[offsets.length - 2]).toBeCloseTo(5, 10);
        expect(offsets[offsets.length - 1]).toBeCloseTo(6, 10);
    });
});

describe('GPath', () => {
    test('samples a straight polyline by arc length', () => {
        const path = new GPath();
        path.create([
            GPathPoint.newPoint(0, 0, CurveType.Straight),
            GPathPoint.newPoint(10, 0, CurveType.Straight),
            GPathPoint.newPoint(10, 10, CurveType.Straight),
        ]);

        expect(path.segmentCount).toBe(2);
        expect(path.length).toBeCloseTo(20, 10);

        const start = path.getPointAt(0);
        expect([start.x, start.y]).toEqual([0, 0]);

        const quarter = path.getPointAt(0.25);
        expect(quarter.x).toBeCloseTo(5, 10);
        expect(quarter.y).toBeCloseTo(0, 10);

        // The corner sits exactly at half of the total length.
        const corner = path.getPointAt(0.5);
        expect([corner.x, corner.y]).toEqual([10, 0]);

        const end = path.getPointAt(1);
        expect([end.x, end.y]).toEqual([10, 10]);
    });

    test('clamps t and writes into the caller\'s point', () => {
        const path = new GPath();
        path.create(GPathPoint.newPoint(0, 0, CurveType.Straight), GPathPoint.newPoint(4, 8, CurveType.Straight));

        const out = new Point();
        expect(path.getPointAt(0.5, out)).toBe(out);
        expect([out.x, out.y]).toEqual([2, 4]);

        const past = path.getPointAt(-1, out);
        expect([past.x, past.y]).toEqual([0, 0]);

        const beyond = path.getPointAt(2, out);
        expect([beyond.x, beyond.y]).toEqual([4, 8]);
    });

    test('a quadratic Bezier bulges towards its control point', () => {
        const path = new GPath();
        path.create([
            GPathPoint.newBezierPoint(0, 0, 5, 10),
            GPathPoint.newPoint(10, 0, CurveType.Straight),
        ]);

        const start = path.getPointAt(0);
        expect([start.x, start.y]).toEqual([0, 0]);

        const middle = path.getPointAt(0.5);
        expect(middle.x).toBeCloseTo(5, 10);
        expect(middle.y).toBeCloseTo(5, 10);

        const end = path.getPointAt(1);
        expect([end.x, end.y]).toEqual([10, 0]);
    });

    test('a CRSpline runs through its control points', () => {
        const path = new GPath();
        path.create([
            GPathPoint.newPoint(0, 0),
            GPathPoint.newPoint(10, 0),
            GPathPoint.newPoint(10, 10),
        ]);

        expect(path.segmentCount).toBe(1);

        const start = path.getPointAt(0);
        expect([start.x, start.y]).toEqual([0, 0]);

        const end = path.getPointAt(1);
        expect([end.x, end.y]).toEqual([10, 10]);

        const all = path.getAllPoints();
        expect(all.length).toBeGreaterThan(2);
        expect([all[0].x, all[0].y]).toEqual([0, 0]);
        expect(all[all.length - 1].y).toBeCloseTo(10, 10);
    });

    test('an empty path samples to its origin, and clear() drops the segments', () => {
        const path = new GPath();
        const origin = path.getPointAt(0.5);
        expect([origin.x, origin.y]).toEqual([0, 0]);

        path.create(GPathPoint.newPoint(0, 0, CurveType.Straight), GPathPoint.newPoint(10, 0, CurveType.Straight));
        expect(path.segmentCount).toBe(1);

        path.clear();
        expect(path.segmentCount).toBe(0);
        expect(path.getPointAt(1).x).toBe(0);
    });
});
