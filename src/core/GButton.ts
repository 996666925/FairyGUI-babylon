import { GComponent } from './GComponent.js';
import { GObject } from './GObject.js';
import { ButtonMode, ObjectPropID } from './FieldTypes.js';
import { UIConfig } from './UIConfig.js';
import { UIPackage } from './UIPackage.js';
import { Color } from './utils/Color.js';
import { EventType } from './event/Event.js';
import { isTextField, hasTextFieldAccessor, parseColor } from './GLabel.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { Event } from './event/Event.js';
import type { Controller } from './Controller.js';
import type { GTextField } from './GTextField.js';

/** The colour a down-effect tints towards, and restores to. */
const sWhite = new Color(255, 255, 255, 255);

/**
 * A push button, check box or radio button.
 *
 * The look comes from a `Controller` the editor names `button`: its pages are
 * `up`/`down`/`over`/`selectedOver`/`disabled`/`selectedDisabled`, and setting
 * a page switches which child set is visible. `GButton` itself holds only the
 * state machine — the drawing is whatever the editor put on each page.
 */
export class GButton extends GComponent {
    protected _titleObject: GObject | null = null;
    protected _iconObject: GObject | null = null;

    private _mode: ButtonMode = ButtonMode.Common;
    private _selected = false;
    private _title: string | null = '';
    private _selectedTitle: string | null = null;
    private _icon: string | null = '';
    private _selectedIcon: string | null = null;
    private _sound: string | null = UIConfig.buttonSound;
    private _soundVolumeScale = UIConfig.buttonSoundVolumeScale;
    private _buttonController: Controller | null = null;
    private _relatedController: Controller | null = null;
    private _relatedPageId: string | null = null;
    private _changeStateOnClick = true;
    private _linkedPopup: GObject | null = null;
    private _downEffect = 0;
    private _downEffectValue = 0.8;
    private _downColor: Color | null = null;
    private _downScaled = false;
    private _down = false;
    private _over = false;

    public static UP = 'up';
    public static DOWN = 'down';
    public static OVER = 'over';
    public static SELECTED_OVER = 'selectedOver';
    public static DISABLED = 'disabled';
    public static SELECTED_DISABLED = 'selectedDisabled';

    public get icon(): string | null {
        return this._icon;
    }

    public set icon(value: string | null) {
        this._icon = value;
        value = (this._selected && this._selectedIcon) ? this._selectedIcon : this._icon;
        if (this._iconObject)
            this._iconObject.icon = value;
        this.updateGear(7);
    }

    public get selectedIcon(): string | null {
        return this._selectedIcon;
    }

    public set selectedIcon(value: string | null) {
        this._selectedIcon = value;
        value = (this._selected && this._selectedIcon) ? this._selectedIcon : this._icon;
        if (this._iconObject)
            this._iconObject.icon = value;
    }

    public get title(): string | null {
        return this._title;
    }

    public set title(value: string | null) {
        this._title = value;
        if (this._titleObject)
            this._titleObject.text = (this._selected && this._selectedTitle) ? this._selectedTitle : this._title;
        this.updateGear(6);
    }

    public get text(): string | null {
        return this.title;
    }

    public set text(value: string | null) {
        this.title = value;
    }

    public get selectedTitle(): string | null {
        return this._selectedTitle;
    }

    public set selectedTitle(value: string | null) {
        this._selectedTitle = value;
        if (this._titleObject)
            this._titleObject.text = (this._selected && this._selectedTitle) ? this._selectedTitle : this._title;
    }

    public get titleColor(): Color {
        const tf = this.getTextField();
        if (tf)
            return tf.color;
        // The reference returned the shared `cc.Color.BLACK`; a fresh instance
        // keeps a caller from mutating that constant through this getter.
        return new Color(0, 0, 0, 255);
    }

