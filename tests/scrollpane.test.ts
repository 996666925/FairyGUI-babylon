import { beforeEach, describe, expect, test } from '@rstest/core';
import { GComponent } from '../src/core/GComponent.js';
import { ScrollPane } from '../src/core/ScrollPane.js';
import { ScrollBarDisplayType, ScrollType } from '../src/core/FieldTypes.js';
import { Event, EventType } from '../src/core/event/Event.js';
import { Point } from '../src/core/utils/Geometry.js';
import { ByteBuffer } from '../src/core/utils/ByteBuffer.js';
import { setRenderFactory } from '../src/core/render/IRenderObject.js';
import { scheduler } from '../src/core/Scheduler.js';
import { MockRenderer } from './helpers/mockRender.js';

beforeEach(() => {
    setRenderFactory(new MockRenderer());
    // A case that leaves a drag in flight would otherwise have its pane
    // swallow the next case's moves; the input layer would have sent a
    // TOUCH_END in real use.
    ScrollPane.draggingPane = null;
});

interface PaneOptions {
    viewWidth?: number;
    viewHeight?: number;
    rows?: number;
    rowWidth?: number;
    rowHeight?: number;
}

interface Harness {
    comp: GComponent;
    pane: ScrollPane;
}

/**
 * A component with a scroll pane over `rows` stacked children.
 *
 * `_scrollPane` is assigned before any child is added, which is the state
 * `GComponent.setupScroll` leaves behind — and it matters, because
 * `setBoundsChangedFlag` does nothing on a component that has neither a pane
 * nor `trackBounds`.
 */
function makePane(options: PaneOptions = {}): Harness {
    const viewWidth = options.viewWidth ?? 200;
    const viewHeight = options.viewHeight ?? 300;
    const rows = options.rows ?? 6;
    const rowWidth = options.rowWidth ?? viewWidth;
    const rowHeight = options.rowHeight ?? 100;

    const comp = new GComponent();
    comp.setSize(viewWidth, viewHeight);

    const pane = new ScrollPane(comp);
    comp._scrollPane = pane;

    for (let i = 0; i < rows; i++) {
        const row = new GComponent();
        row.setSize(rowWidth, rowHeight);
        row.setPosition(0, i * rowHeight);
        comp.addChild(row);
    }

    comp.ensureBoundsCorrect();

    return { comp, pane };
}

/**
 * A parent `GObject.onStage` accepts as a root.
 *
 * The touch handlers refuse to fling when the owner is off-stage, and being
 * "on stage" here means having an ancestor marked as the root.
 */
function makeStage(): GComponent {
    const root = new GComponent();
    (root as unknown as { isRoot: boolean }).isRoot = true;
    return root;
}

function touch(x: number, y: number, type: string = EventType.TOUCH_BEGIN, touchId = 0): Event {
    const evt = new Event(type);
    evt.pos.setTo(x, y);
    evt.touchId = touchId;
    return evt;
}

function wheel(delta: number, x = 0, y = 0): Event {
    const evt = new Event(EventType.MOUSE_WHEEL);
    evt.pos.setTo(x, y);
    evt.mouseWheelDelta = delta;
    return evt;
}

/** A scroll-pane payload with no scroll bars, no header and no footer. */
function scrollConfig(scrollType: ScrollType, flags: number): ByteBuffer {
    // scrollType, scrollBarDisplay, flags, hasMargin, then four null resources.
    const bytes = new Uint8Array(15);
    bytes[0] = scrollType;
    bytes[1] = ScrollBarDisplayType.Hidden;
    bytes[2] = (flags >>> 24) & 0xFF;
    bytes[3] = (flags >>> 16) & 0xFF;
    bytes[4] = (flags >>> 8) & 0xFF;
    bytes[5] = flags & 0xFF;
    bytes[6] = 0;
    for (let i = 7; i < 15; i += 2) {
        bytes[i] = 0xFF;
        bytes[i + 1] = 0xFE; // 65534: `readS`'s null marker
    }

    const buffer = new ByteBuffer(bytes.buffer as ArrayBuffer);
    buffer.position = 0;
    return buffer;
}

