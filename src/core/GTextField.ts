import { GObject } from './GObject.js';
import { AlignType, AutoSizeType, ObjectPropID, VertAlignType } from './FieldTypes.js';
import { Color } from './utils/Color.js';
import { Point } from './utils/Geometry.js';
import { ToolSet } from './utils/ToolSet.js';
import { UIConfig, getFontByName } from './UIConfig.js';
import { UIPackage } from './UIPackage.js';
import { BitmapFont } from './display/BitmapFont.js';
import { EventType } from './event/Event.js';
import { UBBParser } from './UBBParser.js';
import { getRenderFactory, type ITextObject, type IRenderObject } from './render/IRenderObject.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';

/**
 * An aggregate of everything that decides how a text field looks.
 *
 * `textFormat` is not in the Cocos reference this port follows — it comes from
 * the Unity runtime, where one `TextFormat` can be handed to several fields at
 * once. Only members that are present (`!== undefined`) are applied, so a
 * partial format updates just the attributes it names.
 */
export interface TextFormat {
    font?: string | null;
    fontSize?: number;
    color?: Color;
    align?: AlignType;
    verticalAlign?: VertAlignType;
    leading?: number;
    letterSpacing?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    singleLine?: boolean;
    ubb?: boolean;
    autoSize?: AutoSizeType;
}

/** What a font that may not be tinted forces the field's colour to. */
const WHITE = new Color(255, 255, 255, 255);

/**
 * A run of text drawn by the backend's text surface.
 *
 * The reference delegated all layout to `cc.Label` and read the result back off
 * its node. Here `ITextObject` owns layout and answers `measureTextWidth()` /
 * `measureTextHeight()`, so the auto-size modes resolve by **measuring on
 * demand** rather than by waiting for the label to re-lay out and report a
 * `SIZE_CHANGED`. That is why `ensureSizeCorrect()` — not an event handler —
 * is where `AutoSizeType` is applied: `GObject.width`/`height` already call it.
 *
 * Consequence worth knowing: nothing resizes in the background. A field whose
 * size has not been read since its text changed still reports the stale size
 * until `ensureSizeCorrect()` runs.
 *
 * `stroke`/`strokeColor`/`shadowOffset`/`shadowColor` are outline and drop
 * shadow, both drawn by the surface: the core keeps the authored values and
 * pushes them down as they change. The surface's raster grows to hold whatever
 * they add, so a thick outline or a long shadow is not shaved off.
 */
export class GTextField extends GObject {
    /** The drawing node. Same object as `node`, narrowed. */
    public _content: ITextObject;

    protected _font: string | null = null;
    /**
     * The font name handed to the backend, after `ui://` resolution. The
     * reference swapped such a URL for the font object the package item
     * resolved to; `ITextObject.font` is a name here, so the URL itself is what
     * a backend that reads names sees, and the resolved font travels beside it
     * as `bitmapFont`.
     */
    protected _realFont: string | null = null;
    /** The package font `_realFont` resolved to, or `null` for a system font. */
    protected _bitmapFont: BitmapFont | null = null;
    protected _fontSize = 0;
    protected _color: Color;
    protected _strokeColor: Color | null = null;
    protected _shadowOffset: Point | null = null;
    protected _shadowColor: Color | null = null;
    protected _leading = 0;
    protected _text = '';
    protected _ubbEnabled = false;
    protected _templateVars: Record<string, string> | null = null;
    protected _autoSize: AutoSizeType = AutoSizeType.Both;
    protected _updatingSize = false;
    protected _sizeDirty = false;
    /** Stroke width kept for the property surface; see the class comment. */
    protected _stroke = 0;

    public constructor() {
        super();

        this._content = this._node as ITextObject;
        this._touchDisabled = true;

        this._text = '';
        this._color = new Color(255, 255, 255, 255);

        this.createRenderer();

        this.fontSize = 12;
        this.leading = 3;
        this.singleLine = false;

        this._sizeDirty = false;
    }

    protected createDisplayObject(): IRenderObject {
        return getRenderFactory().createText();
    }

    /** Builds the drawing surface and picks the mode this widget defaults to. */
    protected createRenderer(): void {
        this.autoSize = AutoSizeType.Both;
    }

    // ---- text ------------------------------------------------------------

    public get text(): string {
        return this._text;
    }

    public set text(value: string | null) {
        this._text = value ?? '';
        this.updateGear(6);

        this.markSizeChanged();
        this.updateText();
    }

