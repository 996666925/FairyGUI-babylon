import { GRoot, UIObjectFactory, UIPackage, type GComponent, type GList, type GObject } from 'fairygui-babylon';

import { MailItem } from './MailItem.js';

export class VirtualListDemo {
    private _view!: GComponent;
    private _list!: GList;

    constructor() {
        UIPackage.load('ui/VirtualList').then(() => this.onUILoaded()).catch((err: unknown) => console.error(err));
    }

    onUILoaded(): void {
        UIObjectFactory.setExtension('ui://VirtualList/mailItem', MailItem);

        const view = UIPackage.createObject('VirtualList', 'Main')?.asCom;
        if (view === undefined)
            return;
        this._view = view;
        this._view.makeFullScreen();
        GRoot.inst.addChild(this._view);

        this._view.getChild('n6')!.onClick(() => { this._list.addSelection(500, true); });
        this._view.getChild('n7')!.onClick(() => { this._list.scrollPane!.scrollTop(); });
        this._view.getChild('n8')!.onClick(() => { this._list.scrollPane!.scrollBottom(); });

        this._list = this._view.getChild('mailList')!.asList;
        this._list.setVirtual();

        this._list.itemRenderer = this.renderListItem.bind(this);
        this._list.numItems = 1000;
    }

    private renderListItem(index: number, obj: GObject): void {
        const item: MailItem = obj as MailItem;
        item.setFetched(index % 3 == 0);
        item.setRead(index % 2 == 0);
        item.setTime('5 Nov 2015 16:24:33');
        item.title = index + ' Mail title here';
    }
}
