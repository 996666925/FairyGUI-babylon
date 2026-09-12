import { EventType, GRoot, UIObjectFactory, UIPackage, type GComponent, type GList, type GObject } from 'fairygui-babylon';

import { ScrollPaneHeader } from './ScrollPaneHeader.js';

export class PullToRefreshDemo {
    private _view!: GComponent;
    private _list1!: GList;
    private _list2!: GList;

    constructor() {
        UIObjectFactory.setExtension('ui://PullToRefresh/Header', ScrollPaneHeader);

        UIPackage.load('ui/PullToRefresh').then(() => this.onUILoaded()).catch((err: unknown) => console.error(err));
    }

    onUILoaded(): void {
        const view = UIPackage.createObject('PullToRefresh', 'Main')?.asCom;
        if (view === undefined)
            return;
        this._view = view;
        this._view.makeFullScreen();
        GRoot.inst.addChild(this._view);

        this._list1 = this._view.getChild('list1')!.asList;
        this._list1.itemRenderer = this.renderListItem1.bind(this);
        this._list1.setVirtual();
        this._list1.numItems = 1;
        this._list1.on(EventType.PULL_DOWN_RELEASE, this.onPullDownToRefresh, this);

        this._list2 = this._view.getChild('list2')!.asList;
        this._list2.itemRenderer = this.renderListItem2.bind(this);
        this._list2.setVirtual();
        this._list2.numItems = 1;
        this._list2.on(EventType.PULL_UP_RELEASE, this.onPullUpToRefresh, this);
    }

    private renderListItem1(index: number, item: GObject): void {
        item.text = 'Item ' + (this._list1.numItems - index - 1);
    }

    private renderListItem2(index: number, item: GObject): void {
        item.text = 'Item ' + index;
    }

    // The reference's listener took the (unused) event; `noUnusedParameters`
    // is why it is gone here.
    private onPullDownToRefresh(): void {
        const header: ScrollPaneHeader = this._list1.scrollPane!.header as ScrollPaneHeader;
        if (header.readyToRefresh) {
            header.setRefreshStatus(2);
            this._list1.scrollPane!.lockHeader(header.sourceHeight);

            //Simulate a async resquest
            setTimeout(() => {
                if (this._view.disposed)
                    return;
                this._list1.numItems += 5;

                //Refresh completed
                header.setRefreshStatus(3);
                this._list1.scrollPane!.lockHeader(35);

                setTimeout(() => {
                    header.setRefreshStatus(0);
                    this._list1.scrollPane!.lockHeader(0);
                }, 2000);
            }, 2000);
        }
    }

    private onPullUpToRefresh(): void {
        const footer: GComponent = this._list2.scrollPane!.footer!.asCom;

        footer.getController('c1')!.selectedIndex = 1;
        this._list2.scrollPane!.lockFooter(footer.sourceHeight);

        //Simulate a async resquest
        setTimeout(() => {
            if (this._view.disposed)
                return;
            this._list2.numItems += 5;

            //Refresh completed
            footer.getController('c1')!.selectedIndex = 0;
            this._list2.scrollPane!.lockFooter(0);
        }, 2000);
    }
}