    public get font(): string | null {
        return this._font;
    }

    public set font(value: string | null) {
        if (this._font !== value || !value) {
            this._font = value;

            this.markSizeChanged();

            let newFont = value ?? UIConfig.defaultFont;
            if (ToolSet.startsWith(newFont, 'ui://')) {
                // A font published inside a package. A URL naming nothing — or
                // naming something that is not a font — falls back to the
                // default font, as the reference did; leaving it be would send
                // a `ui://` string to the surface as a system family.
                if (!UIPackage.getItemByURL(newFont)?.bitmapFont)
                    newFont = UIConfig.defaultFont;
            }
            this._realFont = newFont;
            this.updateFont();
        }
    }

    public get fontSize(): number {
        return this._fontSize;
    }

    public set fontSize(value: number) {
        if (value < 0)
            return;

        if (this._fontSize !== value) {
            this._fontSize = value;

            this.markSizeChanged();
            this.updateFontSize();
        }
    }

    public get color(): Color {
        return this._color;
    }

    public set color(value: Color) {
        // Mutated in place: the backend holds this very object.
        this._color.copy(value);
        this.updateGear(4);

        this.updateFontColor();
    }

    public get align(): AlignType {
        return this._content.align as AlignType;
    }

    public set align(value: AlignType) {
        this._content.align = value;
    }

    public get verticalAlign(): VertAlignType {
        return this._content.verticalAlign as VertAlignType;
    }

    public set verticalAlign(value: VertAlignType) {
        this._content.verticalAlign = value;
    }

    public get leading(): number {
        return this._leading;
    }

    public set leading(value: number) {
        if (this._leading !== value) {
            this._leading = value;

            this.markSizeChanged();
            this.updateFontSize();
        }
    }

    public get letterSpacing(): number {
        return this._content.letterSpacing;
    }

    public set letterSpacing(value: number) {
        if (this._content.letterSpacing !== value) {
            this.markSizeChanged();
            this._content.letterSpacing = value;
        }
    }

    public get underline(): boolean {
        return this._content.underline;
    }

    public set underline(value: boolean) {
        this._content.underline = value;
    }

    public get bold(): boolean {
        return this._content.fontStyle.indexOf('bold') !== -1;
    }

    public set bold(value: boolean) {
        this.updateFontStyle(value, this._content.fontStyle.indexOf('italic') !== -1);
    }

    public get italic(): boolean {
        return this._content.fontStyle.indexOf('italic') !== -1;
    }

    public set italic(value: boolean) {
        this.updateFontStyle(this._content.fontStyle.indexOf('bold') !== -1, value);
    }

    /**
     * Combines the two style flags into the single `fontStyle` string the seam
     * carries. The reference had `enableBold`/`enableItalic` on `cc.Label`.
     */
    protected updateFontStyle(bold: boolean, italic: boolean): void {
        this._content.fontStyle = bold ? (italic ? 'bolditalic' : 'bold') : (italic ? 'italic' : '');
    }

    public get singleLine(): boolean {
        return this._content.singleLine;
    }

    public set singleLine(value: boolean) {
        this._content.singleLine = value;
    }

    // ---- stroke and shadow ----------------------------------------------

    public get stroke(): number {
        return this._stroke;
    }

    public set stroke(value: number) {
        if (this._stroke !== value) {
            this._stroke = value;
            this._content.stroke = value;
        }
    }

    public get strokeColor(): Color | null {
        return this._strokeColor;
    }

    public set strokeColor(value: Color) {
        if (!this._strokeColor)
            this._strokeColor = new Color();
        this._strokeColor.copy(value);
        // Handed over by reference: the surface reads it when it draws, and the
        // core's copy is what changes when the property is set again.
        this._content.strokeColor = this._strokeColor;
        this.updateGear(4);
    }

    public get shadowOffset(): Point | null {
        return this._shadowOffset;
    }

    public set shadowOffset(value: Point) {
        if (!this._shadowOffset)
            this._shadowOffset = new Point();
        this._shadowOffset.setTo(value.x, value.y);
        this._content.shadowOffsetX = this._shadowOffset.x;
        this._content.shadowOffsetY = this._shadowOffset.y;
    }

    public get shadowColor(): Color | null {
        return this._shadowColor;
    }

