import { GTextField } from './GTextField.js';
import { AutoSizeType } from './FieldTypes.js';
import { Event, EventType } from './event/Event.js';
import { UBBParser } from './UBBParser.js';
import { ToolSet } from './utils/ToolSet.js';

import type { ITextObject } from './render/IRenderObject.js';
import type { ByteBuffer } from './utils/ByteBuffer.js';

/**
 * A text surface that can also accept keyboard input.
 *
 * There is no input interface on the render seam — `IRenderFactory` offers
 * `createText()` and nothing else — so this extends `ITextObject` with the
 * members an input needs. The Babylon backend is expected to return an object
 * implementing both from `createText()`; a backend that does not is tolerated,
 * and the widget then behaves as a plain (read-only) text field. That
 * tolerance is why every access below goes through `_input` with a null check
 * rather than being assumed: `tests/helpers/mockRender.ts` is such a backend.
 */
export interface ITextInputObject extends ITextObject {
    /** Whether the field currently accepts typing. */
    editable: boolean;
    /** Maximum accepted length; `-1` means unlimited. */
    maxLength: number;
    /** Masks the text as it is typed. */
    password: boolean;
    /** Placeholder shown while the field is empty. */
    promptText: string;
    /** Invoked by the backend when the user edits the text. */
    onTextChanged: ((text: string) => void) | null;
    /** Invoked by the backend when the user submits (Enter / done key). */
    onSubmit: ((text: string, keyCode: number) => void) | null;
    /** Focuses the field and raises the platform keyboard. */
    openKeyboard(): void;
}

/** Structural test for a backend that can take input, not a class check. */
function supportsTextInput(obj: ITextObject): obj is ITextInputObject {
    return typeof (obj as Partial<ITextInputObject>).openKeyboard === 'function';
}

/**
 * An editable text field.
 *
 * The reference drove a `cc.EditBox` and mirrored its two labels (text and
 * placeholder) by hand. The seam has one surface, so placeholder styling is the
 * backend's business: only the placeholder *string* crosses over. The same
 * collapse applies to `singleLine`, which the reference expressed as
 * `cc.EditBox.InputMode` and which is the seam's plain `singleLine` flag, and to
 * `align`/`verticalAlign`, which the reference had to copy from the text label
 * to the placeholder label.
 */
export class GTextInput extends GTextField {
    private _input: ITextInputObject | null = null;

    private _editable = true;
    private _maxLength = -1;
    private _password = false;
    private _promptText = '';

    public constructor() {
        super();

        this._input = supportsTextInput(this._content) ? this._content : null;

        if (this._input) {
            this._input.editable = true;
            this._input.maxLength = -1;
            this._input.onTextChanged = this.onTextChanged;
            this._input.onSubmit = this.onSubmit;
        }

        this._touchDisabled = false;
        this.on(EventType.TOUCH_END, this.onTouchEnd, this);
    }

    /**
     * Input fields never auto-size; the reference's `updateOverflow` was empty.
     *
     * The rest of the surface's configuration — the step that grabs the
     * `ITextInputObject` and points its callbacks here — happens in the
     * constructor body instead, because this runs from the base constructor
     * while the subclass fields below are still uninitialised.
     */
    protected createRenderer(): void {
        this.autoSize = AutoSizeType.None;
    }

    // ---- input state -----------------------------------------------------

    public get editable(): boolean {
        return this._input ? this._input.editable : this._editable;
    }

    public set editable(value: boolean) {
        this._editable = value;
        if (this._input)
            this._input.editable = value;
    }

    public get maxLength(): number {
        return this._input ? this._input.maxLength : this._maxLength;
    }

    public set maxLength(value: number) {
        // Zero means "unlimited", not "accept nothing" — the reference mapped it
        // that way before handing it to `cc.EditBox`.
        if (value === 0)
            value = -1;
        this._maxLength = value;
        if (this._input)
            this._input.maxLength = value;
    }

    public get password(): boolean {
        return this._input ? this._input.password : this._password;
    }

    public set password(value: boolean) {
        this._password = value;
        if (this._input)
            this._input.password = value;
    }

    public get promptText(): string {
        return this._promptText;
    }

    /**
     * Sets the placeholder.
     *
     * The reference parsed UBB out of the prompt and then read
     * `UBBParser.inst.lastColor`/`lastSize` back to tint and resize the
     * placeholder label. The seam carries one string per surface, so the prompt
     * is passed through with its markup stripped and the backend styles it with
     * the field's own colour and size.
     */
    public set promptText(value: string) {
        this._promptText = value;
        if (this._input)
            this._input.promptText = UBBParser.inst.parse(value, true);
    }

    /** Not supported; kept so the property exists, as in the reference. */
    public get restrict(): string {
        return '';
    }

    public set restrict(_value: string) {
    }

    public requestFocus(): void {
        this._input?.openKeyboard();
    }

    // ---- backend callbacks -----------------------------------------------

    /**
     * Called by the backend when the user edits the text.
     *
     * The reference only mirrored the string here — it had disabled the edit
     * box's own event dispatch — but this port's `EventType` documents
     * `TEXT_CHANGE` and `SUBMIT` as coming from a `GTextInput`, so they are
     * dispatched here.
     */
    private onTextChanged = (text: string): void => {
        this._text = text;

        const evt = new Event(EventType.TEXT_CHANGE);
        evt.keyCode = 0;
        this.dispatchEvent(evt);
    };

    private onSubmit = (text: string, keyCode: number): void => {
        this._text = text;

        const evt = new Event(EventType.SUBMIT);
        evt.keyCode = keyCode;
        this.dispatchEvent(evt);
    };

    private onTouchEnd = (): void => {
        this.requestFocus();
    };

    // ---- layout ----------------------------------------------------------

    /** No automatic sizing; the reference's override was empty. */
    protected markSizeChanged(): void {
    }

    protected updateOverflow(): void {
    }

    protected updateText(): void {
        let text2 = this._text;

        if (this._templateVars)
            text2 = this.parseTemplate(text2);

        // Encoded first so that any `<` the user typed stays literal, then the
        // UBB tags are stripped rather than translated.
        if (this._ubbEnabled)
            text2 = UBBParser.inst.parse(ToolSet.encodeHTML(text2), true);

        this._content.rich = false;
        this._content.text = text2;
    }

    // ---- construction from package data ----------------------------------

    public setup_beforeAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_beforeAdd(buffer, beginPos);

        buffer.seek(beginPos, 4);

        let str = buffer.readS();
        if (str != null)
            this.promptText = str;

        str = buffer.readS();
        if (str != null)
            this.restrict = str;

        const iv = buffer.readInt();
        if (iv !== 0)
            this.maxLength = iv;
        buffer.readInt(); // keyboard type — not modelled
        if (buffer.readBool())
            this.password = true;

        // The reference copied the text label's alignment onto the placeholder
        // here. One surface, so nothing to copy.
    }
}
