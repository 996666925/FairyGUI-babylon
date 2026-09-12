/**
 * Mutable globals that several independent modules need to read.
 *
 * These live here rather than on `GRoot` to keep the import graph acyclic:
 * `GRoot` pulls in the whole widget tree, while `PackageItem` — reached from the
 * package parser — only needs the current value.
 */
export const globalState = {
    /**
     * Which entry of a `PackageItem.highResolution` list to use. `0` means the
     * standard-resolution asset; `GRoot.contentScaleLevel` reads and writes this.
     */
    contentScaleLevel: 0,
};
