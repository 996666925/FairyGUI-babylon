# fairygui-babylon

A [FairyGUI](https://fairygui.com) runtime for [Babylon.js](https://babylonjs.com),
written from scratch against the published package format.

You lay UI out in the FairyGUI editor, publish a package, and load it here. The
runtime parses the package, builds a display list, and renders it through a
Babylon.js backend — as a screen-space overlay with its own orthographic camera,
independent of whatever your 3D scene is doing.

```ts
import { installBabylonRenderer, UIPackage, GRoot } from 'fairygui-babylon';

// One call wires up both the node backend and the texture resolver.
const renderer = installBabylonRenderer({ scene, width: 1280, height: 720 });

const pkg = await UIPackage.load('ui/MainMenu');   // ui/MainMenu.fui + _atlas0.png
const main = pkg.createObject('Main')!;

GRoot.create().addChild(main);
```

Driven from your render loop:

```ts
scene.onBeforeRenderObservable.add(() => {
  root.update(engine.getDeltaTime() / 1000);
});
```

## Install

```bash
npm install fairygui-babylon
```

`@babylonjs/core` is a **peer dependency** — the runtime imports it but does not
bundle it, so your app keeps a single copy of the engine.

## Input

The backend draws; it does not listen. Forward pointer events to the root's input
processor, in **UI units** (origin top-left, y down — which is what a canvas
already gives you):

```ts
root.inputProcessor.touchBegin(id, x, y);
root.inputProcessor.touchMove(id, x, y);
root.inputProcessor.touchEnd(id, x, y);
```

## Packages

A package is addressed by a base path **without** an extension. A package at
`ui/MainMenu` reads `ui/MainMenu.fui` and resolves its atlases to
`ui/MainMenu_atlas0.png`.

```ts
UIPackage.parse(arrayBuffer, 'ui/MainMenu');   // synchronous, if you fetched it yourself
UIPackage.load('ui/MainMenu');                 // fetches, then parses
```

Textures load lazily and asynchronously behind a synchronous resolver: a
`GImage` gets its texture handle the moment it is built, and Babylon fills the
pixels in when the image arrives. Art therefore appears as it loads, with no
refresh pass.

## What is implemented

The engine-agnostic core is a faithful port of FairyGUI's own runtime — display
list, gears, relations, controllers, transitions, scroll panes, virtual lists,
tweens, rich text, localisation. The Babylon backend is new work.

**Backend features:** orthographic screen-space overlay · per-object z-order ·
nine-slice and tiling · radial and linear fills · nested rotated clipping ·
canvas-2D text with outline and shadow · triangulated vector graphics · alpha
hit-testing · external image loading for `GLoader` · real text input (a DOM
field overlaid on an editable `GTextInput`, so typing, selection, clipboard and
IME all work) · host-scene isolation (the UI gets its own layer and camera, and
neither the host's camera nor its meshes are touched).

**Known gaps:** `GLoader3D` hosts no skeleton runtime — Spine and DragonBones are
supplied through `setLoader3DContentFactory` rather than bundled. Blend modes
beyond `Normal` are recorded but not yet mapped onto GPU blend state. Filters
from the editor are not modelled.

## Layout

```
src/core/     engine-agnostic runtime
src/babylon/  the Babylon.js render backend
tests/        rstest suites; tests/fixtures holds real published packages
```

`src/core/` never imports from `src/babylon/` or references a Babylon type. The
backend is reached solely through the interfaces in
`src/core/render/IRenderObject.ts`, which is what lets the entire core run and
be tested headlessly. See [PORTING.md](PORTING.md) for the conventions a port
has to follow, and why.

## Development

```bash
npm run build       # rslib -> dist/
npm test            # rstest
npm run typecheck   # tsc, both projects
```

Tests run in Node with no GPU: Babylon's `NullEngine` stands in for WebGL, and
`tests/fixtures/ui/` holds sixteen packages published by the real FairyGUI
editor, so the parser and every widget are exercised against genuine data.
