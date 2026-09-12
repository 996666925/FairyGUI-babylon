import { ObjectType, PackageItemType } from './FieldTypes.js';
import type { PackageItem } from './PackageItem.js';
import type { GObject } from './GObject.js';

/** Creates a bare `GObject` of a given `ObjectType`. */
export type TypeFactory = (type: number) => GObject | null;

/**
 * Indirection between the parts of the core that *build* objects from package
 * data (`UIPackage`, `GComponent`) and the widget classes themselves.
 *
 * `UIObjectFactory` installs the type factory. Without this seam, `GComponent`
 * would import every widget, and since the widgets extend `GObject` — which
 * `GComponent` also extends — ESM would have to evaluate that cycle in a
 * workable order, which it cannot guarantee.
 */
let typeFactory: TypeFactory | null = null;

export function setObjectFactory(factory: TypeFactory | null): void {
    typeFactory = factory;
}

export function isObjectFactoryInstalled(): boolean {
    return typeFactory !== null;
}

/**
 * Mirrors the reference's `UIObjectFactory.newObject`.
 *
 * Pass a number to get a plain object of that `ObjectType`, or a `PackageItem`
 * to honour its extension class and record the item on the result. The
 * item-level logic lives here rather than in the installed factory so that the
 * factory only has to answer "which class for this `ObjectType`".
 */
export function newObject(type: number | PackageItem, userClass?: new () => GObject): GObject | null {
    if (!typeFactory)
        throw new Error('fairygui: no object factory installed — import the core entry point first.');

    if (typeof type === 'number')
        return typeFactory(type);

    let obj: GObject | null;
    if (type.type === PackageItemType.Component) {
        if (userClass)
            obj = new userClass();
        else if (type.extensionType)
            obj = new (type.extensionType as new () => GObject)();
        else
            obj = typeFactory(type.objectType ?? ObjectType.Component);
    } else {
        obj = typeFactory(type.objectType ?? ObjectType.Component);
    }

    if (obj)
        obj.packageItem = type;
    return obj;
}
