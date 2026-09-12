import { AlignType } from '../core/FieldTypes.js';
import type { Color } from '../core/utils/Color.js';

/*
 * Every DOM shape used here is declared structurally rather than pulled from
 * the DOM lib. This library compiles without it — `lib` is `ES2022` only, which
 * keeps DOM APIs out of `src/core/` entirely — and `TextLayout` reaches for
 * `OffscreenCanvas` and `document` the same way.
 */

/** Accepts any handler; the spread of `never` makes every signature assignable. */
type Handler = (...args: never[]) => void;

interface ElementLike {
    value: string;
    maxLength: number;
    placeholder?: string;
    /** The inline style object; assigned by property. */
    style: Record<string, string>;
    type?: string;
    wrap?: string;
    focus(): void;
    remove(): void;
    append(child: ElementLike): void;
    addEventListener(type: string, handler: Handler, capture?: boolean): void;
    removeEventListener(type: string, handler: Handler, capture?: boolean): void;
    setSelectionRange(start: number, end: number): void;
}

interface DocumentLike {
    body: { append(child: ElementLike): void };
    createElement(tag: string): ElementLike;
    addEventListener(type: string, handler: Handler, capture?: boolean): void;
    removeEventListener(type: string, handler: Handler, capture?: boolean): void;
}

/** The only thing needed of the canvas: where it sits on the page. */
export interface CanvasOffsetLike {
    getBoundingClientRect(): { left: number; top: number };
}

/** What a text field hands over when the user starts typing in it. */
export interface NativeInputOptions {
    /** The canvas the UI is drawn into; positioned against its page rect. */
    canvas: CanvasOffsetLike | null;
    /** The field's rect in UI units — which are CSS pixels, origin top-left. */
    rect: { x: number; y: number; width: number; height: number };
    text: string;
    font: string | null;
    fontSize: number;
    /** `"bold"`, `"italic"`, `"bolditalic"` or `""`. */
    fontStyle: string;
    color: Color;
    align: AlignType;
    /** Extra space between characters, in pixels; `0` for none. */
    letterSpacing: number;
    /** The line box the field lays its text out in, in pixels. */
    lineHeight: number;
    /** Drawn in the field's place while it is empty, if it has one. */
    promptText: string;
    /** Whether Enter should insert a newline rather than submit. */
    multiline: boolean;
    password: boolean;
    /** `-1` for no limit. */
    maxLength: number;
    onText(text: string): void;
    onSubmit(text: string, keyCode: number): void;
    /** Called once the field is dismissed, however it was dismissed. */
    onClose(): void;
}

interface OpenInput {
    element: ElementLike;
    detach(): void;
}

/**
 * The DOM element currently standing in for a text field, if any.
 *
 * One at a time, globally: focusing a second field closes the first, which is
 * what a real text input does and what keeps the focus handling honest.
 */
let open: OpenInput | null = null;

/** Closes whatever field is open. Safe to call when none is. */
export function closeNativeInput(): void {
    open?.detach();
}

/** Whether a native text field is currently open. */
export function hasNativeInput(): boolean {
    return open !== null;
}

/**
 * Puts a real DOM input over a UI text field.
 *
 * The UI is drawn into a canvas, so there is nothing to type into: a canvas has
 * no caret, no selection, no IME and no clipboard. The usual answer — and the
 * one taken here — is to overlay an `<input>` on the field, style it to match,
 * and copy what it holds back into the display list as the user types.
 *
 * The overlay is positioned in **page coordinates**: the field's rect is in UI
 * units, which are CSS pixels relative to the canvas, so adding the canvas's own
 * page offset puts the element exactly over the field.
 *
 * Only one field is open at a time; opening another closes the first.
 *
 * @returns whether an element was actually put up. A host with no DOM gets
 *   , which is what tells the field to keep drawing its own text.
 */
