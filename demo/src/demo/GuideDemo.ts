import { GRoot, GTween, RelationType, UIPackage, type GComponent } from 'fairygui-babylon';

export class GuideDemo {
    private _view!: GComponent;
    private _guideLayer!: GComponent;

    constructor() {
        UIPackage.load('ui/Guide').then(() => this.onUILoaded()).catch((err: unknown) => console.error(err));
    }

    onUILoaded(): void {
        const view = UIPackage.createObject('Guide', 'Main')?.asCom;
        if (view === undefined)
            return;
        this._view = view;
        this._view.makeFullScreen();
        GRoot.inst.addChild(this._view);

        this._guideLayer = UIPackage.createObject('Guide', 'GuideLayer')!.asCom;
        this._guideLayer.makeFullScreen();
        this._guideLayer.addRelation(GRoot.inst, RelationType.Size);

        const bagBtn = this._view.getChild('bagBtn')!;
        bagBtn.onClick(() => {
            this._guideLayer.removeFromParent();
        });

        this._view.getChild('n2')!.onClick(() => {
            GRoot.inst.addChild(this._guideLayer);
            let rect = bagBtn.localToGlobalRect(0, 0, bagBtn.width, bagBtn.height);
            rect = this._guideLayer.globalToLocalRect(rect.x, rect.y, rect.width, rect.height);

            const window = this._guideLayer.getChild('window')!;
            window.setSize(rect.width, rect.height);
            GTween.to2(window.x, window.y, rect.x, rect.y, 0.5).setTarget(window, window.setPosition);
        });
    }
}
