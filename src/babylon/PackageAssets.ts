import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import { PackageItemType } from '../core/FieldTypes.js';
import { setAssetResolver } from '../core/UIPackage.js';
import {
    setUIContentLoader,
    type UIContentLoadCallback,
    type UILoadedContent,
} from '../core/GLoader.js';

import type { PackageItem } from '../core/PackageItem.js';
import type { BabylonRenderer } from './BabylonRenderer.js';

/** The parts of an `Image` element `loadExternal` uses. */
interface ImageLike {
    onload: (() => void) | null;
    onerror: (() => void) | null;
    naturalWidth: number;
    naturalHeight: number;
    src: string;
}
type ImageCtor = new () => ImageLike;

/**
 * Resolves package items to textures, one per atlas file.
 *
 * ### Why this can be synchronous
 *
 * `GImage` asks for its asset while it is being constructed, so the resolver
 * has to answer immediately. A Babylon `Texture` fits that: the constructor
 * returns at once and fills the GPU resource in when the image arrives, and
 * meshes built against it simply draw nothing until then. So no
 * re-invalidation pass is needed — a package's art appears as it loads.
 *
 * ### The `invertY` choice
 *
 * Textures are created with **`invertY = false`**. `SpriteMapping` derives
 * `v0` from the region's top edge and lets `v` grow downwards through the
 * image, which matches raw image row order; Babylon's default (`invertY = true`)
 * would flip that and draw every sprite upside down.
 */
export class BabylonPackageAssets {
    private readonly _renderer: BabylonRenderer;
    private readonly _textures = new Map<string, Texture>();
    /** External content already loaded, keyed by the URL it came from. */
    private readonly _external = new Map<string, UILoadedContent>();

    public constructor(renderer: BabylonRenderer) {
        this._renderer = renderer;
    }

    /**
     * The texture for an atlas file, loading it on first request.
     *
     * @param url resolved path written by the parser, e.g. `ui/MainMenu_atlas0.png`.
     */
    public textureFor(url: string): Texture {
        let texture = this._textures.get(url);
        if (texture)
            return texture;

        texture = new Texture(
            url,
            this._renderer.scene,
            true, // no mipmaps: UI is drawn at roughly 1:1
            false, // invertY — see the class comment
            Texture.BILINEAR_SAMPLINGMODE,
        );
        // An atlas packs unrelated sprites edge to edge, so sampling past a
        // region's border would pick up its neighbour. Tiling and nine-slice
        // both stay inside their rect, so clamping costs nothing.
        texture.wrapU = Texture.CLAMP_ADDRESSMODE;
        texture.wrapV = Texture.CLAMP_ADDRESSMODE;
        texture.hasAlpha = true;

        this._textures.set(url, texture);
        return texture;
    }

    /** Resolves an item, or `null` for anything that is not atlas-backed. */
    public resolve(item: PackageItem): BaseTexture | null {
        if (item.type !== PackageItemType.Atlas || !item.file)
            return null;
        return this.textureFor(item.file);
    }

    /**
     * Loads a `GLoader`'s external content — a plain image URL.
     *
     * The image is fetched through an `Image` element rather than left to
     * Babylon's `Texture`, for two reasons: `Texture` never reports the source
     * size until the pixels arrive, and it silently does nothing when the URL is
     * wrong. `GLoader` needs both — the size to lay the content out, and a
     * failure so it can fall back to `UIConfig.loaderErrorSign`.
     */
    public loadExternal(url: string, callback: UIContentLoadCallback): void {
        const cached = this._external.get(url);
        if (cached) {
            callback(null, cached);
            return;
        }

        // Declared structurally rather than through the DOM lib: this library
        // compiles without it, and `TextLayout` reaches for `OffscreenCanvas`
        // and `document` the same way.
        const ImageCtor = (globalThis as unknown as { Image?: ImageCtor }).Image;
        if (typeof ImageCtor !== 'function') {
            callback(new Error(`fairygui: cannot load '${url}' — no Image in this environment`), null);
            return;
        }

        const image = new ImageCtor();
        image.onload = () => {
            const content: UILoadedContent = {
                texture: this.textureFor(url),
                width: image.naturalWidth,
                height: image.naturalHeight,
            };
            this._external.set(url, content);
            callback(null, content);
        };
        image.onerror = () => {
            callback(new Error(`fairygui: could not load '${url}'`), null);
        };
        image.src = url;
    }

    /** Registers this resolver so the core can find textures and content. */
    public install(): void {
        setAssetResolver((item) => this.resolve(item));
        setUIContentLoader({
            load: (url, callback) => this.loadExternal(url, callback),
        });
    }

    /** Unregisters and releases every texture this instance created. */
    public dispose(): void {
        setAssetResolver(null);
        setUIContentLoader(null);
        for (const texture of this._textures.values())
            texture.dispose();
        this._textures.clear();
        this._external.clear();
    }
}
