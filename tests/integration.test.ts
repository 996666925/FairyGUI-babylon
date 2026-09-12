import { describe, expect, test } from '@rstest/core';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Scene } from '@babylonjs/core/scene.js';

import { installBabylonRenderer } from '../src/babylon/index.js';
import { DragDropManager } from '../src/core/DragDropManager.js';
import { GButton } from '../src/core/GButton.js';
import { GComponent } from '../src/core/GComponent.js';
import { GGraph } from '../src/core/GGraph.js';
import { GImage } from '../src/core/GImage.js';
import { GObject } from '../src/core/GObject.js';
import { GRoot } from '../src/core/GRoot.js';
import type { GTextField } from '../src/core/GTextField.js';
import type { BabTextObject } from '../src/babylon/BabTextObject.js';
import { PackageItemType } from '../src/core/FieldTypes.js';
import { UIPackage } from '../src/core/UIPackage.js';
import { readFixture } from './helpers/fixtures.js';
import '../src/index.js';

/**
 * End-to-end: real published packages, the real Babylon backend, a headless
 * engine. Nothing here is stubbed except the GPU.
 *
 * These are the tests that would catch a break anywhere along the chain —
 * parser, display list, widget construction, backend seam — that the focused
 * unit suites each miss on their own.
 */

function makeScene(): { engine: NullEngine; scene: Scene } {
    const engine = new NullEngine({
        renderWidth: 1136,
        renderHeight: 640,
        textureSize: 256,
        deterministicLockstep: false,
        lockstepMaxSteps: 1,
    });
    return { engine, scene: new Scene(engine) };
}

/** Builds a component from a fixture package. */
function build(pkgName: string, itemName: string): GObject {
    const pkg = UIPackage.parse(readFixture(`${pkgName}.fui`), `ui/${pkgName}`);
    const obj = pkg.createObject(itemName);
    if (!obj)
        throw new Error(`could not build ${pkgName}/${itemName}`);
    return obj;
}