/** Runs whatever the pane deferred onto the scheduler. */
function flush(): void {
    scheduler.update(0);
}

describe('ScrollPane layout', () => {
    test('takes its content size from the children bounds', () => {
        const { comp, pane } = makePane({ rows: 6, rowHeight: 100 });

        expect(pane.contentWidth).toBe(200);
        expect(pane.contentHeight).toBe(600);

        // A row added later is picked up by the next bounds pass.
        const extra = new GComponent();
        extra.setSize(200, 100);
        extra.setPosition(0, 600);
        comp.addChild(extra);
        comp.ensureBoundsCorrect();

        expect(pane.contentHeight).toBe(700);
    });

    test('reports the view size, and follows the owner when it is resized', () => {
        const { comp, pane } = makePane({ viewWidth: 200, viewHeight: 300 });

        expect(pane.viewWidth).toBe(200);
        expect(pane.viewHeight).toBe(300);

        // Both routes go through the owner's size.
        comp.viewWidth = 150;
        expect(comp.width).toBe(150);
        expect(pane.viewWidth).toBe(150);

        comp.viewHeight = 250;
        expect(comp.height).toBe(250);
        expect(pane.viewHeight).toBe(250);
    });

    test('clamps the offset to the overlap between content and view', () => {
        const { pane } = makePane({ viewWidth: 200, viewHeight: 300, rows: 6 });

        // 600 of content in a 300-high view leaves 300 to scroll through.
        pane.setPercY(0.5);
        expect(pane.posY).toBe(150);
        expect(pane.percY).toBeCloseTo(0.5, 10);

        pane.setPercY(2);
        expect(pane.posY).toBe(300);
        expect(pane.percY).toBe(1);

        pane.setPercY(-1);
        expect(pane.posY).toBe(0);

        pane.posY = -50;
        expect(pane.posY).toBe(0);

        pane.posY = 1e6;
        expect(pane.posY).toBe(300);

        // A vertical pane has no horizontal overlap to reach.
        expect(pane.percX).toBe(0);
        pane.setPercX(1);
        expect(pane.posX).toBe(0);
    });

    test('carries the offset on the container, y down', () => {
        const { comp, pane } = makePane({ viewWidth: 200, viewHeight: 300, rows: 6 });

        pane.setPosY(120);
        flush();

        // The container moves up by the offset and left by the x offset, and
        // the pane reads both back out of the container's position.
        expect(comp._container.positionY).toBe(-120);
        expect(pane.scrollingPosY).toBe(120);
        // A zero offset can come back as negative zero; numerically it is 0.
        expect(comp._container.positionX).toBeCloseTo(0, 10);
        expect(pane.scrollingPosX).toBeCloseTo(0, 10);
    });

    test('snaps to the nearest child boundary when snapToItem is on', () => {
        const { pane } = makePane({ viewWidth: 200, viewHeight: 300, rows: 6 });

        // The snapping policy is read from the payload flag.
        pane.setup(scrollConfig(ScrollType.Vertical, 2));
        expect(pane.snapToItem).toBe(true);

        // Child 0 spans 0..100 and child 1 starts at 100; the halfway mark
        // decides which one is nearer.
        pane.setPosY(30);
        flush();
        expect(pane.posY).toBeCloseTo(0, 10);

        pane.setPosY(80);
        flush();
        expect(pane.posY).toBe(100);
    });

    test('aligns to whole pages in page mode', () => {
        const { pane } = makePane({ viewWidth: 200, viewHeight: 300, rows: 6 });

        pane.setup(scrollConfig(ScrollType.Vertical, 8));
        expect(pane.currentPageY).toBe(0);

        pane.setCurrentPageY(1);
        flush();
        expect(pane.posY).toBe(300);
        expect(pane.currentPageY).toBe(1);

        pane.setCurrentPageY(0);
        flush();
        expect(pane.posY).toBeCloseTo(0, 10);
        expect(pane.currentPageY).toBeCloseTo(0, 10);
    });

    test('hit-tests inside the view only', () => {
        const { comp, pane } = makePane({ viewWidth: 200, viewHeight: 300, rows: 6 });

        expect(pane.hitTest(new Point(50, 50), new Point(50, 50))).toBe(comp);
        expect(pane.hitTest(new Point(50, 350), new Point(50, 350))).toBeNull();
    });

    test('isChildInView follows the scroll offset', () => {
        const { comp, pane } = makePane({ viewWidth: 200, viewHeight: 300, rows: 6 });
        const last = comp.getChildAt(5);

        expect(pane.isChildInView(last)).toBe(false);

        pane.setPosY(300);
        flush();

        expect(pane.isChildInView(last)).toBe(true);
    });

    test('a header lock pulls the content down and holds it there', () => {
        const { comp, pane } = makePane({ rows: 20 });

        pane.lockHeader(50);
        pane.update(0.5);

        // The lock opens a 50px gap above the content for a pull-down bar, so
        // the container sits *below* its rest position.
        expect(comp._container.positionY).toBe(50);
        expect(pane.posY).toBeCloseTo(0, 10);
    });

    test('a footer lock only takes effect at the bottom', () => {
        // Away from the end there is nothing to reserve, so the lock is
        // recorded but the content does not move.
        const away = makePane({ rows: 20 });
        away.pane.lockFooter(50);
        away.pane.update(0.5);
        expect(away.comp._container.positionY).toBe(0);

        // Pinned to the end, applying the lock opens up the extra space. The
        // pane must start unlocked: `lockFooter` ignores a repeated value, so
        // re-issuing the same size would be a no-op.
        const end = makePane({ rows: 20 });
        end.pane.setPosY(1700);
        flush();
        expect(end.comp._container.positionY).toBe(-1700);

        end.pane.lockFooter(50);
        end.pane.update(0.5);
        expect(end.comp._container.positionY).toBe(-1750);
    });

    test('content that grows while pinned to the end stays pinned', () => {
        const { comp, pane } = makePane({ rows: 20 });

        pane.setPosY(1700);
        flush();
        expect(pane.isBottomMost).toBe(true);

        pane.changeContentSizeOnScrolling(0, 200, 0, 0);

        expect(pane.contentHeight).toBe(2200);
        expect(pane.posY).toBe(1900);
        expect(comp._container.positionY).toBe(-1900);
    });
});

