import { GLoader } from './GLoader.js';
import { GRoot } from './GRoot.js';
import { AlignType, VertAlignType } from './FieldTypes.js';
import { EventType } from './event/Event.js';

import type { GObject } from './GObject.js';

/**
 * The icon that follows the pointer during a drag-and-drop operation.
 *
 * A single shared agent object is reused for every drag. On release it walks up
 * from whatever is under the pointer looking for a listener on `DROP`, so a
 * drop target just registers `on(EventType.DROP, …)` on itself or an ancestor.
 */
export class DragDropManager {
    private _agent: GLoader;
    private _sourceData: unknown = null;
    /** Pointer the drag follows, and the one a drop is resolved against. */
    private _touchId = 0;

    private static _inst: DragDropManager | null = null;

    public static get inst(): DragDropManager {
        return (DragDropManager._inst ??= new DragDropManager());
    }

    public constructor() {
        this._agent = new GLoader();
        this._agent.draggable = true;
        // The agent must never intercept input; the drag is driven by the
        // pointer that started it, not by the icon under the cursor.
        this._agent.touchable = false;
        this._agent.setSize(100, 100);
        this._agent.setPivot(0.5, 0.5, true);
        this._agent.align = AlignType.Center;
        this._agent.verticalAlign = VertAlignType.Middle;
        this._agent.sortingOrder = 1000000;
        this._agent.on(EventType.DRAG_END, this.onDragEnd, this);
    }

    public get dragAgent(): GObject {
        return this._agent;
    }

    public get dragging(): boolean {
        return this._agent.parent != null;
    }

    /**
     * Begins a drag.
     *
     * @param source the object the drag started from. Kept for call-site
     *   symmetry with the reference; the agent is driven by the pointer, so it
     *   is not used after the drag begins.
     */
    public startDrag(_source: GObject, icon: string, sourceData?: unknown, touchId?: number): void {
        if (this._agent.parent)
            return;

        const root = GRoot.inst;

        // Resolved here rather than left to the agent so the drop knows which
        // pointer to resolve against. The first live slot is not that pointer
        // when the host hovers under a different id than it presses with.
        this._touchId = touchId ?? root.inputProcessor.getPressedTouchId() ?? 0;
        this._sourceData = sourceData ?? null;
        this._agent.url = icon;

        root.addChild(this._agent);

        const pt = root.getTouchPosition(this._touchId);
        root.globalToLocal(pt.x, pt.y, pt);
        this._agent.setPosition(pt.x, pt.y);
        this._agent.startDrag(this._touchId);
    }

    public cancel(): void {
        if (!this._agent.parent)
            return;

        this._agent.stopDrag();
        GRoot.inst.removeChild(this._agent);
        this._sourceData = null;
    }

    private onDragEnd = (): void => {
        // No parent means the drag was cancelled; `cancel` already cleaned up.
        if (!this._agent.parent)
            return;

        const root = GRoot.inst;
        root.removeChild(this._agent);

        const sourceData = this._sourceData;
        this._sourceData = null;

        // The drag's own pointer: a hovering slot is still live and holds
        // whatever the pointer was over before the press — the object the drag
        // started from, which would swallow the drop.
        let obj: GObject | null = root.inputProcessor.getTouchTarget(this._touchId);
        while (obj) {
            if (obj.dispatcher.hasListener(EventType.DROP)) {
                obj.requestFocus();
                obj.emit(EventType.DROP, obj, sourceData);
                return;
            }
            obj = obj.parent;
        }
    };
}