    public set titleColor(value: Color) {
        const tf = this.getTextField();
        if (tf)
            tf.color = value;
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

    public get sound(): string | null {
        return this._sound;
    }

    public set sound(val: string | null) {
        this._sound = val;
    }

    public get soundVolumeScale(): number {
        return this._soundVolumeScale;
    }

    public set soundVolumeScale(value: number) {
        this._soundVolumeScale = value;
    }

    public get selected(): boolean {
        return this._selected;
    }

    public set selected(val: boolean) {
        if (this._mode === ButtonMode.Common)
            return;

        if (this._selected !== val) {
            this._selected = val;
            this.setCurrentState();
            if (this._selectedTitle && this._titleObject)
                this._titleObject.text = this._selected ? this._selectedTitle : this._title;
            if (this._selectedIcon) {
                const str = this._selected ? this._selectedIcon : this._icon;
                if (this._iconObject)
                    this._iconObject.icon = str;
            }
            // While a component builds its display list the radio group depth
            // is meaningless, and swapping children would corrupt the walk.
            if (this._relatedController && this._parent && !this._parent._buildingDisplayList) {
                if (this._selected) {
                    this._relatedController.selectedPageId = this._relatedPageId;
                    if (this._relatedController.autoRadioGroupDepth)
                        this._parent.adjustRadioGroupDepth(this, this._relatedController);
                } else if (this._mode === ButtonMode.Check
                    && this._relatedController.selectedPageId === this._relatedPageId) {
                    this._relatedController.oppositePageId = this._relatedPageId as string;
                }
            }
        }
    }

    public get mode(): ButtonMode {
        return this._mode;
    }

    public set mode(value: ButtonMode) {
        if (this._mode !== value) {
            if (value === ButtonMode.Common)
                this.selected = false;
            this._mode = value;
        }
    }

    public get relatedController(): Controller | null {
        return this._relatedController;
    }

    public set relatedController(val: Controller | null) {
        this._relatedController = val;
    }

    public get relatedPageId(): string | null {
        return this._relatedPageId;
    }

    public set relatedPageId(val: string | null) {
        this._relatedPageId = val;
    }

    public get changeStateOnClick(): boolean {
        return this._changeStateOnClick;
    }

    public set changeStateOnClick(value: boolean) {
        this._changeStateOnClick = value;
    }

    public get linkedPopup(): GObject | null {
        return this._linkedPopup;
    }

    public set linkedPopup(value: GObject | null) {
        this._linkedPopup = value;
    }

    public getTextField(): GTextField | null {
        if (isTextField(this._titleObject))
            return this._titleObject as unknown as GTextField;
        if (hasTextFieldAccessor(this._titleObject))
            return this._titleObject.getTextField();
        return null;
    }

    /** Routes a synthetic click through the root's input processor. */
    public fireClick(): void {
        this.root?.inputProcessor.simulateClick(this);
    }

    protected setState(val: string): void {
        if (this._buttonController)
            this._buttonController.selectedPage = val;

        if (this._downEffect === 1) {
            const cnt = this.numChildren;
            if (val === GButton.DOWN || val === GButton.SELECTED_OVER || val === GButton.SELECTED_DISABLED) {
                if (!this._downColor)
                    this._downColor = new Color();
                const r = this._downEffectValue * 255;
                this._downColor.r = this._downColor.g = this._downColor.b = r;
                for (let i = 0; i < cnt; i++)
                    this.tintChild(this.getChildAt(i), this._downColor);
            } else {
                for (let i = 0; i < cnt; i++)
                    this.tintChild(this.getChildAt(i), sWhite);
            }
        } else if (this._downEffect === 2) {
            if (val === GButton.DOWN || val === GButton.SELECTED_OVER || val === GButton.SELECTED_DISABLED) {
                if (!this._downScaled) {
                    this._downScaled = true;
                    this.setScale(this.scaleX * this._downEffectValue, this.scaleY * this._downEffectValue);
                }
            } else {
                if (this._downScaled) {
                    this._downScaled = false;
                    this.setScale(this.scaleX / this._downEffectValue, this.scaleY / this._downEffectValue);
                }
            }
        }
    }

    /**
     * Applies the down-effect tint to one child.
     *
     * The reference tested `obj["color"] != undefined && !(obj instanceof
     * GTextField)` — images and graphs carry a colour, text does not get tinted.
     */
    private tintChild(obj: GObject, color: Color): void {
        if (isTextField(obj))
            return;
        const target = obj as unknown as { color?: Color };
        if (target.color !== undefined)
            target.color = color;
    }

    protected setCurrentState(): void {
        if (this.grayed && this._buttonController && this._buttonController.hasPage(GButton.DISABLED)) {
            if (this._selected)
                this.setState(GButton.SELECTED_DISABLED);
            else
                this.setState(GButton.DISABLED);
        } else {
            if (this._selected)
                this.setState(this._over ? GButton.SELECTED_OVER : GButton.DOWN);
            else
                this.setState(this._over ? GButton.OVER : GButton.UP);
        }
    }

    public handleControllerChanged(c: Controller): void {
        super.handleControllerChanged(c);

        if (this._relatedController === c)
            this.selected = this._relatedPageId === c.selectedPageId;
    }

    protected handleGrayedChanged(): void {
        if (this._buttonController && this._buttonController.hasPage(GButton.DISABLED)) {
            if (this.grayed) {
                if (this._selected && this._buttonController.hasPage(GButton.SELECTED_DISABLED))
                    this.setState(GButton.SELECTED_DISABLED);
                else
                    this.setState(GButton.DISABLED);
            } else if (this._selected)
                this.setState(GButton.DOWN);
            else
                this.setState(GButton.UP);
        } else
            super.handleGrayedChanged();
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
            case ObjectPropID.Selected:
                return this.selected;
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
            case ObjectPropID.Selected:
                this.selected = value as boolean;
                break;
            default:
                super.setProp(index, value);
                break;
        }
    }