describe('ScrollPane input', () => {
    test('a drag shorter than the sensitivity threshold is ignored', () => {
        const { comp, pane } = makePane({ rows: 20 });
        const stage = makeStage();
        stage.addChild(comp);

        pane.onTouchBegin(touch(0, 0));
        pane.onTouchMove(touch(0, -10, EventType.TOUCH_MOVE));

        expect(comp._container.positionY).toBe(0);
        expect(pane.isDragged).toBe(false);
    });

    test('a drag moves the content by the pointer delta', () => {
        const { comp, pane } = makePane({ rows: 20 });
        const stage = makeStage();
        stage.addChild(comp);

        pane.onTouchBegin(touch(0, 0));
        pane.onTouchMove(touch(0, -100, EventType.TOUCH_MOVE));

        expect(pane.isDragged).toBe(true);
        expect(comp._container.positionY).toBe(-100);
        expect(pane.posY).toBe(100);
    });

    test('the release flings, and the momentum decays by the dt it is given', () => {
        const { comp, pane } = makePane({ rows: 20 });
        const stage = makeStage();
        stage.addChild(comp);

        let scrollEnds = 0;
        comp.on(EventType.SCROLL_END, () => scrollEnds++);

        pane.onTouchBegin(touch(0, 0));
        pane.onTouchMove(touch(0, -100, EventType.TOUCH_MOVE));
        pane.onTouchEnd(touch(0, -100, EventType.TOUCH_END));

        expect(pane.isDragged).toBe(false);
        // The fling does not move anything until it is ticked.
        expect(comp._container.positionY).toBe(-100);
        expect(pane.posY).toBe(100);

        // 1000px/s of drag velocity, cubicOut over 1.3973s, aiming 559px on
        // from where the drag left off.
        pane.update(0.5);
        expect(comp._container.positionY).toBeCloseTo(-511, 9);
        expect(pane.posY).toBe(511);

        pane.update(0.5);
        expect(comp._container.positionY).toBeCloseTo(-647, 9);
        expect(pane.posY).toBe(647);
        expect(scrollEnds).toBe(0);

        pane.update(0.5);
        expect(comp._container.positionY).toBeCloseTo(-659, 9);
        expect(pane.posY).toBe(659);
        expect(scrollEnds).toBe(1);

        // The tween is over; further ticks change nothing.
        pane.update(0.5);
        expect(comp._container.positionY).toBeCloseTo(-659, 9);
        expect(scrollEnds).toBe(1);
    });

    test('a slow drag does not fling at all', () => {
        const { comp, pane } = makePane({ rows: 20 });
        const stage = makeStage();
        stage.addChild(comp);

        pane.onTouchBegin(touch(0, 0));
        pane.onTouchMove(touch(0, -25, EventType.TOUCH_MOVE));
        pane.onTouchEnd(touch(0, -25, EventType.TOUCH_END));

        pane.update(0.2);

        // The velocity is under the 500px/s threshold, so the drag simply stays
        // where it was released.
        expect(comp._container.positionY).toBe(-25);
        expect(pane.posY).toBe(25);
    });

    test('pulling past the end rebounds, and reports the release', () => {
        const { comp, pane } = makePane({ rows: 20 });
        const stage = makeStage();
        stage.addChild(comp);

        let pullUps = 0;
        comp.on(EventType.PULL_UP_RELEASE, () => pullUps++);

        pane.onTouchBegin(touch(0, 0));
        // 800px past the end, of which half is taken, capped at half the view.
        pane.onTouchMove(touch(0, -2500, EventType.TOUCH_MOVE));
        expect(comp._container.positionY).toBe(-1850);

        pane.onTouchEnd(touch(0, -2500, EventType.TOUCH_END));
        expect(pullUps).toBe(1);

        pane.update(0.5);
        expect(comp._container.positionY).toBe(-1700);
        expect(pane.posY).toBe(1700);
    });

    test('the wheel steps by the double of the scroll step', () => {
        const { pane } = makePane({ rows: 20 });

        pane.setPosY(100);
        flush();

        pane.onMouseWheel(wheel(1));
        expect(pane.posY).toBe(50);

        pane.onMouseWheel(wheel(-1));
        expect(pane.posY).toBe(100);

        pane.scrollStep = 10;
        pane.onMouseWheel(wheel(1));
        expect(pane.posY).toBe(80);
    });

    test('a wheel event is ignored once the wheel is disabled', () => {
        const { pane } = makePane({ rows: 20 });

        pane.setPosY(100);
        flush();

        pane.mouseWheelEnabled = false;
        pane.onMouseWheel(wheel(1));
        expect(pane.posY).toBe(100);
    });
});

