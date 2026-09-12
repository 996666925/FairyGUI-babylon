import { UIPackage } from './UIPackage.js';

import type { GObject } from './GObject.js';

/**
 * A per-URL cache of built objects.
 *
 * `GList` recycles its item renderers through one of these: an item scrolled
 * out of view goes back on the pile under its own `resourceURL` and is handed
 * out again when the same resource is needed, rather than being disposed and
 * rebuilt.
 */
export class GObjectPool {
    private _pool: Record<string, GObject[]> = {};
    private _count = 0;

    /** Disposes everything held, and empties the pool. */
    public clear(): void {
        for (const url of Object.keys(this._pool)) {
            const arr = this._pool[url];
            for (let i = 0; i < arr.length; i++)
                arr[i].dispose();
        }
        this._pool = {};
        this._count = 0;
    }

    /** How many objects are currently held. */
    public get count(): number {
        return this._count;
    }

    /**
     * Takes a pooled object for `url`, or builds a fresh one.
     *
     * The reference declares a non-null return but answers `null` for an
     * unresolvable URL; the null is honest here because `GList.getFromPool`
     * tests for it.
     */
    public getObject(url?: string | null): GObject | null {
        // `normalizeURL` itself tolerates null, but its signature does not.
        const normalized = UIPackage.normalizeURL(url as string);
        if (normalized == null)
            return null;

        const arr = this._pool[normalized];
        if (arr && arr.length) {
            this._count--;
            return arr.shift()!;
        }

        return UIPackage.createObjectFromURL(normalized);
    }

    /**
     * Returns `obj` to the pool under its own `resourceURL`.
     *
     * An object without one (nothing built from a package) is dropped: the
     * reference silently ignores it too, since it could never be looked up
     * again.
     */
    public returnObject(obj: GObject): void {
        const url = obj.resourceURL;
        if (!url)
            return;

        let arr = this._pool[url];
        if (arr == null) {
            arr = [];
            this._pool[url] = arr;
        }

        this._count++;
        arr.push(obj);
    }
}
