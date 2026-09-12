import { GComponent } from './GComponent.js';
import { GObject } from './GObject.js';
import { ObjectPropID } from './FieldTypes.js';
import { Color } from './utils/Color.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { ITextObject } from './render/IRenderObject.js';
import type { GTextField } from './GTextField.js';

/**
 * The slice of `GTextField` the widgets in this module touch.
 *
 * Declared structurally rather than imported: `GTextField`/`GTextInput` are
 * written by another module, and a value import of them here would close a
 * cycle (they extend `GObject`, which `GLabel` also extends). Everything below
 * narrows through `isTextField`, so these members are only ever read on an
 * object already known to draw text.
 */
interface ITextFieldLike extends GObject {
    color: Color;
    fontSize: number;
    strokeColor: Color | null;
}

/** The extra members `GTextInput` adds on top of a plain text field. */
interface ITextInputLike extends ITextFieldLike {
    editable: boolean;
    promptText: string;
    restrict: string;
    maxLength: number;
    password: boolean;
}

/**
 * Structural stand-in for `instanceof GTextField`.
 *
 * A text widget is the only one whose render node answers `measureTextWidth` —
 * that method is part of `ITextObject`, so this identifies the backend node the
 * widget asked for rather than guessing at its class. `GTextInput` extends
 * `GTextField` in the reference and matches here too.
 */
export function isTextField(obj: GObject | null | undefined): obj is ITextFieldLike {
    const node = obj?.node as Partial<ITextObject> | null | undefined;
    return !!node && typeof node.measureTextWidth === 'function';
}

/**
 * Structural stand-in for `instanceof GTextInput`.
 *
 * `editable` is the property that distinguishes an input from a plain text
 * field in the reference's API; only an input declares it.
 */
export function isTextInput(obj: GObject | null | undefined): obj is ITextInputLike {
    return isTextField(obj) && typeof (obj as unknown as { editable?: unknown }).editable === 'boolean';
}

/** Structural stand-in for `obj instanceof GLabel || obj instanceof GButton`. */
export function hasTextFieldAccessor(
    obj: GObject | null | undefined,
): obj is GObject & { getTextField(): GTextField | null } {
    return !!obj && typeof (obj as unknown as { getTextField?: unknown }).getTextField === 'function';
}

/**
 * Normalises what a translation, a gear or a controller action hands to a
 * colour property: a `Color` passes through, anything else is parsed the way
 * `Color.parse` understands it (`#rrggbb`, `0xaarrggbb`, a packed integer).
 *
 * @returns `null` when `value` is neither, leaving the caller to decide
 *   whether to keep what it had.
 */
export function parseColor(value: unknown): Color | null {
    if (value instanceof Color)
        return value;
    return Color.parse(value as string);
}

/**
 * A component that shows a title and an icon, optionally typed into.
 *
 * Both halves are ordinary children found by name (`title`, `icon`) rather than
 * dedicated members, so an editor-authored label can style them however it
 * likes. `GButton` and `GComboBox` are built on the same shape.
 */
export class GLabel extends GComponent {
    protected _titleObject: GObject | null = null;
    protected _iconObject: GObject | null = null;

    public get icon(): string | null {
        if (this._iconObject)
            return this._iconObject.icon;
        return null;
    }

    public set icon(value: string | null) {
        if (this._iconObject)
            this._iconObject.icon = value;
        this.updateGear(7);
    }

    public get title(): string | null {
        if (this._titleObject)
            return this._titleObject.text;
        return null;
    }

    public set title(value: string | null) {
        if (this._titleObject)
            this._titleObject.text = value;
        this.updateGear(6);
    }

    public get text(): string | null {
        return this.title;
    }

    public set text(value: string | null) {
        this.title = value;
    }

    /** True when the title is an editable input. */
    public get editable(): boolean {
        return isTextInput(this._titleObject) ? this._titleObject.editable : false;
    }

    public set editable(val: boolean) {
        if (isTextInput(this._titleObject))
            this._titleObject.editable = val;
    }

    public get titleColor(): Color {
        const tf = this.getTextField();
        if (tf)
            return tf.color;
        // The reference handed back the shared `cc.Color.WHITE`; a fresh
        // instance stops a caller mutating that constant through this getter.
        return new Color(255, 255, 255, 255);
    }

    public set titleColor(value: Color) {
        const tf = this.getTextField();
        if (tf)
            tf.color = value;
        this.updateGear(4);
    }

    public get titleFontSize(): number {
        const tf = this.getTextField();
        if (tf)
            return tf.fontSize;
        return 0;
    }

    public set titleFontSize(value: number) {
        const tf = this.getTextField();
        if (tf)
            tf.fontSize = value;
    }

    /**
     * The text widget behind the title, looking through a nested `GLabel` or
     * `GButton` whose own title carries it.
     */
    public getTextField(): GTextField | null {
        if (isTextField(this._titleObject))
            return this._titleObject as unknown as GTextField;
        if (hasTextFieldAccessor(this._titleObject))
            return this._titleObject.getTextField();
        return null;
    }

    public getProp(index: number): unknown {
        switch (index) {
            case ObjectPropID.Color:
                return this.titleColor;
            case ObjectPropID.OutlineColor: {
                const tf = this.getTextField();
                return tf ? tf.strokeColor : 0;
            }
            case ObjectPropID.FontSize:
                return this.titleFontSize;
            default:
                return super.getProp(index);
        }
    }

    public setProp(index: number, value: unknown): void {
        switch (index) {
            case ObjectPropID.Color:
                this.titleColor = parseColor(value) ?? this.titleColor;
                break;
            case ObjectPropID.OutlineColor: {
                const tf = this.getTextField();
                const color = parseColor(value);
                if (tf && color)
                    tf.strokeColor = color;
                break;
            }
            case ObjectPropID.FontSize:
                this.titleFontSize = value as number;
                break;
            default:
                super.setProp(index, value);
                break;
        }
    }

    protected constructExtension(_buffer: ByteBuffer): void {
        this._titleObject = this.getChild('title');
        this._iconObject = this.getChild('icon');
    }

    public setup_afterAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_afterAdd(buffer, beginPos);

        if (!buffer.seek(beginPos, 6))
            return;

        // Block 6 is shared by every widget class; its leading byte names the
        // one that wrote it.
        if (buffer.readByte() !== (this.packageItem!.objectType as number))
            return;

        let str = buffer.readS();
        if (str != null)
            this.title = str;
        str = buffer.readS();
        if (str != null)
            this.icon = str;
        if (buffer.readBool())
            this.titleColor = buffer.readColor();
        let iv = buffer.readInt();
        if (iv !== 0)
            this.titleFontSize = iv;

        if (buffer.readBool()) {
            const input = this.getTextField();
            if (isTextInput(input)) {
                str = buffer.readS();
                if (str != null)
                    input.promptText = str;

                str = buffer.readS();
                if (str != null)
                    input.restrict = str;

                iv = buffer.readInt();
                if (iv !== 0)
                    input.maxLength = iv;
                // Keyboard type: read past it, there is no engine input layer
                // to apply it to.
                buffer.skip(4);
                if (buffer.readBool())
                    input.password = true;
            } else
                buffer.skip(13);
        }
    }
}
