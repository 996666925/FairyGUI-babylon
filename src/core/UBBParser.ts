/**
 * A tag handler, invoked once per recognised tag.
 *
 * @param tagName lowercase tag name, without the brackets or any `=attr`.
 * @param end     `true` for the closing form (`[/b]`).
 * @param attr    everything after the first `=`, or `null` when absent.
 * @returns the markup to substitute, or `null` to emit nothing at all.
 */
export type UBBTagHandler = (tagName: string, end: boolean, attr: string | null) => string | null;

/**
 * FairyGUI's UBB markup scanner.
 *
 * Rewrites `[b]…[/b]`-style BBCode into the HTML-ish markup a rich text surface
 * understands. It is a single-pass scanner with no nesting state of its own: an
 * opening tag emits its markup, a closing tag emits the closing form, and the
 * layout engine that receives the result does the matching.
 *
 * `parse()`'s second argument is the reference's `remove` flag. With
 * `remove = true` a recognised tag is consumed and **not** re-emitted, which
 * leaves plain text — that is how `GTextField` and `GTextInput` use it, to drop
 * markup their plain-text surface would otherwise show literally.
 * `GRichTextField` leaves it falsy so the markup survives.
 *
 * A parser carries per-call state (`_readPos`, `lastColor`, `lastSize`) and is
 * therefore not re-entrant. The reference shares one instance through
 * `UBBParser.inst`, and so does this port; `lastColor`/`lastSize` are read by
 * callers after `parse()` returns.
 */
export class UBBParser {
    /** The shared instance, matching the reference's `UBBParser.inst`. */
    public static inst: UBBParser = new UBBParser();

    /** Attribute of the last `[color]` seen by `parse()`, or `null`. */
    public lastColor: string | null = null;
    /** Attribute of the last `[size]` seen by `parse()`, or `null`. */
    public lastSize: string | null = null;
    /** Whether `[url]` underlines its link text. */
    public linkUnderline = false;
    /** Colour `[url]` tints its link text with, or `null` for none. */
    public linkColor: string | null = null;

    protected _handlers: Record<string, UBBTagHandler> = {};

    private _text: string | null = null;
    private _readPos = 0;

    public constructor() {
        this._handlers['url'] = this.onTag_URL;
        this._handlers['img'] = this.onTag_IMG;
        this._handlers['b'] = this.onTag_Simple;
        this._handlers['i'] = this.onTag_Simple;
        this._handlers['u'] = this.onTag_Simple;
        this._handlers['color'] = this.onTag_COLOR;
        this._handlers['size'] = this.onTag_SIZE;
    }

    protected onTag_URL(_tagName: string, end: boolean, attr: string | null): string | null {
        if (!end) {
            let ret: string;
            if (attr != null)
                ret = '<on click="onClickLink" param="' + attr + '">';
            else {
                // `[url]text[/url]`: the link target is the tag's own text.
                // `getTagText()` can come back null (no closing `[`), and the
                // reference concatenated that straight into the attribute.
                const href = this.getTagText();
                ret = '<on click="onClickLink" param="' + href + '">';
            }
            if (this.linkUnderline)
                ret += '<u>';
            if (this.linkColor)
                ret += '<color=' + this.linkColor + '>';
            return ret;
        }

        let ret = '';
        if (this.linkColor)
            ret += '</color>';
        if (this.linkUnderline)
            ret += '</u>';
        ret += '</on>';
        return ret;
    }

    protected onTag_IMG(_tagName: string, end: boolean, _attr: string | null): string | null {
        if (!end) {
            const src = this.getTagText(true);
            if (!src)
                return null;

            return '<img src="' + src + '"/>';
        }
        return null;
    }

    protected onTag_Simple(tagName: string, end: boolean, _attr: string | null): string | null {
        return end ? ('</' + tagName + '>') : ('<' + tagName + '>');
    }

    protected onTag_COLOR(_tagName: string, end: boolean, attr: string | null): string | null {
        if (!end) {
            this.lastColor = attr;
            return '<color=' + attr + '>';
        }
        return '</color>';
    }

    /**
     * Never registered by default — the reference leaves `_handlers["font"]`
     * commented out — but kept because it is part of the class's surface and a
     * subclass may want it.
     */
    protected onTag_FONT(_tagName: string, end: boolean, attr: string | null): string | null {
        if (!end)
            return '<font face="' + attr + '">';
        return '</font>';
    }

    protected onTag_SIZE(_tagName: string, end: boolean, attr: string | null): string | null {
        if (!end) {
            this.lastSize = attr;
            return '<size=' + attr + '>';
        }
        return '</size>';
    }

    /**
     * Consumes raw text up to the next unescaped `[`.
     *
     * A `\` immediately before a `[` unescapes it, so `\[` reads as a literal
     * bracket. Returns `null` when no further `[` exists.
     *
     * @param remove when true, leaves `_readPos` at the bracket so the caller's
     *   next iteration continues from there rather than from here.
     */
    protected getTagText(remove?: boolean): string | null {
        const text = this._text!;
        let pos1 = this._readPos;
        let pos2 = -1;
        let result = '';
        while ((pos2 = text.indexOf('[', pos1)) !== -1) {
            if (text.charCodeAt(pos2 - 1) === 92) { // backslash
                result += text.substring(pos1, pos2 - 1);
                result += '[';
                pos1 = pos2 + 1;
            } else {
                result += text.substring(pos1, pos2);
                break;
            }
        }
        if (pos2 === -1)
            return null;

        if (remove)
            this._readPos = pos2;

        return result;
    }

    /**
     * Scans `text`, replacing every registered tag.
     *
     * @param remove when true, recognised tags are dropped instead of being
     *   replaced — the plain-text mode `GTextField` uses.
     */
    public parse(text: string, remove?: boolean): string {
        this._text = text;
        this.lastColor = null;
        this.lastSize = null;

        let pos1 = 0;
        let pos2 = -1;
        let pos3: number;
        let end: boolean;
        let tag: string;
        let attr: string | null;
        let repl: string | null;
        let result = '';

        while ((pos2 = text.indexOf('[', pos1)) !== -1) {
            if (pos2 > 0 && text.charCodeAt(pos2 - 1) === 92) { // backslash
                result += text.substring(pos1, pos2 - 1);
                result += '[';
                pos1 = pos2 + 1;
                continue;
            }

            result += text.substring(pos1, pos2);
            pos1 = pos2;
            pos2 = text.indexOf(']', pos1);
            if (pos2 === -1)
                break;

            end = text.charAt(pos1 + 1) === '/';
            tag = text.substring(end ? pos1 + 2 : pos1 + 1, pos2);
            this._readPos = pos2 + 1;
            attr = null;
            repl = null;
            pos3 = tag.indexOf('=');
            if (pos3 !== -1) {
                attr = tag.substring(pos3 + 1);
                tag = tag.substring(0, pos3);
            }
            tag = tag.toLowerCase();
            const handler = this._handlers[tag];
            if (handler != null) {
                repl = handler.call(this, tag, end, attr);
                if (repl != null && !remove)
                    result += repl;
            } else {
                // An unknown tag is left exactly as it was written.
                result += text.substring(pos1, this._readPos);
            }
            pos1 = this._readPos;
        }

        if (pos1 < text.length)
            result += text.substr(pos1);

        this._text = null;

        return result;
    }
}