describe('ScrollPane setup', () => {
    test('reads the scroll type and flags from the payload', () => {
        // Wider than the view, but no taller: a horizontal pane.
        const { pane } = makePane({ viewWidth: 200, viewHeight: 300, rows: 2, rowWidth: 400 });

        // Horizontal only, no bounce, inertia disabled.
        pane.setup(scrollConfig(ScrollType.Horizontal, 128 | 256));

        expect(pane.bouncebackEffect).toBe(false);
        expect(pane.snapToItem).toBe(false);
        expect(pane.contentWidth).toBe(400);

        pane.setPosX(100);
        flush();
        pane.onMouseWheel(wheel(1));
        expect(pane.posX).toBe(50);

        // There is no vertical overlap for the wheel to reach.
        expect(pane.posY).toBe(0);
    });

    test('destroy hands the container back to the owner', () => {
        const { comp, pane } = makePane({ rows: 6 });
        const container = comp._container;

        expect(container.parent).not.toBe(comp.node);

        pane.destroy();

        expect(container.parent).toBe(comp.node);
    });
});

// ---------------------------------------------------------------------------
// input wiring
// ---------------------------------------------------------------------------

describe('ScrollPane input wiring', () => {
    test('setup connects the pane to its owner', () => {
        // A pane is a collaborator that lives *on* its owner, not a node in the
        // display list, so nothing else routes input to it. Without these four
        // listeners it renders, moves its scroll bars, and ignores every drag —
        // every entry point is published and none of them is connected.
        const { comp, pane } = makePane({ rows: 20 });
        pane.setup(scrollConfig(ScrollType.Vertical, 16));

        for (const type of [
            EventType.TOUCH_BEGIN,
            EventType.TOUCH_MOVE,
            EventType.TOUCH_END,
            EventType.MOUSE_WHEEL,
        ]) {
            expect(comp.dispatcher.hasListener(type), `${type} listener`).toBe(true);
        }
    });

    test('a drag dispatched to the owner scrolls the content', () => {
        // The property that matters: not "a listener is registered" but "a drag
        // arriving through the owner's own event system moves the pane". The
        // other drag tests call `pane.onTouchBegin` directly and so never
        // exercised the connection.
        const { comp, pane } = makePane({ rows: 20 });
        pane.setup(scrollConfig(ScrollType.Vertical, 16));
        const stage = makeStage();
        stage.addChild(comp);

        comp.dispatchEvent(touch(0, 0));
        comp.dispatchEvent(touch(0, -100, EventType.TOUCH_MOVE));

        expect(pane.isDragged).toBe(true);
        expect(pane.posY).toBe(100);
    });

    test('tearing the pane down disconnects it', () => {
        const { comp, pane } = makePane({ rows: 20 });
        pane.setup(scrollConfig(ScrollType.Vertical, 16));
        pane.destroy();

        expect(comp.dispatcher.hasListener(EventType.TOUCH_BEGIN)).toBe(false);
    });
});

