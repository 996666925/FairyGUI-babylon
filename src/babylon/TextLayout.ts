import { AlignType, AutoSizeType, VertAlignType } from '../core/FieldTypes.js';

import type { BitmapFont } from '../core/display/BitmapFont.js';

/**
 * A structural stand-in for `CanvasRenderingContext2D`.
 *
 * The project compiles with `lib: ["ES2022"]` and no DOM lib, so the DOM types
 * are not in scope. Declaring only the handful of members this backend touches
 * keeps the browser path type-safe *and* lets a test pass a hand-written stub —
 * which is the same seam the headless tests use.
 */
export interface Canvas2DContextLike {
    font: string;
    textAlign: string;
    textBaseline: string;
    fillStyle: unknown;
    strokeStyle: unknown;
    lineWidth: number;
    globalAlpha: number;
    save(): void;
    restore(): void;
    scale(x: number, y: number): void;
    translate(x: number, y: number): void;
    clearRect(x: number, y: number, w: number, h: number): void;
    fillRect(x: number, y: number, w: number, h: number): void;
    strokeRect(x: number, y: number, w: number, h: number): void;
    /**
     * The `fontBoundingBox*` pair is the *font's* ascent and descent, which is
     * what placing a line depends on; the `actualBoundingBox*` pair is the ink
     * of the measured text, which sits inside it. Both are optional because a
     * headless stub need not offer either.
     */
    measureText(text: string): {
        width: number;
        fontBoundingBoxAscent?: number;
        fontBoundingBoxDescent?: number;
        actualBoundingBoxAscent?: number;
        actualBoundingBoxDescent?: number;
    };
    fillText(text: string, x: number, y: number): void;
    strokeText?(text: string, x: number, y: number): void;
    beginPath?(): void;
    moveTo?(x: number, y: number): void;
    lineTo?(x: number, y: number): void;
    stroke?(): void;
}

/** A structural stand-in for `HTMLCanvasElement` / `OffscreenCanvas`. */
export interface CanvasLike {
    width: number;
    height: number;
    getContext(contextId: '2d'): Canvas2DContextLike | null;
}

/** Creates a rasterisation surface. Injected so headless tests can opt out of the DOM. */
export type CanvasFactory = (width: number, height: number) => CanvasLike;

/** The font attributes a measurement depends on. */
export interface TextStyle {
    font: string | null;
    fontSize: number;
    /** `"bold"`, `"italic"`, `"bolditalic"` or `""`. */
    fontStyle: string;
}

/**
 * Everything the text layout needs from the outside world.
 *
 * Keeping this an interface is what makes line breaking testable in Node: a stub
 * that reports a fixed width per character exercises every wrapping and alignment
 * rule without a canvas, a font file or a GPU.
 */
export interface ITextMetricsProvider {
    /** Advance width of `text` in the given style, in pixels, **excluding** letter spacing. */
    measure(text: string, style: TextStyle): number;
    /** Natural line height — ascent plus descent — for the style, in pixels. */
    lineHeight(style: TextStyle): number;
}

/** Inputs to {@link layoutText}. Every value is a plain number or string. */
export interface TextLayoutInput {
    text: string;
    style: TextStyle;
    /** `AlignType`: 0 left, 1 centre, 2 right. */
    align: number;
    /** `VertAlignType`: 0 top, 1 middle, 2 bottom. */
    verticalAlign: number;
    singleLine: boolean;
    letterSpacing: number;
    leading: number;
    /** Explicit wrap width from the package; `0` means "not set". */
    wrapWidth: number;
    /** `AutoSizeType`: 0 none, 1 both, 2 height, 3 shrink. */
    autoSize: number;
    /** The object's current content box, used when auto-sizing is off. */
    boxWidth: number;
    boxHeight: number;
}

/** One laid-out line. */
export interface TextLine {
    text: string;
    /** Rendered width, letter spacing included. */
    width: number;
    /**
     * Offset of the line's first character in the layout's newline-normalised
     * input. Exact, including across blank lines and dropped break spaces, which
     * is what link hit testing needs.
     */
    start: number;
}

/** The result of {@link layoutText}. */
export interface TextLayout {
    lines: TextLine[];
    /** The width wrapping was performed against; `0` when unlimited. */
    wrapWidth: number;
    /** Widest rendered line. */
    textWidth: number;
    /** Total rendered height, leading included. */
    textHeight: number;
    /** Ascent-to-descent distance of one line. */
    lineHeight: number;
    /** Line advance: `lineHeight + leading`. */
    lineStep: number;
    /** Width the object should adopt for its auto-size mode. */
    boxWidth: number;
    /** Height the object should adopt for its auto-size mode. */
    boxHeight: number;
}

