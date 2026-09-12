/// <reference types="vite/client" />

/**
 * The package list the dev server reads out of `public/ui`.
 *
 * Each entry is a base path **without** an extension, e.g. `ui/MainMenu`, which
 * `UIPackage.load` turns into `ui/MainMenu.fui` and whose atlases resolve to
 * `ui/MainMenu_atlas0.png`.
 */
declare module 'virtual:fgui-packages' {
    const packages: string[];
    export default packages;
}
