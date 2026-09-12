interface Task {
    callback: () => void;
    /** Seconds remaining; `<= 0` when the task is due. */
    remaining: number;
    /** Identity used to de-duplicate registrations. */
    owner: unknown;
}

/**
 * Deferred callbacks driven by the same clock as everything else.
 *
 * Replaces the `cc.Component.scheduleOnce` the reference reached for via
 * `GObjectPartner.callLater`. `GRoot` advances this from its own update loop so
 * that timing stays consistent with tweens and transitions, and stays
 * deterministic in tests.
 */
export class Scheduler {
    private _tasks: Task[] = [];

    /** Schedules `callback` to run after `delay` seconds. */
    public callLater(owner: unknown, callback: () => void, delay = 0): void {
        // Re-registering an owner replaces its pending task, which is what the
        // reference's isScheduled/scheduleOnce pair did.
        for (const t of this._tasks) {
            if (t.owner === owner) {
                t.callback = callback;
                t.remaining = delay;
                return;
            }
        }
        this._tasks.push({ owner, callback, remaining: delay });
    }

    public cancel(owner: unknown): void {
        for (let i = this._tasks.length - 1; i >= 0; i--) {
            if (this._tasks[i].owner === owner)
                this._tasks.splice(i, 1);
        }
    }

    /** Advances the clock and runs everything that came due. */
    public update(dt: number): void {
        if (this._tasks.length === 0)
            return;

        // Snapshot: a due callback may schedule or cancel more work.
        const due: Task[] = [];
        for (let i = this._tasks.length - 1; i >= 0; i--) {
            const t = this._tasks[i];
            t.remaining -= dt;
            if (t.remaining <= 0) {
                this._tasks.splice(i, 1);
                due.push(t);
            }
        }

        for (let i = due.length - 1; i >= 0; i--)
            due[i].callback();
    }

    public clear(): void {
        this._tasks.length = 0;
    }
}