/** A `<a href=…>` span, in coordinates of the tag-free text. */
export interface TextLink {
    start: number;
    end: number;
    href: string;
}

/** The text as it should be laid out, plus the links the markup declared. */
export interface StrippedMarkup {
    text: string;
    links: TextLink[];
}

/**
 * Removes UBB/HTML-ish markup and records `<a href>` spans.
 *
 * Deliberately minimal: tags are dropped, `<br>` becomes a newline, and anchors
 * are remembered so `onLinkClick` has something to fire with. Per-tag styling
 * (colours, size changes, embedded images) is *not* applied — a run with mixed
 * styles would need a per-run layout model that `ITextObject` does not describe.
 * Character entities are left as written.
 */
export function stripMarkup(source: string): StrippedMarkup {
    const links: TextLink[] = [];
    let out = '';
    let openStart = -1;
    let openHref: string | null = null;

    let i = 0;
    while (i < source.length) {
        const ch = source.charAt(i);
        if (ch !== '<') {
            // Carriage returns are dropped so the stripped text is LF-only: link
            // offsets are indices into this string, and a CRLF would shift every
            // one of them on Windows-authored content.
            if (ch !== '\r')
                out += ch;
            i++;
            continue;
        }

        const close = source.indexOf('>', i + 1);
        if (close === -1) {
            // Unterminated tag: treat the rest as literal text.
            out += source.substring(i);
            break;
        }

        const tag = source.substring(i + 1, close).trim();
        const lower = tag.toLowerCase();

        if (lower === 'br' || lower === 'br/' || lower === 'br /') {
            out += '\n';
        } else if (lower === '/a') {
            if (openStart >= 0 && openHref !== null) {
                links.push({ start: openStart, end: out.length, href: openHref });
                openStart = -1;
                openHref = null;
            }
        } else if (lower === 'a' || lower.startsWith('a ') || lower.startsWith('a\t')) {
            openStart = out.length;
            openHref = readHref(tag) ?? '';
        }

        i = close + 1;
    }

    if (openStart >= 0) {
        // An anchor left open links to the end of the run.
        links.push({ start: openStart, end: out.length, href: openHref ?? '' });
    }

    return { text: out, links };
}

/** Pulls the value out of `href="…"`, `href='…'` or a bare `href=…`. */
function readHref(tag: string): string | null {
    const match = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (!match)
        return null;
    return match[1] ?? match[2] ?? match[3] ?? null;
}

/** The horizontal offset of a line inside a box of `boxWidth`. */
export function lineOffsetX(lineWidth: number, boxWidth: number, align: number): number {
    if (align === AlignType.Center)
        return (boxWidth - lineWidth) / 2;
    if (align === AlignType.Right)
        return boxWidth - lineWidth;
    return 0;
}

/** The vertical offset of the whole text block inside a box of `boxHeight`. */
export function lineOffsetY(textHeight: number, boxHeight: number, verticalAlign: number): number {
    if (verticalAlign === VertAlignType.Middle)
        return (boxHeight - textHeight) / 2;
    if (verticalAlign === VertAlignType.Bottom)
        return boxHeight - textHeight;
    return 0;
}

/** A run that may be broken at either end: a word, a whitespace run, or one ideograph. */
interface Token {
    text: string;
    /** Index of the token's first character within its paragraph. */
    start: number;
    /** Whitespace is dropped at the end of a line rather than carried to the next. */
    space: boolean;
    /** A word may be split mid-run when it alone exceeds the wrap width. */
    splittable: boolean;
}

/** Whether a code point takes a line break on either side without needing spaces. */
function isIdeographic(code: number): boolean {
    return (code >= 0x2e80 && code <= 0x9fff)
        || (code >= 0xac00 && code <= 0xd7af)
        || (code >= 0xf900 && code <= 0xfaff)
        || (code >= 0xff00 && code <= 0xff60);
}

/** Strips trailing whitespace, which a line break always consumes. */
function trimEnd(text: string): string {
    let end = text.length;
    while (end > 0 && isSpace(text.charAt(end - 1)))
        end--;
    return end === text.length ? text : text.substring(0, end);
}

function isSpace(ch: string): boolean {
    // ASCII space, tab, no-break space, ideographic space.
    return ch === ' ' || ch === '\t' || ch === '\u00a0' || ch === '\u3000';
}