describe('ScrollPane ticking', () => {
    test('the tree drives the pane, so an overscroll springs back', () => {
        // `GRoot.update` reaches only its own children, so the walk continues in
        // `GComponent.onUpdate`. Without it, `startTween` sets a tween that
        // nothing advances: the content stays exactly where the drag left it,
        // and both the spring-back and the fling after a flick are dead.
        const { comp, pane } = makePane({ rows: 20 });
        pane.setup(scrollConfig(ScrollType.Vertical, 16 | 64)); // touch effect, bounce back
        const stage = makeStage();
        stage.addChild(comp);

        // Pull past the top, so the release has something to spring back from.
        comp.dispatchEvent(touch(0, 0));
        comp.dispatchEvent(touch(0, 40, EventType.TOUCH_MOVE));
        comp.dispatchEvent(touch(0, 80, EventType.TOUCH_MOVE));
        const pulled = comp._container.positionY;
        expect(pulled, 'pulled past the top').toBeGreaterThan(0);

        comp.dispatchEvent(touch(0, 80, EventType.TOUCH_END));

        // The spring-back is a tween; only ticking can finish it.
        for (let i = 0; i < 120; i++)
            comp.onUpdate(1 / 60);

        expect(comp._container.positionY, 'sprang back to the edge').toBeCloseTo(0, 6);
    });

    test('a flick keeps moving after the release', () => {
        // The other half of the same tween: momentum. Driven by `update` too.
        const { comp, pane } = makePane({ rows: 20 });
        pane.setup(scrollConfig(ScrollType.Vertical, 16 | 64));
        const stage = makeStage();
        stage.addChild(comp);

        comp.dispatchEvent(touch(0, 200));
        comp.dispatchEvent(touch(0, 160, EventType.TOUCH_MOVE));
        comp.dispatchEvent(touch(0, 120, EventType.TOUCH_MOVE));
        comp.dispatchEvent(touch(0, 120, EventType.TOUCH_END));

        const atRelease = pane.posY;

        for (let i = 0; i < 120; i++)
            comp.onUpdate(1 / 60);

        expect(pane.posY, 'coasted on past where the finger stopped').toBeGreaterThan(atRelease);
    });
});
