# Porting conventions

This library is a from-scratch reimplementation of the FairyGUI runtime for
Babylon.js. It is being ported from the official Cocos Creator runtime, which
lives outside the repository and is **not** a build input — it is a reference
for behaviour only.

Read this before porting any module. Every rule here exists because something
in the reference does not survive contact with ESM, strict TypeScript, or a
non-Cocos engine.

## Layout

```
src/core/     engine-agnostic runtime: package parsing, display list, widgets
src/babylon/  the Babylon.js render backend
tests/        rstest suites; tests/fixtures holds real published packages
```

`src/core/` must never import from `src/babylon/`, and must never reference a
Babylon type. The backend is reached only through the interfaces in
`src/core/render/IRenderObject.ts`.

## Language and module rules

- **Plain ESM.** No `namespace`. Top-level `export class` / `export enum` /
  `export interface`.
- **Every relative import ends in `.js`**, even though the file on disk is
  `.ts`. Bundle resolution needs the emitted specifier.
- **TypeScript strict mode is on** (TypeScript 6 enables it by default; the
  `tsconfig.json` does not say so explicitly). `noUnusedLocals` and
  `noUnusedParameters` are on too. `useDefineForClassFields: true` means a
  declared field without an initializer is defined as `undefined` — give it an
  initializer, assign it in the constructor, or assert it with `!`.
- Import Babylon narrowly from `@babylonjs/core/...` subpaths so consumers can
  tree-shake.

## Coordinate contract

The core speaks **FairyGUI's native space**: origin at the UI root's top-left,
**y increasing downwards**, angles in **degrees, clockwise on screen**.

Babylon is y-up and counter-clockwise. Converting is the backend's job, and
only the backend's. Never leak a Babylon-space number into `src/core/`, and
never write core code that "helps" by pre-flipping a y.

The reference exposes Cocos' anchor system directly, where a node's `anchorY`
is `1 - pivotY`. That inversion is not reproduced. The render node owns a pivot
in the same y-down space the core uses, so `pivotY` means what it says.

## The render seam

`src/core/render/IRenderObject.ts` defines `IRenderObject`, `IImageObject`,
`ITextObject`, `IGraphObject` and `IRenderFactory`. A backend installs itself
with `setRenderFactory()`; the core builds its nodes through
`getRenderFactory()`.

`GObject.createDisplayObject()` is the override point — a widget that needs a
drawing node rather than a bare transform overrides it. It runs from
`GObject`'s constructor, so an override must not touch subclass fields; those
are still being initialised.

## Breaking import cycles

ESM evaluates class bodies eagerly, so `A extends B` fails outright if `B`'s
module has not finished evaluating. The reference relies on TypeScript
namespaces, where cycles are harmless. Hence, in this port:

- **Widgets are found through a registry, not an import.**
  `src/core/ObjectFactory.ts` holds `newObject()`; `UIObjectFactory` installs
  the implementations. `GComponent` calls `newObject()` and imports no widget.
- **Heavyweight collaborators are late-bound.** `src/core/Builtins.ts` holds
  the `ScrollPane` and `Transition` constructors, installed by the entry point.
- **Gears and controller actions register themselves** by index/type id
  (`registerGear`, `registerAction`) into a table in their base class module.
  The base class module therefore imports none of its subclasses.
- **Anything importing `GRoot` from `GObject`-adjacent code is `import type`
  only**, with the live instance fetched from `src/core/Stage.ts`.

The core entry point (`src/index.ts`) is responsible for importing every
self-registering module for its side effect. If you add one, wire it up there.

## Replacing Cocos idioms

| Reference | Here |
| --- | --- |
| `instanceof GGroup` / `instanceof GList` inside `GObject` | a virtual hook the subclass overrides (`onMoved`, `onResized`, `handleAlphaChanged`, `handleChildPositionChanged`, …) |
| `node.emit(...)` | `this.emit(...)` — non-bubbling |
| `dispatchEvent` | `this.dispatchEvent(evt)` — bubbles while `evt.bubbles` |
| `Event.XY_CHANGED` | `EventType.XY_CHANGED` from `src/core/event/Event.js` |
| `cc.Component.scheduleOnce` via `GObjectPartner` | `this.callLater(fn, delay)`, driven by `src/core/Scheduler.ts` |
| `node.setSiblingIndex(i)` | `container.setChildIndex(childNode, i)` |
| `node.parent = x` | `x.addChild(node)` |
| `cc.Color` | `Color` from `src/core/utils/Color.js` (channels are 0–255) |
| `cc.Vec2` / `cc.Rect` | `Point` / `Rect` from `src/core/utils/Geometry.js` |

`ByteBuffer` notes: `readS()` returns `string | null` — `65534` is null and
`65533` is `""`, and that distinction is load-bearing (items published with no
name really are nameless). `readColor(hasAlpha = false)` discards the stored
alpha byte unless asked. `readSArray` returns `Array<string | null>`. `writeS`
overwrites a shared string-table entry in place, which is how localisation
works.

## Fidelity

This is a port, not a redesign. Keep algorithms, field names, storage layout
and observable behaviour as they are, including quirks — a gear colour that
comes back opaque because the reference dropped the alpha byte is behaviour to
preserve, not to fix.

Where a quirk is clearly a bug that loses author intent, fix it **and say so
in a comment** explaining what the reference did and why this differs.

## Style

4-space indent, semicolons, single quotes, explicit `public` / `protected` /
`private`. JSDoc on anything whose intent is not obvious from its name —
especially where this port diverges from the reference. Comment density should
match the surrounding files: explain *why*, not *what*.

## Testing

Tests run in Node with no GPU. Use `rstest`:

```bash
npx rstest tests/<file>.test.ts
npx rstest                     # whole suite
npx tsc --noEmit -p tsconfig.json
```

- Anything touching `GObject` needs a render backend. Install a headless mock
  via `setRenderFactory()` — see `tests/helpers/mockRender.ts`.
- `tests/fixtures/ui/` holds 16 real packages published by the FairyGUI editor,
  with their atlases. Prefer asserting against them over hand-built buffers.
- Drive time explicitly. `TweenManager.update(dt)` and `Scheduler.update(dt)`
  take a delta; nothing consults a wall clock.
