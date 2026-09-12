import { GComponent } from './GComponent.js';
import { GObject } from './GObject.js';
import { GList } from './GList.js';
import { GButton } from './GButton.js';
import { GRoot } from './GRoot.js';
import { UIConfig } from './UIConfig.js';
import { RelationType, type PopupDirection } from './FieldTypes.js';
import { EventType } from './event/Event.js';
import { UIPackage } from './UIPackage.js';

import type { Controller } from './Controller.js';
import type { Event } from './event/Event.js';

/** Delay before a menu item's callback fires, so the click animation shows. */
const MENU_ITEM_DELAY = 0.1;

/**
 * A drop-down menu.
 *
 * The layout comes from a `GList` inside a component named by
 * `UIConfig.popupMenu`, so a project restyles its menus by swapping that
 * resource rather than by configuring this class.
 */
export class PopupMenu {
    protected _contentPane: GComponent;
    protected _list: GList;

    public constructor(url?: string) {
        const source = url ?? UIConfig.popupMenu;
        if (!source)
            throw new Error('fairygui: UIConfig.popupMenu is not defined, so no menu layout is available.');

        const pane = UIPackage.createObjectFromURL(source);
        if (!(pane instanceof GComponent)) {
            throw new Error(
                `fairygui: '${source}' is not a component, so it cannot be used as a popup menu layout.`,
            );
        }
        this._contentPane = pane;

        this._contentPane.on(EventType.DISPLAY, this.onDisplay, this);
        this._list = this._contentPane.getChild('list') as GList;

        this._list.removeChildrenToPool();
        // The list sizes itself to the menu's width but drives the menu's
        // height, so the relation runs the other way for height.
        this._list.addRelation(this._contentPane, RelationType.Width);
        this._list.removeRelation(this._contentPane, RelationType.Height);
        this._contentPane.addRelation(this._list, RelationType.Height);
        this._list.on(EventType.CLICK_ITEM, this.onClickItem, this);
    }

    public dispose(): void {
        this._contentPane.dispose();
    }

    // ---- items -----------------------------------------------------------

    public addItem(caption: string, callback?: (item?: GObject, evt?: Event) => void): GButton {
        const item = this._list.addItemFromPool() as GButton;
        return this.setupItem(item, caption, callback);
    }

    public addItemAt(caption: string, index: number, callback?: (item?: GObject, evt?: Event) => void): GButton {
        const item = this._list.getFromPool() as GButton;
        this._list.addChildAt(item, index);
        return this.setupItem(item, caption, callback);
    }

    private setupItem(item: GButton, caption: string, callback?: (item?: GObject, evt?: Event) => void): GButton {
        item.title = caption;
        item.data = callback ?? null;
        item.grayed = false;

        const c: Controller | null = item.getController('checked');
        if (c)
            c.selectedIndex = 0;

        return item;
    }

    public addSeperator(): void {
        if (UIConfig.popupMenu_seperator == null)
            throw new Error('fairygui: UIConfig.popupMenu_seperator is not defined.');
        this._list.addItemFromPool(UIConfig.popupMenu_seperator);
    }

    public getItemName(index: number): string {
        return this._list.getChildAt(index).name;
    }

    public setItemText(name: string, caption: string): void {
        (this._list.getChild(name) as GButton).title = caption;
    }

    public setItemVisible(name: string, visible: boolean): void {
        const item = this._list.getChild(name);
        if (!item || item.visible === visible)
            return;
        item.visible = visible;
        this._list.setBoundsChangedFlag();
    }

    public setItemGrayed(name: string, grayed: boolean): void {
        (this._list.getChild(name) as GButton).grayed = grayed;
    }

    public setItemCheckable(name: string, checkable: boolean): void {
        const c = (this._list.getChild(name) as GButton).getController('checked');
        if (!c)
            return;

        if (checkable) {
            if (c.selectedIndex === 0)
                c.selectedIndex = 1;
        } else {
            c.selectedIndex = 0;
        }
    }

    public setItemChecked(name: string, checked: boolean): void {
        const c = (this._list.getChild(name) as GButton).getController('checked');
        if (c)
            c.selectedIndex = checked ? 2 : 1;
    }

    public isItemChecked(name: string): boolean {
        const c = (this._list.getChild(name) as GButton).getController('checked');
        return c ? c.selectedIndex === 2 : false;
    }

    public removeItem(name: string): boolean {
        const item = this._list.getChild(name);
        if (!item)
            return false;

        this._list.removeChildToPoolAt(this._list.getChildIndex(item));
        return true;
    }

    public clearItems(): void {
        this._list.removeChildrenToPool();
    }

    public get itemCount(): number {
        return this._list.numChildren;
    }

    public get contentPane(): GComponent {
        return this._contentPane;
    }

    public get list(): GList {
        return this._list;
    }

    // ---- showing ---------------------------------------------------------

    public show(target: GObject | null = null, dir?: PopupDirection | boolean): void {
        const r = target != null ? target.root : GRoot.inst;
        if (!r)
            return;
        // Anchoring to the root itself means "no target", not "anchor to root".
        const isRoot = (target as unknown as { isRoot?: boolean } | null)?.isRoot === true;
        r.showPopup(this.contentPane, isRoot ? null : target, dir);
    }

    // ---- internals -------------------------------------------------------

    /**
     * Defers the real click handling by a frame or so, so the menu has already
     * closed — and the pressed state has drawn — before the callback runs.
     */
    private onClickItem(item: GObject | null, evt: Event): void {
        this._list.callLater(() => this.onClickItem2(item, evt), MENU_ITEM_DELAY);
    }

    private onClickItem2(item: GObject | null, evt: Event): void {
        if (!(item instanceof GButton))
            return;

        if (item.grayed) {
            this._list.selectedIndex = -1;
            return;
        }

        // A checkable item toggles between checked and unchecked.
        const c = item.getController('checked');
        if (c && c.selectedIndex !== 0) {
            c.selectedIndex = c.selectedIndex === 1 ? 2 : 1;
        }

        const parent = this._contentPane.parent;
        if (parent instanceof GRoot)
            parent.hidePopup(this._contentPane);

        if (typeof item.data === 'function')
            (item.data as (item?: GObject, evt?: Event) => void)(item, evt);
    }

    private onDisplay = (): void => {
        this._list.selectedIndex = -1;
        this._list.resizeToFit(100000, 10);
    };
}
