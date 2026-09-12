import { beforeEach, describe, expect, test } from '@rstest/core';
import { GComponent } from '../src/core/GComponent.js';
import { DragDropManager } from '../src/core/DragDropManager.js';
import { GObject } from '../src/core/GObject.js';
import { GRoot } from '../src/core/GRoot.js';
import { EventType } from '../src/core/event/Event.js';
import { setRenderFactory } from '../src/core/render/IRenderObject.js';
import { setScrollPaneClass, setTransitionClass } from '../src/core/Builtins.js';
import { ScrollPane } from '../src/core/ScrollPane.js';
import { Transition } from '../src/core/Transition.js';
import { MockRenderer } from './helpers/mockRender.js';

setRenderFactory(new MockRenderer());
setScrollPaneClass(ScrollPane);
setTransitionClass(Transition);

/**
 * A root with one draggable box on it.
 *
 * `opaque` is what makes the bare component a hit target — a component with no
 * children and no `opaque` reports nothing under the pointer, so without it the
 * press would never land on the box.
 */
function makeScene(): { root: GRoot; box: GComponent } {
    const root = GRoot.create();
    root.removeChildren(0, -1, true);

    const box = new GComponent();
    box.opaque = true;
    box.setSize(40, 40);
    box.setPosition(100, 100);
    root.addChild(box);

    return { root, box };
}

describe('GObject dragging', () => {
    beforeEach(() => {
        // A drag left in flight would swallow the next case's moves.
        GObject.draggingObject = null;
    });

    test('a draggable object follows the pointer', () => {
        const { root, box } = makeScene();
        box.draggable = true;

        const input = root.inputProcessor;
        input.touchBegin(0, 110, 110);
        // The first move past the sensitivity threshold is what starts the drag;
        // it establishes the anchor and does not move the box itself.
        input.touchMove(0, 130, 130);
        // From here the box tracks the pointer.
        input.touchMove(0, 150, 160);
        input.touchEnd(0, 150, 160);

        expect(box.x, 'x follows the pointer').toBe(120);
        expect(box.y, 'y follows the pointer').toBe(130);
        expect(GObject.draggingObject, 'the drag ended with the touch').toBeNull();
    });

    test('a press shorter than the threshold does not start a drag', () => {
        const { root, box } = makeScene();
        box.draggable = true;

        const input = root.inputProcessor;
        input.touchBegin(0, 110, 110);
        input.touchMove(0, 113, 113); // inside the 10px threshold
        input.touchEnd(0, 113, 113);

        expect(box.x, 'x unmoved').toBe(100);
        expect(box.y, 'y unmoved').toBe(100);
    });

    test('an object that is not draggable stays put', () => {
        const { root, box } = makeScene();

        const input = root.inputProcessor;
        input.touchBegin(0, 110, 110);
        input.touchMove(0, 130, 130);
        input.touchMove(0, 200, 200);
        input.touchEnd(0, 200, 200);

        expect(box.x).toBe(100);
        expect(box.y).toBe(100);
    });

    test('the drag agent follows the pointer', () => {
        // `DragDropManager` hands its agent a drag without ever seeing the raw
        // pointer id — the widget that started the drag does not have one
        // either. So "no id" has to resolve to the live pointer: registering
        // the monitor against a placeholder attaches it to nothing, and the
        // icon is created but then sits still while the pointer moves.
        const { root, box } = makeScene();
        const input = root.inputProcessor;
        input.touchBegin(0, 110, 110);

        DragDropManager.inst.startDrag(box, 'ui://Basics/r0');

        const agent = DragDropManager.inst.dragAgent;
        const beforeX = agent.x;

        input.touchMove(0, 150, 190);

        expect(agent.x, 'the agent followed the pointer').not.toBe(beforeX);
        expect(agent.x, 'and landed where the pointer is').toBe(150);

        input.touchEnd(0, 150, 190);
        DragDropManager.inst.cancel();
    });

    test('the agent follows the pressed pointer when a hover took the first slot', () => {
        // A host that reports a hover and a press under different ids parks two
        // slots, and the hovering one comes first — it never moves again, so
        // resolving "no id" to it creates the agent and leaves it sitting still.
        const { root, box } = makeScene();
        const input = root.inputProcessor;

        input.mouseMove(110, 110);
        input.touchBegin(1, 110, 110);

        DragDropManager.inst.startDrag(box, 'ui://Basics/r0');
        const agent = DragDropManager.inst.dragAgent;

        input.touchMove(1, 150, 190);

        expect(agent.x, 'the agent followed the pressed pointer').toBe(150);
        expect(agent.y).toBe(190);

        input.touchEnd(1, 150, 190);
        DragDropManager.inst.cancel();
    });

    test('a drop resolves against the drag pointer, not against the hovering slot', () => {
        // The hovering slot is still live on release and holds whatever was
        // under the pointer before the press — the object the drag came from.
        // Walking up from it finds no DROP listener, so the drop goes nowhere.
        const { root, box } = makeScene();
        const input = root.inputProcessor;
        box.draggable = true;

        const target = new GComponent();
        target.opaque = true;
        target.setSize(40, 40);
        target.setPosition(300, 300);
        root.addChild(target);

        let dropped: unknown = null;
        target.on(EventType.DROP, (_t: GObject, data: unknown) => { dropped = data; });
        // The handoff the demo makes: the widget gives its own drag up and the
        // manager takes over with an agent.
        box.on(EventType.DRAG_START, () => {
            box.stopDrag();
            DragDropManager.inst.startDrag(box, 'ui://Basics/r0', 'payload');
        });

        input.mouseMove(110, 110);
        input.touchBegin(1, 110, 110);
        input.touchMove(1, 130, 130); // past the sensitivity: DRAG_START
        input.touchMove(1, 310, 310);
        input.touchEnd(1, 310, 310);

        expect(dropped, 'the drop reached the object under the pointer').toBe('payload');
    });

    test('DRAG_START fires, and a listener may refuse the drag', () => {
        // This is how `DragDropManager` takes a drag over: the listener calls
        // `stopDrag` and starts its own agent instead.
        const { root, box } = makeScene();
        box.draggable = true;

        let started = 0;
        box.on(EventType.DRAG_START, () => { started++; });

        const input = root.inputProcessor;
        input.touchBegin(0, 110, 110);
        input.touchMove(0, 130, 130);

        expect(started, 'DRAG_START fired once').toBe(1);
        expect(GObject.draggingObject, 'and the drag is in flight').toBe(box);

        input.touchEnd(0, 130, 130);
    });
});
