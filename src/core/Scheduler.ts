import { Scheduler } from './utils/Scheduler.js';

/**
 * The one scheduler every object defers work to.
 *
 * A shared instance (rather than one per root) keeps `GObject.callLater`
 * working for objects that are not attached to a root yet, and lets `GRoot`
 * drive all pending work from a single tick.
 */
export const scheduler = new Scheduler();
