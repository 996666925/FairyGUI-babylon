import type { GObject } from './GObject.js';
import type { GRoot } from './GRoot.js';

/**
 * Holds the active `GRoot`.
 *
 * `GObject` needs to reach the root from anywhere — for `root`, tooltips, drag
 * handling — but importing `GRoot` at module scope would create a cycle
 * (`GRoot` → `GComponent` → `GObject`), and ESM evaluates class bodies eagerly,
 * so the `extends GObject` in `GComponent` could run before `GObject` exists.
 * Keeping the reference in this leaf module lets every import in that cycle be
 * type-only, which the compiler erases.
 */
let stage: GRoot | null = null;

/** @internal Called by the `GRoot` constructor. */
export function setStage(value: GRoot | null): void {
    stage = value;
}

/** The active root, or `null` before one has been built. */
export function getStage(): GRoot | null {
    return stage;
}

/** Marks the class `GObject.root` should stop at. Set by `GRoot`. */
export interface IRootMarker {
    readonly isRoot: true;
}

/**
 * Walks up from `obj` to the nearest ancestor that is a root.
 * @internal
 */
export function findRootOf(obj: GObject | null): GRoot | null {
    let p: GObject | null = obj;
    while (p) {
        if ((p as unknown as IRootMarker).isRoot)
            return p as unknown as GRoot;
        p = p.parent;
    }
    return stage;
}