    public set shadowColor(value: Color) {
        if (!this._shadowColor)
            this._shadowColor = new Color();
        this._shadowColor.copy(value);
        this._content.shadowColor = this._shadowColor;
    }

    // ---- markup ----------------------------------------------------------

    /** Whether `[b]`, `[color=…]` and friends are stripped from the text. */
    public get ubb(): boolean {
        return this._ubbEnabled;
    }

    public set ubb(value: boolean) {
        if (this._ubbEnabled !== value) {
            this._ubbEnabled = value;

            this.markSizeChanged();
            this.updateText();
        }
    }

    /** The reference's name for `ubb`; kept so either spelling works. */
    public get ubbEnabled(): boolean {
        return this.ubb;
    }

    public set ubbEnabled(value: boolean) {
        this.ubb = value;
    }

    // ---- auto size -------------------------------------------------------

    public get autoSize(): AutoSizeType {
        return this._autoSize;
    }

    public set autoSize(value: AutoSizeType) {
        if (this._autoSize !== value) {
            this._autoSize = value;

            this.markSizeChanged();
            this.updateOverflow();
        }
    }

    // ---- template variables ----------------------------------------------

    /**
     * Substitutes `{name}` and `{name=fallback}` placeholders.
     *
     * A placeholder naming a variable that does not exist and has no fallback is
     * dropped, and `{}` is left alone — both as the reference had them.
     */
    protected parseTemplate(template: string): string {
        let pos1 = 0;
        let pos2 = -1;
        let pos3: number;
        let tag: string;
        let value: string | undefined;
        let result = '';
        while ((pos2 = template.indexOf('{', pos1)) !== -1) {
            if (pos2 > 0 && template.charCodeAt(pos2 - 1) === 92) { // backslash
                result += template.substring(pos1, pos2 - 1);
                result += '{';
                pos1 = pos2 + 1;
                continue;
            }

            result += template.substring(pos1, pos2);
            pos1 = pos2;
            pos2 = template.indexOf('}', pos1);
            if (pos2 === -1)
                break;

            if (pos2 === pos1 + 1) {
                result += template.substr(pos1, 2);
                pos1 = pos2 + 1;
                continue;
            }

            tag = template.substring(pos1 + 1, pos2);
            pos3 = tag.indexOf('=');
            if (pos3 !== -1) {
                value = this._templateVars![tag.substring(0, pos3)];
                if (value == null)
                    result += tag.substring(pos3 + 1);
                else
                    result += value;
            } else {
                value = this._templateVars![tag];
                if (value != null)
                    result += value;
            }
            pos1 = pos2 + 1;
        }

        if (pos1 < template.length)
            result += template.substr(pos1);

        return result;
    }

    public get templateVars(): Record<string, string> | null {
        return this._templateVars;
    }

    public set templateVars(value: Record<string, string> | null) {
        if (this._templateVars == null && value == null)
            return;

        this._templateVars = value;
        this.flushVars();
    }

    public setVar(name: string, value: string): GTextField {
        if (!this._templateVars)
            this._templateVars = {};
        this._templateVars[name] = value;

        return this;
    }

    public flushVars(): void {
        this.markSizeChanged();
        this.updateText();
    }

    // ---- text format -----------------------------------------------------

    /** A snapshot of the attributes above, as a single object. */
    public get textFormat(): TextFormat {
        return {
            font: this._font,
            fontSize: this._fontSize,
            color: this._color,
            align: this.align,
            verticalAlign: this.verticalAlign,
            leading: this._leading,
            letterSpacing: this.letterSpacing,
            bold: this.bold,
            italic: this.italic,
            underline: this.underline,
            singleLine: this.singleLine,
            ubb: this._ubbEnabled,
            autoSize: this._autoSize,
        };
    }

    public set textFormat(value: TextFormat) {
        if (value.font !== undefined)
            this.font = value.font;
        if (value.fontSize !== undefined)
            this.fontSize = value.fontSize;
        if (value.color !== undefined)
            this.color = value.color;
        if (value.align !== undefined)
            this.align = value.align;
        if (value.verticalAlign !== undefined)
            this.verticalAlign = value.verticalAlign;
        if (value.leading !== undefined)
            this.leading = value.leading;
        if (value.letterSpacing !== undefined)
            this.letterSpacing = value.letterSpacing;
        if (value.bold !== undefined)
            this.bold = value.bold;
        if (value.italic !== undefined)
            this.italic = value.italic;
        if (value.underline !== undefined)
            this.underline = value.underline;
        if (value.singleLine !== undefined)
            this.singleLine = value.singleLine;
        if (value.ubb !== undefined)
            this.ubb = value.ubb;
        if (value.autoSize !== undefined)
            this.autoSize = value.autoSize;
    }