describe('end to end', () => {
    test('a package component builds into a live Babylon display list', () => {
        const { scene } = makeScene();
        const renderer = installBabylonRenderer({ scene, width: 1136, height: 640 });

        const main = build('MainMenu', 'Main') as GComponent;
        const root = GRoot.create();
        root.addChild(main);
        root.update(1 / 60);

        // The component's authored contents came across. The editor leaves its
        // auto-generated children unnamed (`n1`…), so the shape of the list is
        // the assertion rather than any particular name.
        expect(main.width).toBe(1136);
        expect(main.height).toBe(640);
        expect(main.numChildren).toBe(16);

        // A full-bleed graph behind fifteen buttons, laid out in three columns.
        const background = main.getChildAt(0);
        expect(background).toBeInstanceOf(GGraph);
        expect([background.width, background.height]).toEqual([1136, 640]);

        const buttons = main._children.filter((c) => c instanceof GButton);
        expect(buttons).toHaveLength(15);
        expect(new Set(buttons.map((b) => b.x))).toEqual(new Set([104, 450, 796]));

        // Every object in the tree got a Babylon node, and the leaf images got
        // meshes. A seam that silently returned nothing would show up here.
        const images: GImage[] = [];
        const walk = (obj: GObject): void => {
            if (obj instanceof GImage)
                images.push(obj);
            const com = obj as GComponent;
            if (typeof com.numChildren === 'number') {
                for (let i = 0; i < com.numChildren; i++)
                    walk(com.getChildAt(i));
            }
        };
        walk(main);

        expect(images.length, 'the package has images').toBeGreaterThan(0);
        for (const image of images)
            expect(image.node, `${image.name} has a render node`).toBeTruthy();

        expect(scene.meshes.length, 'the backend built geometry').toBeGreaterThan(0);

        root.removeChild(main);
        renderer.packageAssets.dispose();
    });

    test('atlas items resolve to textures and reach the image objects', () => {
        const { scene } = makeScene();
        const renderer = installBabylonRenderer({ scene, width: 1136, height: 640 });

        const pkg = UIPackage.parse(readFixture('MainMenu.fui'), 'ui/MainMenu');
        const atlas = pkg.items.find((i) => i.type === PackageItemType.Atlas)!;
        expect(atlas.file).toBe('ui/MainMenu_atlas0.png');

        // The resolver is synchronous by design: `GImage` asks while it builds.
        const texture = renderer.packageAssets.resolve(atlas);
        expect(texture, 'an atlas resolves to a texture').toBeTruthy();

        // Asking twice must not allocate a second GPU texture for one file.
        expect(renderer.packageAssets.resolve(atlas)).toBe(texture);

        renderer.packageAssets.dispose();
    });

    test('a component can be built before any root exists, then attached', () => {
        const { scene } = makeScene();
        const renderer = installBabylonRenderer({ scene, width: 1136, height: 640 });

        // Building detached is the normal flow — `UIPackage.createObject` has no
        // root to hang off — so nothing may depend on one being present.
        const main = build('Bag', 'BagWin') as GComponent;
        expect(main.numChildren).toBeGreaterThan(0);

        const root = GRoot.create();
        root.addChild(main);
        expect(main.parent).toBe(root);
        expect(main.onStage).toBe(true);

        root.update(1 / 60);
        root.removeChild(main);
        renderer.packageAssets.dispose();
    });

    test('every shipped package builds without throwing', () => {
        const { scene } = makeScene();
        const renderer = installBabylonRenderer({ scene, width: 1136, height: 640 });

        const packages = [
            'Bag', 'Basics', 'Chat', 'Cooldown', 'Guide', 'HitTest', 'Joystick',
            'ListEffect', 'LoopList', 'MainMenu', 'ModalWaiting', 'PullToRefresh',
            'ScrollPane', 'Transition', 'TreeView', 'VirtualList',
        ];

        const root = GRoot.create();
        let built = 0;

        for (const name of packages) {
            const pkg = UIPackage.parse(readFixture(`${name}.fui`), `ui/${name}`);
            for (const item of pkg.items) {
                // Every component the editor published should construct.
                if (item.type !== PackageItemType.Component || item.name == null)
                    continue;

                const obj = pkg.createObject(item.name);
                expect(obj, `${name}/${item.name} built`).toBeTruthy();

                root.addChild(obj!);
                root.update(1 / 60);
                root.removeChild(obj!);
                built++;
            }
        }

        // A floor, not an exact count: this is here so the loop cannot quietly
        // stop exercising anything.
        expect(built, 'components constructed across the corpus').toBeGreaterThan(20);
        renderer.packageAssets.dispose();
    });

    test('the backend leaves a host camera and host meshes alone', () => {
        const { scene } = makeScene();
        // A host camera must exist before the UI comes up, or there is nothing
        // for the backend to preserve.
        const host = new Camera('host', new Vector3(0, 5, -10), scene);

        const renderer = installBabylonRenderer({ scene, width: 320, height: 240 });
        // Nothing of the host's should have been disturbed by the UI coming up.
        expect(scene.activeCamera).toBe(host);
        expect(renderer.camera).not.toBe(host);
        expect(renderer.camera.layerMask & host.layerMask).toBe(0);

        const main = build('MainMenu', 'Main') as GComponent;
        const root = GRoot.create();
        root.addChild(main);
        root.update(1 / 60);

        // Host geometry is untouched: the UI draws on its own layer.
        for (const mesh of scene.meshes) {
            if (mesh.name.startsWith('fgui-'))
                expect(mesh.layerMask).toBe(renderer.uiLayerMask);
        }

        root.removeChild(main);
        renderer.packageAssets.dispose();
    });

    test('the viewport drives the root size', () => {
        const { scene } = makeScene();
        const renderer = installBabylonRenderer({ scene, width: 800, height: 600 });

        // `GRoot` is a singleton, but it re-binds to whichever backend is
        // current, so a root made by an earlier renderer still follows this one.
        const root = GRoot.create();
        expect(root.width).toBe(800);
        expect(root.height).toBe(600);

        renderer.setViewport(1024, 768);
        expect(root.width).toBe(1024);
        expect(root.height).toBe(768);

        renderer.packageAssets.dispose();
    });

    test('a dragged drop agent stays centred on the pointer', () => {
        // Only a real backend can catch this: `localToGlobal` reports the
        // content box's top-left, while `setPosition` anchors at the pivot, and
        // the agent is pivot-anchored so that it sits centred on the pointer
        // when it appears. A drag that moves the box's top-left onto the pointer
        // instead leaves the icon trailing the cursor by half its own size.
        const { scene } = makeScene();
        const renderer = installBabylonRenderer({ scene, width: 800, height: 600 });
        const root = GRoot.create();
        root.removeChildren(0, -1, true);

        const source = new GComponent();
        source.opaque = true;
        source.setSize(40, 40);
        source.setPosition(200, 200);
        root.addChild(source);

        const input = root.inputProcessor;
        input.touchBegin(1, 210, 210);
        DragDropManager.inst.startDrag(source, 'ui://Basics/r0');

        const agent = DragDropManager.inst.dragAgent;
        const centreOfAgent = (): { x: number; y: number } =>
            agent.localToGlobal(agent.width / 2, agent.height / 2);

        const atPress = centreOfAgent();
        expect([atPress.x, atPress.y], 'centred on the pointer as it appears').toEqual([210, 210]);

        input.touchMove(1, 400, 420);
        const moved = centreOfAgent();
        expect([moved.x, moved.y], 'and still centred after the first move').toEqual([400, 420]);

        input.touchMove(1, 260, 190);
        const movedAgain = centreOfAgent();
        expect([movedAgain.x, movedAgain.y], 'and after the next one').toEqual([260, 190]);

        input.touchEnd(1, 260, 190);
        DragDropManager.inst.cancel();
        renderer.packageAssets.dispose();
    });

    test('a package font lays its text out from the glyph table', () => {
        // `Transition/PowerUp` is authored against two image fonts: `value` uses
        // `number1` and `add_value` uses `number2`. Nothing here is stubbed
        // except the GPU, so this is the whole chain — parse, font lookup, the
        // size snap, the layout and the glyph quads.
        const { scene } = makeScene();
        const renderer = installBabylonRenderer({ scene, width: 1136, height: 640 });
        const root = GRoot.create();
        root.removeChildren(0, -1, true);

        const powerUp = build('Transition', 'PowerUp') as GComponent;
        root.addChild(powerUp);
        root.update(1 / 60);
        // What the render loop does, minus the render: uploads whatever the
        // display list has grown dirty.
        renderer.update();

        const value = powerUp.getChild('value') as GTextField;
        const surface = value.node as BabTextObject;

        // The field was authored at 24, but `number1` cannot scale, so the
        // surface draws at the font's own 46 — the field still reports the
        // request, which is the split the reference had.
        expect(value.fontSize).toBe(24);
        expect(surface.fontSize).toBe(46);

        // Seven digits, each advancing 24 in this font.
        const layout = surface.ensureLayout();
        expect(layout.textWidth).toBe(7 * 24);
        expect(layout.lineHeight, 'the font\'s own line height').toBe(46);

        // And every glyph reached the mesh — one quad each, rather than the
        // single quad a rasterised field would emit.
        expect(surface.babNode.getTotalVertices(), 'seven glyphs, four vertices each').toBe(28);

        const addValue = powerUp.getChild('add_value') as GTextField;
        // `+12345`: six glyphs, and this font's design size is 36.
        expect((addValue.node as BabTextObject).babNode.getTotalVertices()).toBe(24);

        root.removeChild(powerUp);
        renderer.packageAssets.dispose();
    });
});
