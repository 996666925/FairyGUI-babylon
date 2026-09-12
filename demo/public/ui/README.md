# Put your FairyGUI packages here

Copy the files the FairyGUI editor produced into this folder. The demo picks
them up on its own — there is no list to maintain.

## What to copy

For a package published as `MainMenu`, copy **all** of these:

```
MainMenu.fui          ← the package itself
MainMenu_atlas0.png   ← every atlas it uses
MainMenu_atlas1.png   ← (only if the editor split the art across several)
```

The package and its atlases must sit side by side, and the atlas names must be
left exactly as the editor wrote them. The runtime finds an atlas by prefixing
the package's own path, so `ui/MainMenu` looks for `ui/MainMenu_atlas0.png`.

Sound files (`.wav`, `.mp3`), fonts and anything else the editor emitted can be
copied in too; they do no harm and the demo ignores them.

## How it is found

The package name is the filename without its extension. A file at
`public/ui/MainMenu.fui` is served as `/ui/MainMenu.fui` and loaded as the base
path `ui/MainMenu`.

Both extensions the editor can publish are recognised:

| Extension | Editor version |
| --- | --- |
| `.fui` | current |
| `.bytes` | older |

Add or remove files while the dev server is running: the page reloads itself.

## If a package does not appear

- **Nothing shows up in the sidebar at all** — check the files are directly in
  `public/ui/`, not in a subfolder. The scan is not recursive.
- **The package is listed but shows an error** — it was probably published in
  the editor's XML format rather than binary. This runtime reads the binary
  format only, which is what the *Publish* button produces by default; check
  the publish settings.
- **Components render as flat coloured rectangles** — the atlases are missing or
  misnamed. The package lists fine without them, because image sizes come from
  the package data, so this is the usual symptom of a missing `_atlas0.png`.
