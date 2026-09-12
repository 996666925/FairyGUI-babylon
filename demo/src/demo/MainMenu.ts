import { GComponent, GRoot, UIPackage } from 'fairygui-babylon';

import { BasicDemo } from './BasicsDemo.js';
import { TransitionDemo } from './TransitionDemo.js';
import { VirtualListDemo } from './VirtualListDemo.js';
import { LoopListDemo } from './LoopListDemo.js';
import { PullToRefreshDemo } from './PullToRefreshDemo.js';
import { ModalWaitingDemo } from './ModalWaitingDemo.js';
import { JoystickDemo } from './JoystickDemo.js';
import { BagDemo } from './BagDemo.js';
import { ListEffectDemo } from './ListEffectDemo.js';
import { GuideDemo } from './GuideDemo.js';
import { CooldownDemo } from './CooldownDemo.js';
import { HitTestDemo } from './HitTestDemo.js';
import { ChatDemo } from './ChatDemo.js';
import { ScrollPaneDemo } from './ScrollPaneDemo.js';
import { TreeViewDemo } from './TreeViewDemo.js';

/**
 * A demo screen.
 *
 * Demos that load a package of their own release it from `destroy`, which is
 * what `DemoEntry` calls when the user closes one.
 */
export interface Demo {
    destroy?(): void;
}

/** Receives the demo the user picked, so `DemoEntry` can take it over. */
export type DemoStartHandler = (demo: Demo) => void;

/** A demo screen, and the menu button that opens it. */
interface MenuEntry {
    /** The editor's name for the button in `MainMenu/Main`. */
    button: string;
    /** Name used by the `?demo=` query parameter. */
    name: string;
    demo: new () => object;
}

/**
 * The menu, in the order the editor laid it out.
 *
 * `n3` is skipped by the reference too — it has no demo behind it.
 */
const MENU: readonly MenuEntry[] = [
    { button: 'n1', name: 'Basics', demo: BasicDemo },
    { button: 'n2', name: 'Transition', demo: TransitionDemo },
    { button: 'n4', name: 'VirtualList', demo: VirtualListDemo },
    { button: 'n5', name: 'LoopList', demo: LoopListDemo },
    { button: 'n6', name: 'HitTest', demo: HitTestDemo },
    { button: 'n7', name: 'PullToRefresh', demo: PullToRefreshDemo },
    { button: 'n8', name: 'ModalWaiting', demo: ModalWaitingDemo },
    { button: 'n9', name: 'Joystick', demo: JoystickDemo },
    { button: 'n10', name: 'Bag', demo: BagDemo },
    { button: 'n11', name: 'Chat', demo: ChatDemo },
    { button: 'n12', name: 'ListEffect', demo: ListEffectDemo },
    { button: 'n13', name: 'ScrollPane', demo: ScrollPaneDemo },
    { button: 'n14', name: 'TreeView', demo: TreeViewDemo },
    { button: 'n15', name: 'Guide', demo: GuideDemo },
    { button: 'n16', name: 'Cooldown', demo: CooldownDemo },
];

export class MainMenu {
    private _view: GComponent | null = null;
    private readonly _onStart: DemoStartHandler;

    /**
     * The reference published `"start_demo"` on the Laya stage from `startDemo`
     * and `DemoEntry` subscribed to it. There is no global event bus here, so
     * the handler is handed in instead — same flow, but type-checked and
     * without a string key shared across two modules.
     */
    constructor(onStart: DemoStartHandler) {
        this._onStart = onStart;
        UIPackage.load('ui/MainMenu').then(() => this.onUILoaded()).catch((err: unknown) => console.error(err));
    }

    onUILoaded(): void {
        const view = UIPackage.createObject('MainMenu', 'Main')?.asCom;
        if (view === undefined)
            return;
        this._view = view;
        view.makeFullScreen();
        GRoot.inst.addChild(view);

        for (const entry of MENU) {
            view.getChild(entry.button)!.onClick(() => {
                this.startDemo(entry.demo);
            });
        }

        // `?demo=Basics` opens a screen straight away, so one can be linked to
        // or bookmarked rather than clicked through to.
        const wanted = new URLSearchParams(location.search).get('demo');
        const match = wanted
            ? MENU.find((entry) => entry.name.toLowerCase() === wanted.toLowerCase())
            : undefined;
        if (match)
            this.startDemo(match.demo);
    }

    /**
     * The reference took `demoClass: any`. Any construct signature will do —
     * what a demo actually has to offer is only `destroy`, and a screen is free
     * not to have one — so the parameter is widened and the instance narrowed.
     */
    startDemo(demoClass: new () => object): void {
        this._view!.dispose();
        const demo: Demo = new demoClass() as Demo;
        this._onStart(demo);
    }

    destroy(): void {
        this._view!.dispose();
    }
}
