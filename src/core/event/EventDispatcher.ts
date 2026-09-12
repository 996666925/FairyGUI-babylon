import { Event, type EventTypeName } from './Event.js';

export type Listener = (...args: any[]) => void;

interface Entry {
    listener: Listener;
    target: unknown;
    once: boolean;
}

/**
 * Listener registry behind `GObject.on` / `off` / `emit`.
 *
 * `off` matches on listener identity *and* target, so the same function may be
 * registered against several targets and removed selectively — the behaviour
 * FairyGUI code relies on when it re-registers callbacks during
 * `constructFromResource`.
 */
export class EventDispatcher {
    private _entries: Map<string, Entry[]> | null = null;

    public on(type: EventTypeName | string, listener: Listener, target?: unknown): void {
        this._add(type, listener, target, false);
    }

    public once(type: EventTypeName | string, listener: Listener, target?: unknown): void {
        this._add(type, listener, target, true);
    }

    private _add(type: string, listener: Listener, target: unknown, once: boolean): void {
        if (!this._entries)
            this._entries = new Map();
        let list = this._entries.get(type);
        if (!list) {
            list = [];
            this._entries.set(type, list);
        }
        // Re-registering the same listener/target pair updates the `once` flag
        // rather than duplicating the entry.
        for (const e of list) {
            if (e.listener === listener && e.target === target) {
                e.once = once;
                return;
            }
        }
        list.push({ listener, target, once });
    }

    public off(type: EventTypeName | string, listener?: Listener, target?: unknown): void {
        const list = this._entries?.get(type);
        if (!list)
            return;

        if (!listener) {
            this._entries!.delete(type);
            return;
        }

        for (let i = list.length - 1; i >= 0; i--) {
            const e = list[i];
            if (e.listener === listener && (target === undefined || e.target === target))
                list.splice(i, 1);
        }
        if (list.length === 0)
            this._entries!.delete(type);
    }

    public offAll(): void {
        this._entries = null;
    }

    public hasListener(type: EventTypeName | string): boolean {
        return (this._entries?.get(type)?.length ?? 0) > 0;
    }

    /**
     * Calls listeners for `type`. Never bubbles and never touches the parent
     * chain — use `dispatchEvent` for that.
     *
     * @returns `true` if any listener ran.
     */
    public emit(type: EventTypeName | string, ...args: unknown[]): boolean {
        const list = this._entries?.get(type);
        if (!list || list.length === 0)
            return false;

        // Copy first: a listener may add or remove listeners for this type.
        const snapshot = list.slice();
        for (const e of snapshot) {
            if (e.once)
                this.off(type, e.listener, e.target);
            e.listener.apply(e.target, args);
        }
        return true;
    }

    /**
     * Dispatches `evt` to `currentTarget`, then up its parent chain while
     * `evt.bubbles` is set. Each level sees `currentTarget` updated.
     *
     * @param getParent walks the dispatch chain; the target hands this in so the
     *   dispatcher need not know about `GObject`.
     * @returns `true` if any listener ran.
     */
    public dispatchEvent(
        evt: Event,
        getParent: (current: unknown) => { dispatcher: EventDispatcher } | null,
    ): boolean {
        let node: unknown = evt.currentTarget;
        let handled = false;

        while (node) {
            const dispatcher = (node as { dispatcher?: EventDispatcher }).dispatcher;
            evt.currentTarget = node;
            if (dispatcher?.emit(evt.type, evt))
                handled = true;

            if (!evt.bubbles || evt._propagationStopped)
                break;

            const parent = getParent(node);
            node = parent;
        }

        evt.currentTarget = null;
        return handled;
    }
}