    // ---- layout ----------------------------------------------------------

    /** Width of the laid-out text, which need not equal `width`. */
    public get textWidth(): number {
        this.ensureSizeCorrect();

        return this._content.measureTextWidth();
    }

    /**
     * Resolves a pending auto-size change.
     *
     * `GObject.width`/`height` call this, which is what makes an auto-sized
     * field report the size of its text. The reference forced `cc.Label` to
     * rebuild its render data and read the node's new size; measuring stands in
     * for that, so the result is available immediately.
     */
    public ensureSizeCorrect(): void {
        if (!this._sizeDirty)
            return;
        // Still being built from package data: resolve on the first read after
        // construction rather than between two setup passes.
        if (this._underConstruct)
            return;

        this._sizeDirty = false;
        this.updateSize();
    }

    protected updateSize(): void {
        if (this._autoSize === AutoSizeType.Both) {
            this._updatingSize = true;
            this.setSize(this._content.measureTextWidth(), this._content.measureTextHeight());
            this._updatingSize = false;
        } else if (this._autoSize === AutoSizeType.Height) {
            this._updatingSize = true;
            this.setSize(this._width, this._content.measureTextHeight());
            this._updatingSize = false;
        } else {
            return;
        }

        // `handleSizeChanged` deliberately stands aside while the size is being
        // resolved, because in the reference `cc.Label` had already grown itself
        // to fit the text and pushing the object's box back at it would have
        // been wrong. The seam's `measureText*()` only *reports*, so the resolved
        // box has to be handed to the surface here or it would never be applied.
        super.handleSizeChanged();
    }

    protected updateText(): void {
        let text2 = this._text;
        if (this._templateVars)
            text2 = this.parseTemplate(text2);

        // `remove = true`: the tags are dropped, not translated, because the
        // surface underneath draws plain runs. Markup only reaches a backend
        // from `GRichTextField`.
        if (this._ubbEnabled)
            text2 = UBBParser.inst.parse(text2, true);

        this._content.rich = false;
        this._content.text = text2;
    }

    // ---- look-up and overflow --------------------------------------------

    protected updateFont(): void {
        this._content.font = this._realFont;
        this._bitmapFont = this.resolveBitmapFont(this._realFont);
        this._content.bitmapFont = this._bitmapFont;
        // The font decides the effective size, so a size set before the font
        // has to be re-applied once it is known.
        this.updateFontSize();
        this.updateFontColor();
    }

    /**
     * The package font a name refers to, or `null` for a system family.
     *
     * A `ui://` URL names a package item; anything else is looked up in the
     * registry the app fills through `registerFont`, which is how the reference
     * split the two as well.
     */
    protected resolveBitmapFont(name: string | null): BitmapFont | null {
        if (!name)
            return null;
        if (ToolSet.startsWith(name, 'ui://'))
            return UIPackage.getItemByURL(name)?.bitmapFont ?? null;

        const registered = getFontByName(name);
        return registered instanceof BitmapFont ? registered : null;
    }

    protected updateFontColor(): void {
        this._content.color = this.assignFontColor(this._color);
    }

    /**
     * Applies `grayed` to a colour before it reaches the surface, and forces
     * white for a font whose glyphs may not be tinted.
     *
     * The reference made both decisions here too. A non-tintable font's glyphs
     * carry their own colours, so the field's is dropped rather than multiplied
     * into them — greying first would tint exactly what must not be tinted.
     */
    protected assignFontColor(value: Color): Color {
        if (this._bitmapFont && !this._bitmapFont.canTint)
            value = WHITE;
        return this._grayed ? value.toGrayed() : value;
    }

    protected updateFontSize(): void {
        // A font that cannot scale is drawn at the size its glyphs were
        // rasterised at; the requested size stays on `_fontSize` and only the
        // surface sees the snap, which is the split the reference had.
        const font = this._bitmapFont;
        this._content.fontSize = font && !font.resizable ? font.size : this._fontSize;
        // The reference set `lineHeight = fontSize + leading`; the seam carries
        // the gap itself, so it passes through unchanged.
        this._content.leading = this._leading;
    }

