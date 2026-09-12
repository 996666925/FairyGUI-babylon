import { EventType, GRoot, UIPackage, type GButton, type GComponent, type GList, type GObject } from 'fairygui-babylon';

export class LoopListDemo {
    private _view!: GComponent;
    private _list!: GList;

    constructor() {
        UIPackage.load('ui/LoopList').then(() => this.onUILoaded()).catch((err: unknown) => console.error(err));
    }

    onUILoaded(): void {
        const view = UIPackage.createObject('LoopList', 'Main')?.asCom;
        if (view === undefined)
            return;
        this._view = view;
        this._view.setSize(GRoot.inst.width, GRoot.inst.height);
        GRoot.inst.addChild(this._view);

        this._list = this._view.getChild('list')!.asList;
        this._list.setVirtualAndLoop();

        this._list.itemRenderer = this.renderListItem.bind(this);
        this._list.numItems = 5;
        this._list.on(EventType.SCROLL, this.doSpecialEffect, this);
        this.doSpecialEffect();
    }

    private doSpecialEffect(): void {
        //change the scale according to the distance to the middle
        const midX: number = this._list.scrollPane!.posX + this._list.viewWidth / 2;
        const cnt: number = this._list.numChildren;
        for (let i: number = 0; i < cnt; i++) {
            const obj: GObject = this._list.getChildAt(i);
            const dist: number = Math.abs(midX - obj.x - obj.width / 2);
            if (dist > obj.width) //no intersection
                obj.setScale(1, 1);
            else {
                const ss: number = 1 + (1 - dist / obj.width) * 0.24;
                obj.setScale(ss, ss);
            }
        }

        this._view.getChild('n3')!.text = '' + ((this._list.getFirstChildInView() + 1) % this._list.numItems);
    }

    private renderListItem(index: number, obj: GObject): void {
        const item: GButton = obj as GButton;
        item.setPivot(0.5, 0.5);
        item.icon = UIPackage.getItemURL('LoopList', 'n' + (index + 1));
    }
}
