import { describe, expect, test } from '@rstest/core';
import { GComponent } from '../src/core/GComponent.js';
import { GRoot } from '../src/core/GRoot.js';
import { UIPackage } from '../src/core/UIPackage.js';
import { Window } from '../src/core/Window.js';
import { setRenderFactory } from '../src/core/render/IRenderObject.js';
import { setScrollPaneClass, setTransitionClass } from '../src/core/Builtins.js';
import { ScrollPane } from '../src/core/ScrollPane.js';
import { Transition } from '../src/core/Transition.js';
import { MockRenderer } from './helpers/mockRender.js';
import { readFixture } from './helpers/fixtures.js';

// The object factory has to be installed before a package can be built into
// widgets, and `Window` is one of them.
import '../src/index.js';

setRenderFactory(new MockRenderer());
setScrollPaneClass(ScrollPane);
setTransitionClass(Transition);

/** A component that records every liveness flip it is told about. */
class Tracker extends GComponent {
    public log: string[] = [];

    protected override onEnable(): void {
        super.onEnable();
        this.log.push('enable');
    }

    protected override onDisable(): void {
        super.onDisable();
        this.log.push('disable');
    }
}

function emptyRoot(): GRoot {
    const root = GRoot.create();
    root.removeChildren(0, -1, true);
    return root;
}

describe('display-list lifecycle', () => {
    test('a branch comes alive when it joins a root, and dies when it leaves', () => {
        const root = emptyRoot();

        const outer = new Tracker();
        const inner = new Tracker();
        outer.addChild(inner);

        expect([outer.log.length, inner.log.length], 'nothing is live off the stage').toEqual([0, 0]);

        root.addChild(outer);
        expect(outer.log, 'the object that was added').toEqual(['enable']);
        expect(inner.log, 'and its whole subtree with it').toEqual(['enable']);

        root.removeChild(outer);
        expect(outer.log).toEqual(['enable', 'disable']);
        expect(inner.log).toEqual(['enable', 'disable']);
    });

    test('hiding an ancestor stops the branch being live', () => {
        const root = emptyRoot();

        const outer = new Tracker();
        const inner = new Tracker();
        outer.addChild(inner);
        root.addChild(outer);

        outer.visible = false;
        expect(inner.log, 'a hidden branch is not live, however visible it is itself')
            .toEqual(['enable', 'disable']);

        outer.visible = true;
        expect(inner.log).toEqual(['enable', 'disable', 'enable']);
    });

    test('a component built off the stage only goes live once it is attached', () => {
        const root = emptyRoot();

        const kept = new Tracker();
        expect(kept.log, 'built but not attached').toEqual([]);

        root.addChild(kept);
        expect(kept.log).toEqual(['enable']);

        kept.removeFromParent();
        expect(kept.log).toEqual(['enable', 'disable']);

        root.addChild(kept);
        expect(kept.log, 'and again on the way back in').toEqual(['enable', 'disable', 'enable']);
    });

    test('a window builds its content the first time it is shown', () => {
        // `Window.init` hangs off `onEnable`, so a window whose liveness is never
        // reported is shown with no content and no size — which is what the bag
        // window used to do.
        const root = emptyRoot();
        UIPackage.parse(readFixture('Bag.fui'), 'ui/Bag');

        let inits = 0;
        class BagWindow extends Window {
            protected override onInit(): void {
                inits++;
                this.contentPane = UIPackage.createObject('Bag', 'BagWin')!.asCom;
                this.center();
            }
        }

        const win = new BagWindow();
        expect([win.width, win.height], 'nothing is built yet').toEqual([0, 0]);

        win.show();
        expect(inits, 'onInit ran on the first show').toBe(1);
        expect(win.contentPane, 'and the content is there').not.toBeNull();
        expect(win.parent, 'the window is on the root').toBe(root);
        expect(win.width, 'sized to its content').toBeGreaterThan(0);
        expect(win.height).toBeGreaterThan(0);

        // Centred on the root, which it could only measure once attached.
        expect(win.x).toBe(Math.round((root.width - win.width) / 2));

        win.hide();
        expect(win.parent, 'hiding takes it off the root').toBeNull();
    });
});
