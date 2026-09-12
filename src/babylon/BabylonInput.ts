import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import type { InputProcessor } from '../core/event/InputProcessor.js';
import { Point } from '../core/utils/Geometry.js';

type Listener = (...args: never[]) => void;
interface EventTargetLike {
    addEventListener(type: string, listener: Listener, options?: boolean | { capture?: boolean; passive?: boolean }): void;
    removeEventListener(type: string, listener: Listener, options?: boolean | { capture?: boolean; passive?: boolean }): void;
}
interface CanvasLike extends EventTargetLike {
    getBoundingClientRect(): { left: number; top: number };
    setPointerCapture?(pointerId: number): void;
    releasePointerCapture?(pointerId: number): void;
    hasPointerCapture?(pointerId: number): boolean;
}
interface PointerLike {
    target: unknown; clientX: number; clientY: number; pointerId: number;
    button: number; buttons: number; stopPropagation(): void;
}
interface WheelLike {
    target: unknown; clientX: number; clientY: number; deltaY: number;
    stopPropagation(): void; preventDefault(): void;
}

function browserDocument(): EventTargetLike | null {
    const value = (globalThis as unknown as { document?: EventTargetLike }).document;
    return value && typeof value.addEventListener === 'function' ? value : null;
}

/** Binds a Babylon engine's browser canvas to FairyGUI input. */
export function bindBabylonInput(engine: AbstractEngine, input: InputProcessor): (() => void) | null {
    const canvas = engine.getRenderingCanvas() as CanvasLike | null;
    const document = browserDocument();
    if (!canvas || !document)
        return null;

    const scratch = new Point();
    let ownedPointer: number | null = null;
    const toUI = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const overUI = (x: number, y: number): boolean => input.owner.hitTest(scratch.setTo(x, y)) !== null;
    const claim = (event: { stopPropagation(): void }): void => event.stopPropagation();

    const onPointerDown = ((event: PointerLike): void => {
        if (event.target !== canvas) return;
        try { canvas.setPointerCapture?.(event.pointerId); } catch { /* detached/synthetic canvas */ }
        const { x, y } = toUI(event);
        if (overUI(x, y)) { ownedPointer = event.pointerId; claim(event); }
        input.touchBegin(event.pointerId, x, y, event.button);
    }) as unknown as Listener;
    const onPointerMove = ((event: PointerLike): void => {
        if (event.target !== canvas) return;
        const { x, y } = toUI(event);
        if (ownedPointer === event.pointerId) claim(event);
        if (event.buttons !== 0) input.touchMove(event.pointerId, x, y);
        else input.mouseMove(x, y);
    }) as unknown as Listener;
    const onPointerEnd = ((event: PointerLike): void => {
        if (event.target !== canvas) return;
        const { x, y } = toUI(event);
        if (ownedPointer === event.pointerId) { claim(event); ownedPointer = null; }
        if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture?.(event.pointerId);
        input.touchEnd(event.pointerId, x, y);
    }) as unknown as Listener;
    const onWheel = ((event: WheelLike): void => {
        if (event.target !== canvas) return;
        const { x, y } = toUI(event);
        if (overUI(x, y)) { claim(event); event.preventDefault(); }
        input.mouseWheel(event.deltaY > 0 ? 1 : -1, x, y);
    }) as unknown as Listener;

    const capture = true;
    document.addEventListener('pointerdown', onPointerDown, capture);
    document.addEventListener('pointermove', onPointerMove, capture);
    document.addEventListener('pointerup', onPointerEnd, capture);
    document.addEventListener('pointercancel', onPointerEnd, capture);
    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => {
        document.removeEventListener('pointerdown', onPointerDown, capture);
        document.removeEventListener('pointermove', onPointerMove, capture);
        document.removeEventListener('pointerup', onPointerEnd, capture);
        document.removeEventListener('pointercancel', onPointerEnd, capture);
        document.removeEventListener('wheel', onWheel, { capture: true, passive: false });
        ownedPointer = null;
    };
}
