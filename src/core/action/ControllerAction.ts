import type { ByteBuffer } from '../utils/ByteBuffer.js';
import type { Controller } from '../Controller.js';

/**
 * Runs when a controller enters or leaves a matching page transition.
 *
 * Action type ids, as written by the editor:
 * `0` play a transition, `1` change another controller's page.
 */
export abstract class ControllerAction {
    /** Source pages that trigger `enter`; empty means "any". */
    public fromPage: string[] = [];
    /** Destination pages that trigger `enter`; empty means "any". */
    public toPage: string[] = [];

    public run(controller: Controller, prevPage: string | null, curPage: string | null): void {
        if ((this.fromPage.length === 0 || this.fromPage.indexOf(prevPage as string) !== -1)
            && (this.toPage.length === 0 || this.toPage.indexOf(curPage as string) !== -1)) {
            this.enter(controller);
        } else {
            this.leave(controller);
        }
    }

    protected enter(_controller: Controller): void {
    }

    protected leave(_controller: Controller): void {
    }

    public setup(buffer: ByteBuffer): void {
        let cnt = buffer.readShort();
        this.fromPage = [];
        for (let i = 0; i < cnt; i++)
            this.fromPage[i] = buffer.readS() as string;

        cnt = buffer.readShort();
        this.toPage = [];
        for (let i = 0; i < cnt; i++)
            this.toPage[i] = buffer.readS() as string;
    }
}

type ActionCtor = new () => ControllerAction;

/**
 * Action classes by type id.
 *
 * Registered by subclass modules rather than imported here, so that the
 * subclasses can extend `ControllerAction` without closing an import cycle.
 */
const actionTypes: Array<ActionCtor | undefined> = [];

export function registerAction(type: number, ctor: ActionCtor): void {
    actionTypes[type] = ctor;
}

export function createAction(type: number): ControllerAction {
    const ctor = actionTypes[type];
    if (!ctor)
        throw new Error(`fairygui: unknown controller action type ${type}. Import the core entry point, which registers the built-in actions.`);
    return new ctor();
}
