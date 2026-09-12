import { GRoot, UIPackage, type GComponent, type GTextField } from 'fairygui-babylon';

import { JoystickModule } from './JoystickModule.js';

export class JoystickDemo {
    private _view!: GComponent;
    private _joystick!: JoystickModule;
    private _text!: GTextField;

    constructor() {
        UIPackage.load('ui/Joystick').then(() => this.onUILoaded()).catch((err: unknown) => console.error(err));
    }

    onUILoaded(): void {
        const view = UIPackage.createObject('Joystick', 'Main')?.asCom;
        if (view === undefined)
            return;
        this._view = view;
        this._view.setSize(GRoot.inst.width, GRoot.inst.height);
        GRoot.inst.addChild(this._view);

        this._text = this._view.getChild('n9')!.asTextField;

        this._joystick = new JoystickModule(this._view);
        this._joystick.on(JoystickModule.JoystickMoving, this.onJoystickMoving, this);
        this._joystick.on(JoystickModule.JoystickUp, this.onJoystickUp, this);
    }

    private onJoystickMoving(degree: number): void {
        this._text.text = '' + degree;
    }

    private onJoystickUp(): void {
        this._text.text = '';
    }
}
