import { GRoot, UIConfig, UIPackage, type GComponent } from 'fairygui-babylon';

import { TestWin } from './TestWin.js';

export class ModalWaitingDemo {
    private _view!: GComponent;
    private _testWin!: TestWin;

    constructor() {
        UIConfig.globalModalWait = 'ui://ModalWaiting/GlobalModalWaiting';
        UIConfig.windowModalWaiting = 'ui://ModalWaiting/WindowModalWaiting';

        UIPackage.load('ui/ModalWaiting').then(() => this.onUILoaded()).catch((err: unknown) => console.error(err));
    }

    onUILoaded(): void {
        const view = UIPackage.createObject('ModalWaiting', 'Main')?.asCom;
        if (view === undefined)
            return;
        this._view = view;
        this._view.setSize(GRoot.inst.width, GRoot.inst.height);
        GRoot.inst.addChild(this._view);

        this._testWin = new TestWin();
        this._view.getChild('n0')!.onClick(() => { this._testWin.show(); });

        //这里模拟一个要锁住全屏的等待过程
        GRoot.inst.showModalWait();
        setTimeout(() => {
            GRoot.inst.closeModalWait();
        }, 3000);
    }
}
