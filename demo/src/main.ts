import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { UIPackage } from 'fairygui-babylon';

import packages from 'virtual:fgui-packages';
import { Backdrop } from './Backdrop.js';
import { DemoEntry } from './demo/DemoEntry.js';
import { UiHost } from './UiHost.js';

/**
 * The package the sample application is built from.
 *
 * Everything hangs off this one: `DemoEntry` shows its main menu, and each
 * menu button opens one of the demo screens.
 */
const ENTRY_PACKAGE = 'ui/MainMenu';

/**
 * The demo application.
 *
 * It is the FairyGUI sample app: the UI *is* the interface, with no HTML
 * chrome beyond a switch for the 3D scene behind it. That is also what makes it
 * a useful demonstration — the menus, lists, popups and windows on screen are
 * all display lists built from published packages.
 */
function boot(): void {
    const canvas = requireCanvas();
    // The last argument is `adaptToDeviceRatio`: render at the display's density
    // rather than one-for-one CSS pixels. Without it everything is upscaled on a
    // high-density screen. The UI is laid out in CSS pixels either way — the
    // backend divides the backbuffer size back down — and text rasterises at the
    // density it finds, so both follow automatically.
    const engine = new Engine(canvas, true, { stencil: true }, true);
    const scene = new Scene(engine);

    const backdrop = new Backdrop(scene, canvas);
    const host = new UiHost(canvas, engine, scene);

    engine.runRenderLoop(() => backdrop.update(engine.getDeltaTime() / 1000));

    bindBackdropToggle(backdrop);
    exposeDebugHandles(host, backdrop, scene, engine);
    void start(host);

}

async function start(host: UiHost): Promise<void> {
    // A `?show=Package/Component` link renders one component on its own. It is
    // the quickest way to check a screen against the editor without clicking
    // through the menu to reach it.
    const requested = new URLSearchParams(location.search).get('show');
    if (requested) {
        await showSingle(host, requested);
        return;
    }

    if (!packages.includes(ENTRY_PACKAGE)) {
        showMessage();
        return;
    }

    // Building the entry starts the sample application: it loads the main menu
    // and takes over the root from here, so nothing else is wired up.
    void DemoEntry.instance;
}

/** Renders one component, fitted and centred, on its own. */
async function showSingle(host: UiHost, requested: string): Promise<void> {
    const slash = requested.indexOf('/');
    if (slash === -1) {
        showMessage();
        return;
    }

    const packageName = requested.substring(0, slash);
    const itemName = requested.substring(slash + 1);

    try {
        await UIPackage.load(`ui/${packageName}`);
    } catch (err) {
        console.error(`fairygui-babylon demo: ${packageName} could not be loaded`, err);
        showMessage();
        return;
    }

    const obj = UIPackage.createObject(packageName, itemName);
    if (obj === null) {
        console.error(`fairygui-babylon demo: ${packageName} has no '${itemName}'`);
        showMessage();
        return;
    }

    host.show(obj);
}

/**
 * Wires the one switch in the HTML.
 *
 * The 3D scene starts hidden: the sample application covers the screen, so the
 * scene would not be visible anyway. Turning it on is what demonstrates the
 * backend's own claim — that the UI is drawn by a separate camera on a separate
 * layer, and neither disturbs the other.
 */
function bindBackdropToggle(backdrop: Backdrop): void {
    const input = document.getElementById('toggle-3d') as HTMLInputElement | null;
    if (!input)
        return;

    backdrop.visible = input.checked;
    input.addEventListener('change', () => {
        backdrop.visible = input.checked;
    });
}

/**
 * Puts the pieces on `window` under one name.
 *
 * The demo is a black box from the console otherwise — the renderer, the root
 * and the scene all live inside modules. This is what makes
 * `fgui.renderer.camera.position` reachable when something looks wrong on
 * screen.
 */
function exposeDebugHandles(
    host: UiHost, backdrop: Backdrop, scene: Scene, engine: Engine,
): void {
    (window as unknown as Record<string, unknown>)['fgui'] = {
        host, backdrop, scene, engine,
        renderer: host.renderer,
        root: host.root,
    };
}

function showMessage(): void {
    const message = document.getElementById('message');
    if (message)
        message.hidden = false;
}

function requireCanvas(): HTMLCanvasElement {
    const canvas = document.getElementById('stage');
    if (!(canvas instanceof HTMLCanvasElement))
        throw new Error('fairygui-babylon demo: #stage canvas is missing from index.html');
    return canvas;
}

boot();
