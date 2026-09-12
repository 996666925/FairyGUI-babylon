import { EaseType, GRoot, GTween, UIPackage, type GComponent, type GGroup, type GTweener } from 'fairygui-babylon';

export class TransitionDemo {
    private _view!: GComponent;

    private _btnGroup!: GGroup;
    private _g1!: GComponent;
    private _g2!: GComponent;
    private _g3!: GComponent;
    private _g4!: GComponent;
    private _g5!: GComponent;
    private _g6!: GComponent;

    private _startValue!: number;
    private _endValue!: number;

    constructor() {
        UIPackage.load('ui/Transition').then(() => this.onUILoaded()).catch((err: unknown) => console.error(err));
    }

    onUILoaded(): void {
        const view = UIPackage.createObject('Transition', 'Main')?.asCom;
        if (view === undefined)
            return;
        this._view = view;
        this._view.makeFullScreen();
        GRoot.inst.addChild(this._view);

        this._btnGroup = this._view.getChild('g0')!.asGroup;

        this._g1 = UIPackage.createObject('Transition', 'BOSS')!.asCom;
        this._g2 = UIPackage.createObject('Transition', 'BOSS_SKILL')!.asCom;
        this._g3 = UIPackage.createObject('Transition', 'TRAP')!.asCom;
        this._g4 = UIPackage.createObject('Transition', 'GoodHit')!.asCom;
        this._g5 = UIPackage.createObject('Transition', 'PowerUp')!.asCom;
        this._g6 = UIPackage.createObject('Transition', 'PathDemo')!.asCom;

        //play_num_now是在编辑器里设定的名称，这里表示播放到'play_num_now'这个位置时才开始播放数字变化效果
        this._g5.getTransition('t0')!.setHook('play_num_now', this.__playNum.bind(this));

        this._view.getChild('btn0')!.onClick(() => { this.__play(this._g1); });
        this._view.getChild('btn1')!.onClick(() => { this.__play(this._g2); });
        this._view.getChild('btn2')!.onClick(() => { this.__play(this._g3); });
        this._view.getChild('btn3')!.onClick(this.__play4, this);
        this._view.getChild('btn4')!.onClick(this.__play5, this);
        this._view.getChild('btn5')!.onClick(() => { this.__play(this._g6); });
    }

    private __play(target: GComponent): void {
        this._btnGroup.visible = false;
        GRoot.inst.addChild(target);
        const t = target.getTransition('t0')!;
        t.play(() => {
            this._btnGroup.visible = true;
            GRoot.inst.removeChild(target);
        });
    }

    private __play4(): void {
        this._btnGroup.visible = false;
        this._g4.x = GRoot.inst.width - this._g4.width - 20;
        this._g4.y = 100;
        GRoot.inst.addChild(this._g4);
        const t = this._g4.getTransition('t0')!;
        //播放3次
        t.play(() => {
            this._btnGroup.visible = true;
            GRoot.inst.removeChild(this._g4);
        }, 3);
    }

    private __play5(): void {
        this._btnGroup.visible = false;
        this._g5.x = 20;
        this._g5.y = GRoot.inst.height - this._g5.height - 100;
        GRoot.inst.addChild(this._g5);
        const t = this._g5.getTransition('t0')!;
        this._startValue = 10000;
        const add: number = Math.ceil(Math.random() * 2000 + 1000);
        this._endValue = this._startValue + add;
        this._g5.getChild('value')!.text = '' + this._startValue;
        this._g5.getChild('add_value')!.text = '+' + add;
        t.play(() => {
            this._btnGroup.visible = true;
            GRoot.inst.removeChild(this._g5);
        });
    }

    private __playNum(): void {
        //这里演示了一个数字变化的过程
        GTween.to(this._startValue, this._endValue, 0.3)
            .setEase(EaseType.Linear)
            .onUpdate((tweener: GTweener) => {
                this._g5.getChild('value')!.text = '' + Math.floor(tweener.value.x);
            }, this);
    }
}
