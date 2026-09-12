import type { PackageItem } from './PackageItem.js';

export type GComponentCtor = new () => unknown;

/**
 * Maps `ui://` URLs to user-supplied component classes.
 *
 * This exists as its own module, with no imports, so the package parser can
 * consult it without pulling in the widget tree. `UIObjectFactory` is the
 * public face of this registry; it adds the bookkeeping that needs the rest of
 * the core.
 */
const extensions: Record<string, GComponentCtor> = {};

export function registerExtension(url: string, type: GComponentCtor): void {
    extensions[url] = type;
}

export function getExtension(url: string): GComponentCtor | undefined {
    return extensions[url];
}

/**
 * Finds an extension for an item, trying the id-based URL first and the
 * name-based one second — the editor emits one or the other depending on how
 * the item was published.
 */
export function resolveExtension(pi: PackageItem): void {
    const type = extensions['ui://' + pi.owner.id + pi.id]
        ?? extensions['ui://' + pi.owner.name + '/' + pi.name];
    if (type)
        pi.extensionType = type;
}
