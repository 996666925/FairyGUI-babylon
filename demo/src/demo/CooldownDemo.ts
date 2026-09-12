import { GRoot, GTween, UIPackage, type GComponent, type GProgressBar } from 'fairygui-babylon';

export class CooldownDemo {
    private _view!: GComponent;
    private _btn0!: GProgressBar;
    private _btn1!: GProgressBar;

    constructor() {
        UIPackage.load('ui/Cooldown').then(() => this.onUILoaded()).catch((err: unknown) => console.error(err));
    }

    onUILoaded(): void {
        const view = UIPackage.createObject('Cooldown', 'Main')?.asCom;
        if (view === undefined)
            return;
        this._view = view;
        this._view.makeFullScreen();
        GRoot.inst.addChild(this._view);

        this._btn0 = this._view.getChild('b0')!.asProgress;
        this._btn1 = this._view.getChild('b1')!.asProgress;
        this._btn0.getChild('icon')!.icon = '/icons/k0.png';
        this._btn1.getChild('icon')!.icon = '/icons/k1.png';

        GTween.to(0, 100, 5).setTarget(this._btn0, 'value').setRepeat(-1);
        GTween.to(10, 0, 10).setTarget(this._btn1, 'value').setRepeat(-1);
    }
}
