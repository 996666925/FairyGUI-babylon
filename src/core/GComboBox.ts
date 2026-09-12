import { GComponent } from './GComponent.js';
import { GObject } from './GObject.js';
import { GList } from './GList.js';
import { GButton } from './GButton.js';
import { ObjectPropID, PopupDirection, RelationType } from './FieldTypes.js';
import { UIConfig } from './UIConfig.js';
import { UIPackage } from './UIPackage.js';
import { Color } from './utils/Color.js';
import { EventType } from './event/Event.js';
import { isTextField, isTextInput, hasTextFieldAccessor, parseColor } from './GLabel.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { Event } from './event/Event.js';
import type { Controller } from './Controller.js';
import type { GRoot } from './GRoot.js';
import type { GTextField } from './GTextField.js';

/**
 * A drop-down list.
 *
 * Composed, not drawn: a `button` controller picks the up/down/over page, a
 * `title` and `icon` child show the current selection, and a separate component
 * — referenced by URL in this widget's extension block — is shown as the popup,
 * with a `GList` child named `list` inside it supplying the options.
 */
export class GComboBox extends GComponent {
    /**
     * The popup component. The reference left it uninitialised; it is `null`
     * when the widget was published without one, which `showDropdown` tests for.
     */
    public dropdown: GComponent | null = null;

    protected _titleObject: GObject | null = null;
    protected _iconObject: GObject | null = null;
    protected _list: GList | null = null;

    private _items: string[] = [];
    private _values: string[] = [];
    private _icons: string[] | null = null;

    private _visibleItemCount = UIConfig.defaultComboBoxVisibleItemCount;
    private _itemsUpdated = true;
    private _selectedIndex = -1;
    private _buttonController: Controller | null = null;
    private _popupDirection: PopupDirection = PopupDirection.Auto;
    private _selectionController: Controller | null = null;

    private _over = false;
    private _down = false;

    public get text(): string | null {
        if (this._titleObject)
            return this._titleObject.text;
        return null;
    }

    public set text(value: string | null) {
        if (this._titleObject)
            this._titleObject.text = value;
        this.updateGear(6);
    }

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

