# fairygui-babylon demo

The FairyGUI sample application, running on Babylon.js.

The UI *is* the interface: a main menu of demo screens — buttons, lists, trees,
scroll panes, windows, popups, drag and drop, a chat with rich text and emoji, a
virtual list of a thousand rows. Every one of them is a display list built from
packages published by the FairyGUI editor, so the demo is also the broadest test
the runtime has.

```bash
cd demo
npm install
npm run dev
```

## Assets

The application is driven by the UI packages, which are not in the repository.
Copy them into [`public/ui/`](public/ui/README.md).

The main menu needs the `MainMenu` package, and each demo it opens needs its own
— `Basics`, `Bag`, `Chat`, `Cooldown`, `Guide`, `HitTest`, `Joystick`,
`ListEffect`, `LoopList`, `ModalWaiting`, `PullToRefresh`, `ScrollPane`,
`Transition`, `TreeView`, `VirtualList`. Whichever are missing simply fail to
open; the rest still work.

The demo also reads `/icons/*.png` — the bag and cooldown screens load them as
external images. Those are in `public/icons/` already.

## URL parameters

| Parameter | Effect |
| --- | --- |
| `?demo=Bag` | Open that demo screen directly. Names are the ones in `MainMenu.ts`. |
| `?show=Package/Component` | Render one component on its own, fitted and centred. The quickest way to check a screen against the editor. |
| `?backdrop=1` | Show the 3D scene |

## The 3D scene

The switch in the bottom-right corner turns on a small 3D scene behind the UI.
It is off by default, because the sample application covers the screen.

Turning it on is worth a look: drag the **background** to orbit, and the UI does
not move. The UI is drawn by its own orthographic camera on its own layer, so it
neither disturbs the host's camera nor is disturbed by it. Dragging *over* a UI
element scrolls or drags that element instead, and the camera stays put.

## Layout

```
src/main.ts          Boot; the FairyGUI application is what it starts
src/UiHost.ts        The engine, the renderer and GRoot; pointer input, resizing
src/Backdrop.ts      The optional 3D scene
src/demo/            The application: MainMenu, DemoEntry and one file per demo
```

`src/demo/` is a port of the LayaBox reference demo — same screens, same
behaviour, adapted to this runtime's API and to the browser rather than to
Laya's.

## Production build

```bash
npm run build     # typechecks, then bundles to dist/
npm run preview
```

The build aliases `fairygui-babylon` to `../src`, so it compiles the library
from source and there is no need to build the repository root first. To exercise
the published package instead, point that alias at `../dist/index.js` in
`vite.config.ts`.
