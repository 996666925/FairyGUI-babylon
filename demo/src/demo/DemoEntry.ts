import { GRoot, RelationType, UIPackage } from 'fairygui-babylon';

import { MainMenu, type Demo, type DemoStartHandler } from './MainMenu.js';

/**
 * Owns whichever screen is on show, and the CloseButton that ends it.
 *
 * The reference subscribed to a `"start_demo"` string event on the Laya stage
 * and had `MainMenu` publish it. There is no global event bus here: `MainMenu`
 * is handed a `DemoStartHandler` and calls it, so the two modules are wired
 * together by type rather than by a shared string key.
 *
 * The reference also held the CloseButton in a `_closeButton` field. Nothing
 * ever read it — the button is dropped along with everything else when the
 * screen is torn down — so it is not carried over; `noUnusedLocals` rejects a
 * private field that is only ever written.
 */
export class DemoEntry {
    /**
     * The one entry point.
     *
     * Built on first use rather than at import, so importing this module has no
     * side effects on the UI — a host that never asks for the demo application
     * never builds one.
     */
    private static _instance: DemoEntry | null = null;

    public static get instance(): DemoEntry {
        if (DemoEntry._instance === null)
            DemoEntry._instance = new DemoEntry();
        return DemoEntry._instance;
    }

    private _currentDemo: Demo;

    public constructor() {
        this._currentDemo = new MainMenu(this._onStart);
    }

    public onDemoStart(demo: Demo): void {
        this._currentDemo = demo;
        const closeButton = UIPackage.createObject('MainMenu', 'CloseButton');
        if (closeButton === null) {
            // The reference would have thrown on the next line. A viewer that
            // has lost its CloseButton is still usable, so it is reported and
            // the screen is left alone.
            console.error("fairygui-babylon demo: could not create 'MainMenu/CloseButton'");
            return;
        }

        closeButton.setPosition(
            GRoot.inst.width - closeButton.width - 10,
            GRoot.inst.height - closeButton.height - 10);
        closeButton.addRelation(GRoot.inst, RelationType.Right_Right);
        closeButton.addRelation(GRoot.inst, RelationType.Bottom_Bottom);
        closeButton.sortingOrder = 100000;
        closeButton.onClick(this._onDemoClosed);
        GRoot.inst.addChild(closeButton);
    }

    public onDemoClosed(): void {
        this._currentDemo.destroy?.();
        GRoot.inst.removeChildren(0, -1, true);

        this._currentDemo = new MainMenu(this._onStart);
    }

    /** Bound once so the listeners above and the screens share one identity. */
    private readonly _onStart: DemoStartHandler = (demo: Demo): void => this.onDemoStart(demo);
    private readonly _onDemoClosed = (): void => this.onDemoClosed();
}