/** Splits a paragraph into break-atom tokens. */
export function tokenizeParagraph(paragraph: string): Token[] {
    const tokens: Token[] = [];
    let word = '';
    let wordStart = 0;

    const flushWord = (): void => {
        if (word.length > 0) {
            tokens.push({ text: word, start: wordStart, space: false, splittable: true });
            word = '';
        }
    };

    for (let i = 0; i < paragraph.length; i++) {
        const ch = paragraph.charAt(i);
        if (isSpace(ch)) {
            flushWord();
            const last = tokens[tokens.length - 1];
            if (last && last.space)
                last.text += ch;
            else
                tokens.push({ text: ch, start: i, space: true, splittable: false });
        } else if (isIdeographic(paragraph.codePointAt(i) as number)) {
            flushWord();
            tokens.push({ text: ch, start: i, space: false, splittable: false });
        } else {
            if (word.length === 0)
                wordStart = i;
            word += ch;
        }
    }
    flushWord();
    return tokens;
}

/** Collapses CRLF and lone CR to LF so offsets are stable across platforms. */
export function normalizeNewlines(text: string): string {
    return text.replace(/\r\n|\r/g, '\n');
}

/**
 * Breaks, wraps and measures text.
 *
 * Pure: it reads nothing but its arguments and the injected metrics, and it
 * commits nothing. `ITextObject.measureTextWidth` / `measureTextHeight` are
 * expected to be called *before* a layout is applied, which is only possible
 * because of that.
 */
export function layoutText(input: TextLayoutInput, metrics: ITextMetricsProvider): TextLayout {
    const style = input.style;
    const spacing = Math.max(0, input.letterSpacing);
    const leading = Math.max(0, input.leading);

    const widthOf = (text: string): number =>
        text.length === 0 ? 0 : metrics.measure(text, style) + spacing * (text.length - 1);

    // Which width to wrap against. An explicit wrap width always wins; otherwise
    // the two "hug the content" auto-size modes leave the text unwrapped.
    let wrap = 0;
    if (!input.singleLine) {
        if (input.wrapWidth > 0)
            wrap = input.wrapWidth;
        else if (input.autoSize === AutoSizeType.Both || input.autoSize === AutoSizeType.Shrink)
            wrap = 0;
        else
            wrap = input.boxWidth;
    }

    // Newlines are normalised first so the offsets reported on each line index
    // into a string the caller can reproduce.
    const normalized = normalizeNewlines(input.text);
    const paragraphs = normalized.split('\n');
    const runs: string[] = input.singleLine
        ? [paragraphs.join('')]
        : paragraphs;

    const lines: TextLine[] = [];
    if (wrap <= 0) {
        let base = 0;
        for (const paragraph of runs) {
            lines.push({ text: paragraph, width: widthOf(paragraph), start: base });
            base += paragraph.length + 1;
        }
    } else if (input.singleLine) {
        wrapParagraph(runs[0] ?? '', 0, wrap, metrics, style, spacing, widthOf, lines);
    } else {
        let base = 0;
        for (const paragraph of runs) {
            wrapParagraph(paragraph, base, wrap, metrics, style, spacing, widthOf, lines);
            base += paragraph.length + 1;
        }
    }

    let textWidth = 0;
    for (const line of lines) {
        if (line.width > textWidth)
            textWidth = line.width;
    }

    const lineHeight = Math.max(1, metrics.lineHeight(style));
    const lineStep = lineHeight + leading;
    // The block is made of whole line boxes: each line owns a `lineStep`-tall
    // one, so the last line carries its leading below it too. The reference's
    // `lineHeight = fontSize + leading` measured the same thing and the engine
    // sized its node to a whole number of them — whereas a block that stopped at
    // the ink left every line's text pinned to the top of its box.
    const textHeight = lines.length === 0 ? 0 : lines.length * lineStep;

    // Auto-size decides which of the measured and the declared box wins.
    let boxWidth: number;
    let boxHeight: number;
    switch (input.autoSize) {
        case AutoSizeType.Both:
        case AutoSizeType.Shrink:
            boxWidth = textWidth;
            boxHeight = textHeight;
            break;
        case AutoSizeType.Height:
            boxWidth = input.boxWidth;
            boxHeight = textHeight;
            break;
        default:
            boxWidth = input.boxWidth;
            boxHeight = input.boxHeight;
            break;
    }

    return { lines, wrapWidth: wrap, textWidth, textHeight, lineHeight, lineStep, boxWidth, boxHeight };
}

