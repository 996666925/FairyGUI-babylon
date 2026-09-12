import { existsSync, readdirSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * Where published packages live. Drop `<name>.fui` (or the older `<name>.bytes`)
 * plus its `_atlas0.png` siblings in here and they appear in the demo.
 */
const UI_DIR = 'public/ui';

/** Extensions the FairyGUI editor publishes a package as. */
const PACKAGE_EXTENSIONS = ['.fui', '.bytes'];

const VIRTUAL_ID = 'virtual:fgui-packages';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

/**
 * Lists the packages in `public/ui`.
 *
 * The demo needs to know what the user dropped in, but a browser cannot list a
 * directory. Rather than making them maintain a manifest by hand — which is
 * exactly the file they would forget to update — the dev server reads the
 * directory and hands the list over as a module. Adding a package is then a
 * matter of copying files in and refreshing.
 */
function fguiPackages(): Plugin {
    let uiDir = resolve(here, UI_DIR);

    const discover = (): string[] => {
        if (!existsSync(uiDir))
            return [];
        return readdirSync(uiDir)
            .filter((file) => PACKAGE_EXTENSIONS.includes(extname(file).toLowerCase()))
            .map((file) => 'ui/' + basename(file, extname(file)))
            .sort();
    };

    return {
        name: 'fgui-packages',

        configResolved(config) {
            uiDir = resolve(config.root, UI_DIR);
        },

        resolveId(id) {
            return id === VIRTUAL_ID ? RESOLVED_ID : null;
        },

        load(id) {
            if (id !== RESOLVED_ID)
                return null;
            return `export default ${JSON.stringify(discover())};`;
        },

        configureServer(server) {
            server.watcher.add(uiDir);
            // The library is resolved through the alias above, so its files are
            // served as source — but they live above this package, and Vite only
            // watches its own root. Without this an edit to `src/core` is served
            // from the transform cache until the server is restarted, which
            // reads as "my fix did nothing".
            server.watcher.add(resolve(here, '../src'));
            // A copy or delete between reloads would otherwise leave the demo
            // showing a package list that no longer matches the disk.
            const refresh = (path: string): void => {
                if (!PACKAGE_EXTENSIONS.includes(extname(path).toLowerCase()))
                    return;
                const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
                if (mod)
                    server.moduleGraph.invalidateModule(mod);
                server.ws.send({ type: 'full-reload' });
            };
            server.watcher.on('add', refresh);
            server.watcher.on('unlink', refresh);
        },
    };
}

export default defineConfig({
    plugins: [fguiPackages()],

    optimizeDeps: {
        // Babylon must be served as native ESM, not pre-bundled.
        //
        // Its deep entry points carry engine capabilities as *prototype
        // patches* — `Engines/Extensions/engine.dynamicTexture.js` installs
        // `ThinEngine.prototype.createDynamicTexture`, and so on. Pre-bundling
        // turns each entry into its own chunk graph, and the optimiser can emit
        // two copies of a class like `ThinEngine`, one per graph. The patch then
        // lands on a prototype the running engine does not inherit from, and it
        // fails at runtime with "createDynamicTexture is not a function" — only
        // once something actually rasterises text.
        //
        // Excluding it keeps every import resolving to one module instance.
        // The cost is more, smaller module requests in dev; the page is still
        // up in well under a second.
        exclude: ['@babylonjs/core'],
    },

    resolve: {
        alias: {
            // Point at the library source rather than its build output, so the
            // demo picks up edits without a rebuild in between.
            'fairygui-babylon': resolve(here, '../src/index.ts'),
        },

        // Babylon must resolve to *one* copy.
        //
        // The alias above pulls in files from `../src`, which sit above this
        // package and therefore resolve `@babylonjs/core` against the
        // repository root's `node_modules`. Files under `demo/src` resolve
        // against `demo/node_modules`. Both copies exist — the root needs one
        // for the library's own tests — and two copies means two `ThinEngine`
        // classes. Babylon installs engine capabilities by patching
        // `ThinEngine.prototype`, so the patch lands on a class the running
        // engine does not inherit from and never takes effect. Deduping forces
        // every importer onto the same copy.
        dedupe: ['@babylonjs/core'],
    },
    server: {
        open: true,
    },
});
