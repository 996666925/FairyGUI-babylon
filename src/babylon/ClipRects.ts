import { Rect } from '../core/utils/Geometry.js';
import { Mat2D } from './Mat2D.js';

/**
 * How many nested `scrollRect`s the UI shader can enforce at once.
 *
 * This is the length of the shader's uniform arrays, so it is a hard ceiling
 * rather than a tuning knob.
 */
export const MAX_CLIP_RECTS = 4;

/**
 * `true` for the values that make an unused clip slot a no-op: the identity
 * matrix and an unbounded rect.
 */
const PASS_THROUGH_MIN = -1e9;
const PASS_THROUGH_MAX = 1e9;

/**
 * One ancestor's `scrollRect`, resolved into everything the shader needs.
 *
 * `matrix` maps **UI-root space to the clipping object's local space** — the
 * inverse of that object's `localToGlobal` affine. Keeping it a full affine,
 * rather than an axis-aligned box, is what lets a rotated ancestor clip
 * correctly: the fragment's UI-space position is pushed through the matrix and
 * only then compared against the rect.
 */
export interface ClipEntry {
    /** UI-root space → clipping object's local space. */
    matrix: Mat2D;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * A stack of active `scrollRect`s, capped at {@link MAX_CLIP_RECTS}.
 *
 * ### The nesting limit
 *
 * Clip rectangles cannot in general be collapsed into one: an ancestor may be
 * rotated, so two rects that look nested on screen are not nested in a common
 * space. The shader therefore tests every slot independently and rejects a
 * fragment that falls outside *any* of them.
 *
 * Past {@link MAX_CLIP_RECTS} the **innermost** rects win and the outer ones are
 * dropped: a deeply nested scroll pane's own bounds matter far more to the
 * picture than an outer window edge that its content almost never leaves. The
 * consequence is that content can escape an ancestor's clip once more than four
 * scroll rects are stacked; {@link droppedCount} reports how many rects were
 * discarded so a caller can surface it.
 *
 * The stack is reused across frames; {@link clear} resets it without allocating.
 */
export class ClipStack {
    private readonly _entries: ClipEntry[] = [];
    /** Per-depth scratch, so a steady-state frame allocates nothing. */
    private readonly _pool: ClipEntry[] = [];
    private _dropped = 0;

    /** Entries currently held, innermost last. */
    public get count(): number {
        return this._entries.length;
    }

    /** Rects discarded because the stack was full, since the last `clear`. */
    public get droppedCount(): number {
        return this._dropped;
    }

    /** Entries currently held, innermost last. Read-only. */
    public get entries(): readonly ClipEntry[] {
        return this._entries;
    }

    public clear(): void {
        this._entries.length = 0;
        this._dropped = 0;
    }

    /**
     * Adds a clip rect.
     *
     * @param localToUI the clipping object's local→UI-root affine.
     * @param rect the rect, in that object's local space.
     */
    public push(localToUI: Mat2D, rect: Rect): void {
        let entry: ClipEntry;
        if (this._entries.length >= MAX_CLIP_RECTS) {
            // The stack is full: keep the innermost `MAX_CLIP_RECTS` by dropping
            // the outermost entry and recycling its storage for this one.
            entry = this._entries.shift() as ClipEntry;
            this._dropped++;
        } else {
            entry = this._entryFor(this._entries.length);
        }
        entry.matrix.copy(localToUI).invert();
        entry.minX = rect.x;
        entry.minY = rect.y;
        entry.maxX = rect.x + rect.width;
        entry.maxY = rect.y + rect.height;
        this._entries.push(entry);
    }

    /** Copies this stack from `source`, for handing a parent's clips to a child. */
    public copyFrom(source: ClipStack): void {
        this._entries.length = 0;
        for (let i = 0; i < source._entries.length; i++) {
            const src = source._entries[i];
            const entry = this._entryFor(i);
            entry.matrix.copy(src.matrix);
            entry.minX = src.minX;
            entry.minY = src.minY;
            entry.maxX = src.maxX;
            entry.maxY = src.maxY;
            this._entries.push(entry);
        }
        this._dropped = source._dropped;
    }

    private _entryFor(depth: number): ClipEntry {
        let entry = this._pool[depth];
        if (!entry) {
            entry = { matrix: new Mat2D(), minX: 0, minY: 0, maxX: 0, maxY: 0 };
            this._pool[depth] = entry;
        }
        return entry;
    }

    /**
     * CPU-side equivalent of the shader test: whether a point in UI-root space
     * survives every active clip.
     *
     * Used by `BabRenderObject.hitTest` and by tests.
     */
    public containsUIPoint(x: number, y: number): boolean {
        for (const entry of this._entries) {
            const lx = entry.matrix.transformX(x, y);
            const ly = entry.matrix.transformY(x, y);
            if (lx < entry.minX || ly < entry.minY || lx > entry.maxX || ly > entry.maxY)
                return false;
        }
        return true;
    }

    /**
     * Packs the stack into the shader's uniform arrays.
     *
     * Each slot contributes a rect (`minX, minY, maxX, maxY`) and the two rows of
     * its matrix, packed as `vec4`s. Unused slots are filled with the identity
     * matrix and an unbounded rect, so the fragment shader can test all four slots
     * unconditionally — no dynamic loop bound, no `break`, which keeps the shader
     * inside what GLSL ES 1.0 guarantees.
     *
     * @param rects length `MAX_CLIP_RECTS * 4`.
     * @param row0 length `MAX_CLIP_RECTS * 4`, `(a, b, tx, 0)` per slot.
     * @param row1 length `MAX_CLIP_RECTS * 4`, `(c, d, ty, 0)` per slot.
     */
    public writeUniforms(rects: number[], row0: number[], row1: number[]): void {
        for (let i = 0; i < MAX_CLIP_RECTS; i++) {
            const o = i * 4;
            const entry = i < this._entries.length ? this._entries[i] : null;
            if (entry) {
                rects[o] = entry.minX;
                rects[o + 1] = entry.minY;
                rects[o + 2] = entry.maxX;
                rects[o + 3] = entry.maxY;
                row0[o] = entry.matrix.a;
                row0[o + 1] = entry.matrix.c;
                row0[o + 2] = entry.matrix.tx;
                row0[o + 3] = 0;
                row1[o] = entry.matrix.b;
                row1[o + 1] = entry.matrix.d;
                row1[o + 2] = entry.matrix.ty;
                row1[o + 3] = 0;
            } else {
                rects[o] = PASS_THROUGH_MIN;
                rects[o + 1] = PASS_THROUGH_MIN;
                rects[o + 2] = PASS_THROUGH_MAX;
                rects[o + 3] = PASS_THROUGH_MAX;
                row0[o] = 1;
                row0[o + 1] = 0;
                row0[o + 2] = 0;
                row0[o + 3] = 0;
                row1[o] = 0;
                row1[o + 1] = 1;
                row1[o + 2] = 0;
                row1[o + 3] = 0;
            }
        }
    }
}
