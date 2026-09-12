import { GRoot, UIPackage } from 'fairygui-babylon';

/**
 * The reference also kept the built component in a `_view` field that nothing
 * ever read; `noUnusedLocals` rejects a private field that is only written, so
 * it is not carried over here.
 */
export class HitTestDemo {
    constructor() {
        UIPackage.load('ui/HitTest').then(() => this.onUILoaded()).catch((err: unknown) => console.error(err));
    }

    onUILoaded(): void {
        const view = UIPackage.createObject('HitTest', 'Main')?.asCom;
        if (view === undefined)
            return;
        view.makeFullScreen();
        GRoot.inst.addChild(view);
    }

    destroy(): void {

    }
}
