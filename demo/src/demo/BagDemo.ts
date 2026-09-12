import {
    EventType,
    GRoot,
    UIPackage,
    Window,
    type GComponent,
    type GList,
    type GObject,
} from 'fairygui-babylon';

export class BagDemo {
    private _view!: GComponent;
    private _bagWindow!: Window;

    constructor() {
        UIPackage.load('ui/Bag').then(() => this.onUILoaded()).catch((err: unknown) => console.error(err));
    }

    onUILoaded(): void {
        const view = UIPackage.createObject('Bag', 'Main')?.asCom;
        if (view === undefined)
            return;
        this._view = view;
        this._view.makeFullScreen();
        GRoot.inst.addChild(this._view);

        this._bagWindow = new BagWindow();
        this._view.getChild('bagBtn')!.onClick(() => { this._bagWindow.show(); });
    }

    destroy(): void {
        UIPackage.removePackage('Bag');
    }
}

class BagWindow extends Window {
    public constructor() {
        super();
    }

    protected onInit(): void {
        this.contentPane = UIPackage.createObject('Bag', 'BagWin')!.asCom;
        this.center();
    }

    protected onShown(): void {
        const list: GList = this.contentPane!.getChild('list')!.asList;
        list.on(EventType.CLICK_ITEM, this.onClickItem, this);
        list.itemRenderer = this.renderListItem.bind(this);
        list.setVirtual();
        list.numItems = 45;
    }

    private renderListItem(_index: number, obj: GObject): void {
        obj.icon = '/icons/i' + Math.floor(Math.random() * 10) + '.png';
        obj.text = '' + Math.floor(Math.random() * 100);
    }

    private onClickItem(item: GObject): void {
        this.contentPane!.getChild('n11')!.asLoader.url = item.icon;
        this.contentPane!.getChild('n13')!.text = item.icon;
    }
}