    public get titleColor(): Color {
        const tf = this.getTextField();
        if (tf)
            return tf.color;
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

    public get visibleItemCount(): number {
        return this._visibleItemCount;
    }

    public set visibleItemCount(value: number) {
        this._visibleItemCount = value;
    }

    public get popupDirection(): PopupDirection {
        return this._popupDirection;
    }

    public set popupDirection(value: PopupDirection) {
        this._popupDirection = value;
    }

    public get items(): string[] {
        return this._items;
    }

    public set items(value: string[] | null) {
        if (!value)
            this._items.length = 0;
        else
            this._items = value.concat();
        if (this._items.length > 0) {
            if (this._selectedIndex >= this._items.length)
                this._selectedIndex = this._items.length - 1;
            else if (this._selectedIndex === -1)
                this._selectedIndex = 0;

            this.text = this._items[this._selectedIndex];
            if (this._icons && this._selectedIndex < this._icons.length)
                this.icon = this._icons[this._selectedIndex];
        } else {
            this.text = '';
            if (this._icons)
                this.icon = null;
            this._selectedIndex = -1;
        }
        this._itemsUpdated = true;
    }

    public get icons(): string[] | null {
        return this._icons;
    }

    public set icons(value: string[] | null) {
        this._icons = value;
        if (this._icons && this._selectedIndex !== -1 && this._selectedIndex < this._icons.length)
            this.icon = this._icons[this._selectedIndex];
    }

    public get values(): string[] {
        return this._values;
    }

    public set values(value: string[] | null) {
        if (!value)
            this._values.length = 0;
        else
            this._values = value.concat();
    }

    public get selectedIndex(): number {
        return this._selectedIndex;
    }

    public set selectedIndex(val: number) {
        if (this._selectedIndex === val)
            return;

        this._selectedIndex = val;
        if (this._selectedIndex >= 0 && this._selectedIndex < this._items.length) {
            this.text = this._items[this._selectedIndex];
            if (this._icons && this._selectedIndex < this._icons.length)
                this.icon = this._icons[this._selectedIndex];
        } else {
            this.text = '';
            if (this._icons)
                this.icon = null;
        }

        this.updateSelectionController();
    }

    public get value(): string | undefined {
        return this._values[this._selectedIndex];
    }

    public set value(val: string | null) {
        let index = this._values.indexOf(val as string);
        if (index === -1 && val == null)
            index = this._values.indexOf('');
        this.selectedIndex = index;
    }

    public get selectionController(): Controller | null {
        return this._selectionController;
    }

    public set selectionController(value: Controller | null) {
        this._selectionController = value;
    }

    public getTextField(): GTextField | null {
        if (isTextField(this._titleObject))
            return this._titleObject as unknown as GTextField;
        if (hasTextFieldAccessor(this._titleObject))
            return this._titleObject.getTextField();
        return null;
    }

    protected setState(val: string): void {
        if (this._buttonController)
            this._buttonController.selectedPage = val;
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

    protected constructExtension(buffer: ByteBuffer): void {
        this._buttonController = this.getController('button');
        this._titleObject = this.getChild('title');
        this._iconObject = this.getChild('icon');

        // No `seek` here on purpose: `constructFromResource2` has already left
        // the cursor at the dropdown URL, which the editor writes ahead of this
        // widget's own extension fields. That is a property of the format, not
        // an accident — the reference reads it the same way.
        const str = buffer.readS();
        if (str) {
            const obj = UIPackage.createObjectFromURL(str);
            if (!(obj instanceof GComponent)) {
                console.error('fairygui: the drop-down of a combo box must be a component');
                return;
            }
            this.dropdown = obj;
            this.dropdown.name = 'this.dropdown';
            this._list = this.dropdown.getChild('list') as GList | null;
            if (this._list == null) {
                console.error(this.resourceURL + ': the drop-down component must contain a list named "list"');
                return;
            }
            this._list.on(EventType.CLICK_ITEM, this.onClickItem, this);

            this._list.addRelation(this.dropdown, RelationType.Width);
            this._list.removeRelation(this.dropdown, RelationType.Height);

            this.dropdown.addRelation(this._list, RelationType.Height);
            this.dropdown.removeRelation(this._list, RelationType.Width);

            this.dropdown.on(EventType.UNDISPLAY, this.onPopupClosed, this);
        }

        this.on(EventType.TOUCH_BEGIN, this.onTouchBegin_1, this);
        this.on(EventType.TOUCH_END, this.onTouchEnd_1, this);
        this.on(EventType.ROLL_OVER, this.onRollOver_1, this);
        this.on(EventType.ROLL_OUT, this.onRollOut_1, this);
    }

    public handleControllerChanged(c: Controller): void {
        super.handleControllerChanged(c);

        if (this._selectionController === c)
            this.selectedIndex = c.selectedIndex;
    }

    private updateSelectionController(): void {
        if (this._selectionController && !this._selectionController.changing
            && this._selectedIndex < this._selectionController.pageCount) {
            const c = this._selectionController;
            this._selectionController = null;
            c.selectedIndex = this._selectedIndex;
            this._selectionController = c;
        }
    }

    public dispose(): void {
        if (this.dropdown) {
            this.dropdown.dispose();
            this.dropdown = null;
        }

        super.dispose();
    }

    public setup_afterAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_afterAdd(buffer, beginPos);

        if (!buffer.seek(beginPos, 6))
            return;

        if (buffer.readByte() !== (this.packageItem!.objectType as number))
            return;

        let nextPos: number;
        let str: string | null;
        const itemCount = buffer.readShort();
        for (let i = 0; i < itemCount; i++) {
            nextPos = buffer.readShort();
            nextPos += buffer.position;

            this._items[i] = buffer.readS() as string;
            this._values[i] = buffer.readS() as string;
            str = buffer.readS();
            if (str != null) {
                if (this._icons == null)
                    this._icons = [];
                this._icons[i] = str;
            }

            buffer.position = nextPos;
        }

        str = buffer.readS();
        if (str != null) {
            this.text = str;
            this._selectedIndex = this._items.indexOf(str);
        } else if (this._items.length > 0) {
            this._selectedIndex = 0;
            this.text = this._items[0];
        } else
            this._selectedIndex = -1;

        str = buffer.readS();
        if (str != null)
            this.icon = str;

        if (buffer.readBool())
            this.titleColor = buffer.readColor();
        let iv = buffer.readInt();
        if (iv > 0)
            this._visibleItemCount = iv;
        this._popupDirection = buffer.readByte();

        iv = buffer.readShort();
        if (iv >= 0)
            this._selectionController = this.parent!.getControllerAt(iv);
    }

    protected showDropdown(): void {
        if (this._itemsUpdated) {
            this._itemsUpdated = false;

            this._list!.removeChildrenToPool();
            const cnt = this._items.length;
            for (let i = 0; i < cnt; i++) {
                const item = this._list!.addItemFromPool();
                item.name = i < this._values.length ? this._values[i] : '';
                item.text = this._items[i];
                item.icon = (this._icons && i < this._icons.length) ? this._icons[i] : null;
            }
            this._list!.resizeToFit(this._visibleItemCount);
        }
        this._list!.selectedIndex = -1;
        this.dropdown!.width = this.width;
        this._list!.ensureBoundsCorrect();

        this.root?.togglePopup(this.dropdown!, this, this._popupDirection);
        if (this.dropdown!.parent)
            this.setState(GButton.DOWN);
    }

    private onPopupClosed(): void {
        if (this._over)
            this.setState(GButton.OVER);
        else
            this.setState(GButton.UP);
    }

    private onClickItem(itemObject: GObject): void {
        const index = this._list!.getChildIndex(itemObject);
        // Deferred, as in the reference: the click that selected the item is
        // still being dispatched, and hiding the popup now would pull the list
        // out from under it.
        this.callLater(() => this.onClickItem2(index), 0.1);
    }

    private onClickItem2(index: number): void {
        // The reference tested `instanceof GRoot`. The popup's parent is
        // whichever root it was shown in, so the capability is probed instead.
        const parent = this.dropdown!.parent;
        if (parent && typeof (parent as unknown as GRoot).hidePopup === 'function')
            (parent as unknown as GRoot).hidePopup();

        this._selectedIndex = -1;
        this.selectedIndex = index;
        this.emit(EventType.STATUS_CHANGED, this);
    }

    private onRollOver_1(): void {
        this._over = true;
        if (this._down || (this.dropdown && this.dropdown.parent))
            return;

        this.setState(GButton.OVER);
    }

    private onRollOut_1(): void {
        this._over = false;
        if (this._down || (this.dropdown && this.dropdown.parent))
            return;

        this.setState(GButton.UP);
    }

    private onTouchBegin_1(evt: Event): void {
        if (evt.button !== 0)
            return;

        // A click inside an editable title's text input belongs to the input,
        // not to the drop-down.
        if (evt.initiator && isTextInput(evt.initiator as GObject)) {
            const input = evt.initiator as unknown as { editable: boolean };
            if (input.editable)
                return;
        }

        this._down = true;
        evt.captureTouch();

        if (this.dropdown)
            this.showDropdown();
    }

    private onTouchEnd_1(evt: Event): void {
        if (evt.button !== 0)
            return;

        if (this._down) {
            this._down = false;

            if (this.dropdown && !this.dropdown.parent) {
                if (this._over)
                    this.setState(GButton.OVER);
                else
                    this.setState(GButton.UP);
            }
        }
    }
}