function wrapParagraph(
    paragraph: string,
    base: number,
    wrap: number,
    metrics: ITextMetricsProvider,
    style: TextStyle,
    spacing: number,
    widthOf: (text: string) => number,
    out: TextLine[],
): void {
    const tokens = tokenizeParagraph(paragraph);
    if (tokens.length === 0) {
        out.push({ text: '', width: 0, start: base });
        return;
    }

    let current = '';
    /** Sum of the tokens' own advances; letter spacing is added once at the end. */
    let currentSum = 0;
    /** Offset of `current`'s first character, or `-1` while the line is empty. */
    let currentStart = -1;

    const flush = (): void => {
        // A break consumes the run of spaces that triggered it, so trailing
        // whitespace never reaches the line — and never widens its measurement.
        // The width is re-measured from the trimmed text rather than taken from
        // the running token sum, which also picks up any kerning across the
        // token boundaries the wrapping introduced.
        const text = trimEnd(current);
        out.push({
            text,
            width: text.length === 0 ? 0 : widthOf(text),
            start: currentStart < 0 ? base : base + currentStart,
        });
        current = '';
        currentSum = 0;
        currentStart = -1;
    };

    for (const token of tokens) {
        if (current.length === 0 && token.space)
            continue; // never start a line with the space that caused the break

        const tokenWidth = widthOf(token.text);

        if (current.length > 0 && currentSum + spacing * (current.length - 1) + tokenWidth > wrap + 1e-6) {
            if (token.space)
                continue; // the break consumes the space
            flush();
        }

        if (tokenWidth > wrap && token.splittable) {
            for (let i = 0; i < token.text.length; i++) {
                const ch = token.text.charAt(i);
                const chWidth = metrics.measure(ch, style);
                if (current.length > 0 && currentSum + spacing * (current.length - 1) + chWidth > wrap + 1e-6)
                    flush();
                if (current.length === 0)
                    currentStart = token.start + i;
                current += ch;
                currentSum += chWidth;
            }
            continue;
        }

        if (current.length === 0)
            currentStart = token.start;
        current += token.text;
        currentSum += tokenWidth;
    }

    flush();
}

/**
 * The default provider: canvas 2D `measureText`.
 *
 * Built on a 1×1 scratch canvas created through the injected {@link CanvasFactory}
 * so this class never touches the DOM directly. Metrics are memoised per
 * `(font string, text)` pair, which matters because line breaking measures the
 * same short runs over and over.
 */
export class CanvasTextMetrics implements ITextMetricsProvider {
    private readonly _createCanvas: CanvasFactory;
    private _ctx: Canvas2DContextLike | null = null;
    private readonly _widths = new Map<string, number>();
    private readonly _heights = new Map<string, number>();

    public constructor(createCanvas: CanvasFactory) {
        this._createCanvas = createCanvas;
    }

    /** The `font` shorthand for a style, as CSS spells it. */
    public static fontString(style: TextStyle): string {
        const parts: string[] = [];
        const s = (style.fontStyle ?? '').toLowerCase();
        if (s.includes('bold'))
            parts.push('bold');
        if (s.includes('italic'))
            parts.push('italic');
        parts.push(`${style.fontSize > 0 ? style.fontSize : 12}px`);
        parts.push(style.font ?? 'sans-serif');
        return parts.join(' ');
    }

    public measure(text: string, style: TextStyle): number {
        if (text.length === 0)
            return 0;
        const key = CanvasTextMetrics.fontString(style) + '\u0000' + text;
        const cached = this._widths.get(key);
        if (cached !== undefined)
            return cached;

        const ctx = this._context(style);
        const width = ctx ? ctx.measureText(text).width : text.length * style.fontSize * 0.5;
        this._widths.set(key, width);
        return width;
    }

    /**
     * The height of one line: the em square, at least.
     *
     * The reference's line height was `fontSize + leading`, and its glyphs sat
     * centred in that — so `ITextObject.lineHeight` has to be the em square for
     * the two to describe the same box. Measuring 'Mg' instead reports the
     * *ink*, which for a Latin face is about a pixel smaller than the em: every
     * line box came out a pixel short and every line of text sat half a pixel
     * high, compounding with each line in a wrapped run.
     *
     * The ink is a floor rather than a replacement, because a face with taller
     * ink than its em (a CJK face, say) still needs the box to hold it or the
     * raster would clip the very overhang its margin exists to keep.
     */
    public lineHeight(style: TextStyle): number {
        const key = CanvasTextMetrics.fontString(style);
        const cached = this._heights.get(key);
        if (cached !== undefined)
            return cached;

        const ctx = this._context(style);
        let height = style.fontSize > 0 ? style.fontSize : 12;
        if (ctx) {
            const m = ctx.measureText('Mg');
            const ascent = m.actualBoundingBoxAscent;
            const descent = m.actualBoundingBoxDescent;
            if (typeof ascent === 'number' && typeof descent === 'number' && ascent + descent > 0)
                height = Math.max(height, ascent + descent);
        }
        this._heights.set(key, height);
        return height;
    }

