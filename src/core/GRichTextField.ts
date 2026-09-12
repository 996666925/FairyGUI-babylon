import { GTextField } from './GTextField.js';
import { AutoSizeType } from './FieldTypes.js';
import { UIConfig } from './UIConfig.js';
import { UBBParser } from './UBBParser.js';
import { EventType } from './event/Event.js';
import { ToolSet } from './utils/ToolSet.js';
import type { Event } from './event/Event.js';
import { Point } from './utils/Geometry.js';
import type { Color } from './utils/Color.js';

/**
 * Formats a colour as `#rrggbb` for the markup, rounding the channels.
 *
 * `Color.toHex()` writes eight digits including the alpha channel, which is not
 * what the reference's `cc.Color.toHEX('#rrggbb')` produced.
 */
function toHexRGB(c: Color): string {
    const r = ToolSet.clamp(Math.round(c.r), 0, 255);
    const g = ToolSet.clamp(Math.round(c.g), 0, 255);
    const b = ToolSet.clamp(Math.round(c.b), 0, 255);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

/**
 * A text field that renders markup.
 *
 * The reference used `cc.RichText`, which understands `<color>`, `<b>`, `<i>`,
 * `<u>`, `<img>` and `<on click=…>`; here that whole job moves to the backend,
 * which is told `rich = true` and handed the marked-up string.
 *
 * Unlike `GTextField`, UBB tags are translated rather than dropped
 * (`UBBParser.parse` is called without `remove`), and the field never
 * auto-sizes: the reference made `cc.RichText`'s `maxWidth` do the work, which
 * this port's `ITextObject.wrapWidth` stands in for.
 *
 * `bold`/`italic`/`underline` wrap the text in markup rather than setting a
 * font style, because a rich text run can carry its own style per span.
 */
export class GRichTextField extends GTextField {
    /** Whether `[url]` links are underlined. */
    public linkUnderline: boolean;
    /** Colour `[url]` links are tinted with, or `null` for none. */
    public linkColor: string | null = null;

    private _bold = false;
    private _italics = false;
    private _underline = false;

    public constructor() {
        super();

        this._touchDisabled = false;
        this.linkUnderline = UIConfig.linkUnderline;
        this.on(EventType.TOUCH_END, this.onTouchEnd, this);
    }

    /**
     * Fires `LINK` when the release lands on a `[url]` run.
     *
     * The engine's own rich text did this in the reference. Here the markup is
     * laid out by the backend, so the backend is asked which link is under the
     * point and this decides what to emit — the same split as everywhere else
     * on the seam.
     *
     * Emitted as `(href, event)`, which is the order the reference's
     * `GObjectPartner.onClickLink` used.
     */
    private onTouchEnd = (evt: Event): void => {
        const href = this.hitTestLink(evt.pos.x, evt.pos.y);
        if (href == null)
            return;

        this.emit(EventType.LINK, href, evt);
    };

    /** Resolves the link under a point in UI-root space. */
    private hitTestLink(globalX: number, globalY: number): string | null {
        const local = this.globalToLocal(globalX, globalY, this._linkProbe);
        return this._content.hitTestLink(local.x, local.y);
    }

    private _linkProbe = new Point();

    protected createRenderer(): void {
        this._content.rich = true;
        this.autoSize = AutoSizeType.None;
    }

    // ---- style flags -----------------------------------------------------

    public get underline(): boolean {
        return this._underline;
    }

    public set underline(value: boolean) {
        if (this._underline !== value) {
            this._underline = value;

            this.updateText();
        }
    }

    public get bold(): boolean {
        return this._bold;
    }

    public set bold(value: boolean) {
        if (this._bold !== value) {
            this._bold = value;

            this.updateText();
        }
    }

    public get italic(): boolean {
        return this._italics;
    }

    public set italic(value: boolean) {
        if (this._italics !== value) {
            this._italics = value;

            this.updateText();
        }
    }

    // ---- layout ----------------------------------------------------------

    /** `cc.RichText` had no deferred rebuild, so the reference did nothing here. */
    protected markSizeChanged(): void {
    }

    /**
     * The reference's rich variant set its line height to
     * `fontSize + leading * 2` against the plain field's `fontSize + leading`.
     * The seam carries the gap, so the gap doubles.
     */
    protected updateFontSize(): void {
        this._content.fontSize = this._fontSize;
        this._content.leading = this._leading * 2;
    }

    protected updateOverflow(): void {
        this._content.autoSize = this._autoSize;
        this._content.wrapWidth = this._autoSize === AutoSizeType.Both ? 0 : this._width;
    }

    protected updateText(): void {
        let text2 = this._text;

        if (this._templateVars)
            text2 = this.parseTemplate(text2);

        if (this._ubbEnabled) {
            UBBParser.inst.linkUnderline = this.linkUnderline;
            UBBParser.inst.linkColor = this.linkColor;

            text2 = UBBParser.inst.parse(text2);
        }

        if (this._bold)
            text2 = '<b>' + text2 + '</b>';
        if (this._italics)
            text2 = '<i>' + text2 + '</i>';
        if (this._underline)
            text2 = '<u>' + text2 + '</u>';
        let c = this._color;
        if (this._grayed)
            c = this.assignFontColor(c);
        text2 = '<color=' + toHexRGB(c) + '>' + text2 + '</color>';

        if (this._autoSize === AutoSizeType.Both)
            this._content.wrapWidth = 0;
        else
            this._content.wrapWidth = this._width;

        this._content.text = text2;

        // In auto-size mode the string is laid out unwrapped first; only if the
        // result overruns the field's own `maxWidth` does the reference go back
        // and wrap at it.
        if (this._autoSize === AutoSizeType.Both
            && this.maxWidth !== 0
            && this._content.measureTextWidth() > this.maxWidth)
            this._content.wrapWidth = this.maxWidth;
    }
}
