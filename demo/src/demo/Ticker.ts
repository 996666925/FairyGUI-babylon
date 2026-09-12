/**
 * Per-frame work, for demos that need to animate something the runtime does not
 * tick for them.
 *
 * The reference drove those with `Laya.timer.frameLoop(2, this, cb)`. There is
 * no such facility here — `GRoot.update` is driven from the host's render loop
 * — so a demo that wants a frame callback has to hook the same loop. This wraps
 * `requestAnimationFrame` so it can start and stop its own work without knowing
 * how the host renders.
 */

/**
 * Runs `cb` once per rendered frame until the returned function is called.
 *
 * `dt` is the time since the previous frame in **seconds**; the first frame
 * reports `0`, having no predecessor to measure against. The returned stop
 * function is idempotent — calling it more than once is harmless, and calling
 * it from inside `cb` stops the loop without running the frame again.
 */
export function onFrame(cb: (dt: number) => void): () => void {
    let handle = 0;
    let last = 0;
    let running = true;

    const step = (now: number): void => {
        if (!running)
            return;

        const dt = last === 0 ? 0 : (now - last) / 1000;
        last = now;
        cb(dt);

        // `cb` may have stopped the loop; a stopped loop never re-arms.
        if (running)
            handle = requestAnimationFrame(step);
    };

    handle = requestAnimationFrame(step);

    return () => {
        if (!running)
            return;
        running = false;
        cancelAnimationFrame(handle);
    };
}