    /** Drops the memo tables; call after a webfont finishes loading. */
    public clearCache(): void {
        this._widths.clear();
        this._heights.clear();
    }

    private _context(style: TextStyle): Canvas2DContextLike | null {
        if (this._ctx)
            this._ctx.font = CanvasTextMetrics.fontString(style);
        else {
            const canvas = this._createCanvas(1, 1);
            this._ctx = canvas.getContext('2d');
            if (this._ctx)
                this._ctx.font = CanvasTextMetrics.fontString(style);
        }
        return this._ctx;
    }
}

/**
 * Metrics for a package font whose glyphs are images.
 *
 * The layout module knows nothing about a font beyond these two numbers, so a
 * bitmap font drives wrapping, alignment and auto-sizing down exactly the same
 * path a system font does — the numbers just come from the item's own table
 * instead of from a canvas.
 *
 * {@link advance} is the one place the pen rule lives: the layout broke its
 * lines with the measurement, and the geometry advances the pen with the same
 * arithmetic, so the two cannot drift apart.
 */
export class BitmapTextMetrics implements ITextMetricsProvider {
    private _font: BitmapFont;

    public constructor(font: BitmapFont) {
        this._font = font;
    }

    /** Re-points the provider; one instance serves every field on a font. */
    public setFont(font: BitmapFont): void {
        this._font = font;
    }

    public get font(): BitmapFont {
        return this._font;
    }

    /**
     * Uniform glyph scale.
     *
     * A font that cannot scale is drawn at the size its glyphs were rasterised
     * at, whatever was asked for. `GTextField` has already snapped the size it
     * passes down, so this is only the backend's own guard for a surface driven
     * directly.
     */
    public scale(fontSize: number): number {
        const font = this._font;
        if (!font.resizable)
            return 1;
        return font.size > 0 ? fontSize / font.size : 1;
    }

    /** Pen advance of one UTF-16 code unit, before letter spacing. */
    public advance(charCode: number, fontSize: number): number {
        const font = this._font;
        const glyph = font.glyph(charCode);
        if (glyph)
            return font.advanceOf(glyph) * this.scale(fontSize);

        // A character with no image of its own. The reference advanced by
        // nothing at all, which runs "1 2" together as "12"; a space is given
        // half the font size instead, which is the rule the Egret runtime used.
        return charCode === 32 || charCode === 9 ? fontSize * 0.5 : 0;
    }

    public measure(text: string, style: TextStyle): number {
        let width = 0;
        for (let i = 0; i < text.length; i++)
            width += this.advance(text.charCodeAt(i), style.fontSize);
        return width;
    }

    public lineHeight(style: TextStyle): number {
        return this._font.lineHeight * this.scale(style.fontSize);
    }
}

/**
 * The canvas factory used when the host does not supply one.
 *
 * Prefers `OffscreenCanvas`, falls back to a detached `<canvas>`, and finally to
 * `null` — which lets an environment with neither (a bare Node process) still
 * construct a renderer, with text metrics degrading to a per-character estimate.
 */
export function defaultCanvasFactory(): CanvasFactory | null {
    const g = globalThis as unknown as {
        OffscreenCanvas?: new (w: number, h: number) => CanvasLike;
        document?: { createElement(tag: string): CanvasLike };
    };

    if (typeof g.OffscreenCanvas === 'function') {
        const Ctor = g.OffscreenCanvas;
        return (w, h) => new Ctor(Math.max(1, w), Math.max(1, h));
    }
    if (g.document && typeof g.document.createElement === 'function') {
        const doc = g.document;
        return (w, h) => {
            const canvas = doc.createElement('canvas');
            canvas.width = Math.max(1, w);
            canvas.height = Math.max(1, h);
            return canvas;
        };
    }
    return null;
}

/**
 * A provider for environments with no canvas at all.
 *
 * Uses a crude per-character estimate so a headless renderer can still lay text
 * out deterministically; a real deployment always has a canvas.
 */
export class EstimatedTextMetrics implements ITextMetricsProvider {
    public measure(text: string, style: TextStyle): number {
        let width = 0;
        for (const ch of text)
            width += isIdeographic(ch.codePointAt(0) as number) || ch.charCodeAt(0) > 0x7f ? style.fontSize : style.fontSize * 0.5;
        return width;
    }

    public lineHeight(style: TextStyle): number {
        return style.fontSize * 1.2;
    }
}
