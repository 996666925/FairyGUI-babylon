import {
    EventType,
    GRoot,
    UIPackage,
    type Event,
    type GButton,
    type GComponent,
    type GList,
    type GObject,
} from 'fairygui-babylon';

export class ScrollPaneDemo {
    private _view!: GComponent;
    private _list!: GList;

    constructor() {
        UIPackage.load('ui/ScrollPane').then(() => this.onUILoaded()).catch((err: unknown) => console.error(err));
    }

    onUILoaded(): void {
        const view = UIPackage.createObject('ScrollPane', 'Main')?.asCom;
        if (view === undefined)
            return;
        this._view = view;
        this._view.makeFullScreen();
        GRoot.inst.addChild(this._view);

        this._list = this._view.getChild('list')!.asList;
        // The reference handed `renderListItem` straight to `Laya.Handler`,
        // which did not check that the item it passes is a `GButton`; the
        // wrapper is what narrows `GObject` down for the item renderer.
        this._list.itemRenderer = (index: number, item: GObject) => this.renderListItem(index, item.asButton);
        this._list.setVirtual();
        this._list.numItems = 1000;
        this._list.on(EventType.TOUCH_BEGIN, this.onClickList, this);
    }

    private renderListItem(index: number, item: GButton): void {
        item.title = 'Item ' + index;
        item.scrollPane!.posX = 0; //reset scroll pos

        item.getChild('b0')!.onClick(this.onClickStick, this);
        item.getChild('b1')!.onClick(this.onClickDelete, this);
    }

    private onClickList(evt: Event): void {
        //点击列表时，查找是否有项目处于编辑状态， 如果有就归位
        const touchTarget = evt.initiator as GObject;
        const cnt = this._list.numChildren;
        for (let i: number = 0; i < cnt; i++) {
            const item: GButton = this._list.getChildAt(i).asButton;
            if (item.scrollPane!.posX != 0) {
                //Check if clicked on the button
                if (item.getChild('b0')!.asButton.isAncestorOf(touchTarget)
                    || item.getChild('b1')!.asButton.isAncestorOf(touchTarget)) {
                    return;
                }
                item.scrollPane!.setPosX(0, true);

                //取消滚动面板可能发生的拉动。
                item.scrollPane!.cancelDragging();
                this._list.scrollPane!.cancelDragging();
                break;
            }
        }
    }

    private onClickStick(evt: Event): void {
        this._view.getChild('txt')!.text = 'Stick ' + (evt.currentTarget as GObject).parent!.text;
    }

    private onClickDelete(evt: Event): void {
        this._view.getChild('txt')!.text = 'Delete ' + (evt.currentTarget as GObject).parent!.text;
    }
}