    protected constructExtension(buffer: ByteBuffer): void {
        buffer.seek(0, 6);

        this._mode = buffer.readByte();
        let str = buffer.readS();
        if (str)
            this._sound = str;
        this._soundVolumeScale = buffer.readFloat();
        this._downEffect = buffer.readByte();
        this._downEffectValue = buffer.readFloat();
        if (this._downEffect === 2)
            this.setPivot(0.5, 0.5, this.pivotAsAnchor);

        this._buttonController = this.getController('button');
        this._titleObject = this.getChild('title');
        this._iconObject = this.getChild('icon');
        if (this._titleObject)
            this._title = this._titleObject.text;
        if (this._iconObject)
            this._icon = this._iconObject.icon;

        if (this._mode === ButtonMode.Common)
            this.setState(GButton.UP);

        this.on(EventType.TOUCH_BEGIN, this.onTouchBegin_1, this);
        this.on(EventType.TOUCH_END, this.onTouchEnd_1, this);
        this.on(EventType.ROLL_OVER, this.onRollOver_1, this);
        this.on(EventType.ROLL_OUT, this.onRollOut_1, this);
        this.on(EventType.CLICK, this.onClick_1, this);
    }

    public setup_afterAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_afterAdd(buffer, beginPos);

        if (!buffer.seek(beginPos, 6))
            return;

        if (buffer.readByte() !== (this.packageItem!.objectType as number))
            return;

        let str = buffer.readS();
        if (str != null)
            this.title = str;
        str = buffer.readS();
        if (str != null)
            this.selectedTitle = str;
        str = buffer.readS();
        if (str != null)
            this.icon = str;
        str = buffer.readS();
        if (str != null)
            this.selectedIcon = str;
        if (buffer.readBool())
            this.titleColor = buffer.readColor();
        let iv = buffer.readInt();
        if (iv !== 0)
            this.titleFontSize = iv;
        iv = buffer.readShort();
        if (iv >= 0)
            this._relatedController = this.parent!.getControllerAt(iv);
        this._relatedPageId = buffer.readS();

        str = buffer.readS();
        if (str != null)
            this._sound = str;
        if (buffer.readBool())
            this._soundVolumeScale = buffer.readFloat();

        this.selected = buffer.readBool();
    }

    private onRollOver_1(): void {
        if (!this._buttonController || !this._buttonController.hasPage(GButton.OVER))
            return;

        this._over = true;
        if (this._down)
            return;

        if (this.grayed && this._buttonController.hasPage(GButton.DISABLED))
            return;

        this.setState(this._selected ? GButton.SELECTED_OVER : GButton.OVER);
    }

    private onRollOut_1(): void {
        if (!this._buttonController || !this._buttonController.hasPage(GButton.OVER))
            return;

        this._over = false;
        if (this._down)
            return;

        if (this.grayed && this._buttonController.hasPage(GButton.DISABLED))
            return;

        this.setState(this._selected ? GButton.DOWN : GButton.UP);
    }

    private onTouchBegin_1(evt: Event): void {
        if (evt.button !== 0)
            return;

        this._down = true;
        evt.captureTouch();

        if (this._mode === ButtonMode.Common) {
            if (this.grayed && this._buttonController && this._buttonController.hasPage(GButton.DISABLED))
                this.setState(GButton.SELECTED_DISABLED);
            else
                this.setState(GButton.DOWN);
        }

        if (this._linkedPopup) {
            // A `Window` toggles its own status; anything else is a plain popup
            // the root has to place. `Window` is another module's class, so the
            // distinction is structural.
            const popup = this._linkedPopup as unknown as { toggleStatus?: () => void };
            if (typeof popup.toggleStatus === 'function')
                popup.toggleStatus();
            else
                this.root?.togglePopup(this._linkedPopup, this);
        }
    }

    private onTouchEnd_1(evt: Event): void {
        if (evt.button !== 0)
            return;

        if (this._down) {
            this._down = false;

            if (this._node == null)
                return;

            if (this._mode === ButtonMode.Common) {
                if (this.grayed && this._buttonController && this._buttonController.hasPage(GButton.DISABLED))
                    this.setState(GButton.DISABLED);
                else if (this._over)
                    this.setState(GButton.OVER);
                else
                    this.setState(GButton.UP);
            } else {
                if (!this._over
                    && this._buttonController != null
                    && (this._buttonController.selectedPage === GButton.OVER
                        || this._buttonController.selectedPage === GButton.SELECTED_OVER)) {
                    this.setCurrentState();
                }
            }
        }
    }

    private onClick_1(): void {
        if (this._sound) {
            const pi = UIPackage.getItemByURL(this._sound);
            if (pi) {
                const sound = pi.owner.getItemAsset(pi);
                if (sound)
                    this.root?.playOneShotSound(sound, this._soundVolumeScale);
            }
        }

        if (this._mode === ButtonMode.Check) {
            if (this._changeStateOnClick) {
                this.selected = !this._selected;
                this.emit(EventType.STATUS_CHANGED, this);
            }
        } else if (this._mode === ButtonMode.Radio) {
            if (this._changeStateOnClick && !this._selected) {
                this.selected = true;
                this.emit(EventType.STATUS_CHANGED, this);
            }
        } else {
            if (this._relatedController)
                this._relatedController.selectedPageId = this._relatedPageId;
        }
    }
}
