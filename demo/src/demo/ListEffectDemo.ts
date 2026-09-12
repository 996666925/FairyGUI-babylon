import { GRoot, UIObjectFactory, UIPackage, type GComponent, type GList } from 'fairygui-babylon';

import { MailItem } from './MailItem.js';

export class ListEffectDemo {
    private _view!: GComponent;
    private _list!: GList;

    constructor() {
        UIPackage.load('ui/ListEffect').then(() => this.onUILoaded()).catch((err: unknown) => console.error(err));
    }

    onUILoaded(): void {
        UIObjectFactory.setExtension('ui://ListEffect/mailItem', MailItem);

        const view = UIPackage.createObject('ListEffect', 'Main')?.asCom;
        if (view === undefined)
            return;
        this._view = view;
        this._view.setSize(GRoot.inst.width, GRoot.inst.height);
        GRoot.inst.addChild(this._view);

        this._list = this._view.getChild('mailList')!.asList;
        for (let i: number = 0; i < 10; i++) {
            const item: MailItem = this._list.addItemFromPool() as MailItem;
            item.setFetched(i % 3 == 0);
            item.setRead(i % 2 == 0);
            item.setTime('5 Nov 2015 16:24:33');
            item.title = 'Mail title here';
        }

        this._list.ensureBoundsCorrect();
        let delay: number = 0;
        for (let i: number = 0; i < 10; i++) {
            const item: MailItem = this._list.getChildAt(i) as MailItem;
            if (this._list.isChildInView(item)) {
                item.playEffect(delay);
                delay += 0.2;
            }
            else
                break;
        }
    }
}