    protected updateOverflow(): void {
        if (this._autoSize === AutoSizeType.Both)
            this._content.wrapWidth = 0;
        else
            this._content.wrapWidth = this._width;

        this._content.autoSize = this._autoSize;

        if (this._autoSize === AutoSizeType.None || this._autoSize === AutoSizeType.Shrink)
            this._node.setContentSize(this._width, this._height);
    }

    /**
     * Marks the layout stale, so the next size read recomputes it.
     *
     * Only the modes that track the text need this; fixed and shrink modes are
     * told their size by the caller.
     */
    protected markSizeChanged(): void {
        if (this._underConstruct)
            return;

        if (this._autoSize === AutoSizeType.Both || this._autoSize === AutoSizeType.Height) {
            if (!this._sizeDirty) {
                this.emit(EventType.SIZE_DELAY_CHANGE, this);
                this._sizeDirty = true;
            }
        }
    }

    // ---- protected hooks -------------------------------------------------

    protected handleSizeChanged(): void {
        if (this._updatingSize)
            return;

        if (this._autoSize !== AutoSizeType.Both)
            this._content.wrapWidth = this._width;
        this._content.autoSize = this._autoSize;

        // Sets the surface's own content box, which for the fixed modes is the
        // box the text is clipped and aligned within.
        super.handleSizeChanged();
    }

    protected handleGrayedChanged(): void {
        this.updateFontColor();
    }

    // ---- properties by index ---------------------------------------------

    public getProp(index: number): unknown {
        switch (index) {
            case ObjectPropID.Color:
                return this.color;
            case ObjectPropID.OutlineColor:
                return this.strokeColor;
            case ObjectPropID.FontSize:
                return this.fontSize;
            default:
                return super.getProp(index);
        }
    }

    public setProp(index: number, value: unknown): void {
        switch (index) {
            case ObjectPropID.Color:
                this.color = value instanceof Color ? value : Color.parse(value as string) ?? this.color;
                break;
            case ObjectPropID.OutlineColor:
                this.strokeColor = value instanceof Color ? value : Color.parse(value as string) ?? new Color(0, 0, 0);
                break;
            case ObjectPropID.FontSize:
                // Package payloads deliver this as a string; the reference let
                // `cc.Label` coerce it. Coerce here so a numeric font size never
                // reaches the backend as text.
                this.fontSize = typeof value === 'number' ? value : parseInt(value as string, 10);
                break;
            default:
                super.setProp(index, value);
                break;
        }
    }

    // ---- construction from package data ----------------------------------

    public setup_beforeAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_beforeAdd(buffer, beginPos);

        buffer.seek(beginPos, 5);

        this.font = buffer.readS();
        this.fontSize = buffer.readShort();
        this.color = buffer.readColor();
        this.align = buffer.readByte();
        this.verticalAlign = buffer.readByte();
        this.leading = buffer.readShort();
        this.letterSpacing = buffer.readShort();
        this._ubbEnabled = buffer.readBool();
        this.autoSize = buffer.readByte();
        this.underline = buffer.readBool();
        this.italic = buffer.readBool();
        this.bold = buffer.readBool();
        this.singleLine = buffer.readBool();
        if (buffer.readBool()) {
            this.strokeColor = buffer.readColor();
            this.stroke = buffer.readFloat();
        }

        if (buffer.readBool()) {
            this.shadowColor = buffer.readColor();
            const f1 = buffer.readFloat();
            const f2 = buffer.readFloat();
            this.shadowOffset = new Point(f1, f2);
        }

        if (buffer.readBool())
            this._templateVars = {};
    }

    public setup_afterAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_afterAdd(buffer, beginPos);

        buffer.seek(beginPos, 6);

        const str = buffer.readS();
        if (str != null)
            this.text = str;

        // `markSizeChanged()` is a no-op while the parent is mid-construction,
        // so an auto-sized field would otherwise keep whatever size the editor
        // stored. The reference got the right size because `cc.Label` re-laid
        // out asynchronously and reported a `SIZE_CHANGED` once construction was
        // over; measuring on demand replaces that, so flag the size here and let
        // the first read of `width`/`height` resolve it.
        if (!this._sizeDirty
            && (this._autoSize === AutoSizeType.Both || this._autoSize === AutoSizeType.Height))
            this._sizeDirty = true;
    }
}
