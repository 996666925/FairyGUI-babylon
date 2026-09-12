import { ObjectType } from './FieldTypes.js';
import { GObject } from './GObject.js';
import { GComponent } from './GComponent.js';
import { GGraph } from './GGraph.js';
import { GGroup } from './GGroup.js';
import { GImage } from './GImage.js';
import { GLoader } from './GLoader.js';
import { GMovieClip } from './GMovieClip.js';
import { GTextField } from './GTextField.js';
import { GRichTextField } from './GRichTextField.js';
import { GTextInput } from './GTextInput.js';
import { GButton } from './GButton.js';
import { GLabel } from './GLabel.js';
import { GProgressBar } from './GProgressBar.js';
import { GSlider } from './GSlider.js';
import { GScrollBar } from './GScrollBar.js';
import { GComboBox } from './GComboBox.js';
import { GList } from './GList.js';
import { GTree } from './GTree.js';
import { GLoader3D } from './GLoader3D.js';

import { setObjectFactory, newObject } from './ObjectFactory.js';
import { registerExtension, getExtension } from './ExtensionRegistry.js';
import { UIPackage } from './UIPackage.js';

import type { PackageItem } from './PackageItem.js';

/**
 * Builds `GObject`s from package data and maps `ui://` URLs to user classes.
 *
 * This is the one module that knows every widget class. It is deliberately a
 * leaf: nothing in the core imports it, so the widgets it pulls in can all
 * extend `GObject`/`GComponent` without creating an import cycle. The core
 * reaches objects through the registry in `ObjectFactory.ts`, which this module
 * fills in on first import.
 */
export class UIObjectFactory {
    /** A replacement class for `ObjectType.Loader`, if one was set. */
    public static loaderType: (new () => GLoader) | null = null;

    /** Maps a `ui://` URL to a user component class. */
    public static setExtension(url: string, type: new () => GComponent): void {
        if (url == null)
            throw new Error('Invalid url: ' + url);

        // An already-parsed item should pick the class up immediately, rather
        // than only on the next parse.
        const pi = UIPackage.getItemByURL(url);
        if (pi)
            pi.extensionType = type;

        registerExtension(url, type);
    }

    public static getExtension(url: string): (new () => GComponent) | undefined {
        // The registry stores a deliberately loose constructor type so it can
        // stay free of imports; the caller here is where that narrows.
        return getExtension(url) as (new () => GComponent) | undefined;
    }

    /** Replaces the default `GLoader` with a subclass. */
    public static setLoaderExtension(type: new () => GLoader): void {
        UIObjectFactory.loaderType = type;
    }

    /** Creates a bare object of the given `ObjectType`. */
    public static newObject(type: number): GObject | null;
    /** Creates the object suited to a package item, honouring its extension. */
    public static newObject(type: PackageItem, userClass?: new () => GObject): GObject | null;
    public static newObject(type: number | PackageItem, userClass?: new () => GObject): GObject | null {
        return newObject(type, userClass);
    }
}

function buildByType(type: number): GObject | null {
    switch (type) {
        case ObjectType.Image: return new GImage();
        case ObjectType.MovieClip: return new GMovieClip();
        case ObjectType.Component: return new GComponent();
        case ObjectType.Text: return new GTextField();
        case ObjectType.RichText: return new GRichTextField();
        case ObjectType.InputText: return new GTextInput();
        case ObjectType.Group: return new GGroup();
        case ObjectType.List: return new GList();
        case ObjectType.Graph: return new GGraph();
        case ObjectType.Loader:
            return UIObjectFactory.loaderType ? new UIObjectFactory.loaderType() : new GLoader();
        case ObjectType.Button: return new GButton();
        case ObjectType.Label: return new GLabel();
        case ObjectType.ProgressBar: return new GProgressBar();
        case ObjectType.Slider: return new GSlider();
        case ObjectType.ScrollBar: return new GScrollBar();
        case ObjectType.ComboBox: return new GComboBox();
        case ObjectType.Tree: return new GTree();
        case ObjectType.Loader3D: return new GLoader3D();
        default: return null;
    }
}

setObjectFactory(buildByType);