export function openNativeInput(options: NativeInputOptions): boolean {
    closeNativeInput();

    const doc = (globalThis as unknown as { document?: DocumentLike }).document;
    if (!doc || typeof doc.createElement !== 'function')
        return false;

    const rect = options.rect;
    const isMultiline = options.multiline;

    const element = doc.createElement(isMultiline ? 'textarea' : 'input');
    if (isMultiline)
        element.wrap = 'soft';
    else
        element.type = options.password ? 'password' : 'text';

    if (options.maxLength >= 0)
        element.maxLength = options.maxLength;
    element.value = options.text;

    const canvasRect = options.canvas?.getBoundingClientRect();
    const style = element.style;
    style.position = 'absolute';
    style.left = `${(canvasRect?.left ?? 0) + rect.x}px`;
    style.top = `${(canvasRect?.top ?? 0) + rect.y}px`;
    style.width = `${Math.max(1, rect.width)}px`;
    style.height = `${Math.max(1, rect.height)}px`;
    style.margin = '0';
    style.padding = '0';
    style.border = '0';
    style.outline = 'none';
    style.background = 'transparent';
    style.resize = 'none';
    style.overflow = 'hidden';
    style.zIndex = '10';
    // The overlay draws the text itself while it is open — field, caret and
    // selection then come from one renderer and cannot disagree. It used to be
    // left transparent with the canvas drawing the text underneath, which put
    // the browser's line layout and the runtime's side by side: the caret and
    // the selection highlight landed a few pixels from the glyphs they belonged
    // to. The field suppresses its own raster for as long as this is open.
    style.color = `rgba(${options.color.r}, ${options.color.g}, ${options.color.b}, ${options.color.a / 255})`;
    style.caretColor = `rgba(${options.color.r}, ${options.color.g}, ${options.color.b}, 1)`;
    style.textAlign = options.align === AlignType.Center
        ? 'center'
        : options.align === AlignType.Right ? 'right' : 'left';
    style.font = buildFont(options);
    // Spacing the runtime applies by advancing the pen, so the same text takes
    // the same room in both.
    if (options.letterSpacing !== 0)
        style.letterSpacing = `${options.letterSpacing}px`;
    if (options.lineHeight > 0)
        style.lineHeight = `${options.lineHeight}px`;
    if (options.promptText)
        element.placeholder = options.promptText;

    doc.body.append(element);

    const onInput = (): void => options.onText(element.value);
    const onKeyDown = (event: { key: string; keyCode: number }): void => {
        if (event.key === 'Enter' && !isMultiline)
            options.onSubmit(element.value, event.keyCode);
        else if (event.key === 'Escape')
            closeNativeInput();
    };
    // A click anywhere else means the user has moved on.
    const onPointerDown = (event: { target: unknown }): void => {
        if (event.target !== element)
            closeNativeInput();
    };

    element.addEventListener('input', onInput);
    element.addEventListener('keydown', onKeyDown as Handler);
    // Deferred: the click that opened the field is still propagating.
    setTimeout(() => doc.addEventListener('pointerdown', onPointerDown as Handler, true), 0);

    open = {
        element,
        detach: () => {
            element.removeEventListener('input', onInput);
            element.removeEventListener('keydown', onKeyDown as Handler);
            doc.removeEventListener('pointerdown', onPointerDown as Handler, true);
            element.remove();
            open = null;
            options.onClose();
        },
    };

    element.focus();
    try {
        element.setSelectionRange(element.value.length, element.value.length);
    } catch {
        // `setSelectionRange` is not offered by every input type.
    }

    return true;
}

function buildFont(options: NativeInputOptions): string {
    const parts: string[] = [];
    const s = options.fontStyle.toLowerCase();
    if (s.includes('bold'))
        parts.push('bold');
    if (s.includes('italic'))
        parts.push('italic');
    parts.push(`${options.fontSize > 0 ? options.fontSize : 12}px`);
    parts.push(options.font ?? 'sans-serif');
    return parts.join(' ');
}
