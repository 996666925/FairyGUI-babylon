import { ByteBuffer } from './utils/ByteBuffer.js';
import { PackageItem, type Frame } from './PackageItem.js';
import { ObjectType, PackageItemType } from './FieldTypes.js';
import { Rect } from './utils/Geometry.js';
import { PixelHitTestData } from './event/HitTest.js';
import { resolveExtension } from './ExtensionRegistry.js';
import { newObject } from './ObjectFactory.js';
import { BitmapFont, type BitmapFontGlyph } from './display/BitmapFont.js';
import type { GObject } from './GObject.js';
import type { SpriteTrim } from './render/IRenderObject.js';

/** A reference to another package, by either its id or its name. */
export interface PackageDependency {
    id: string | null;
    name: string | null;
}

/** Where one image lives inside its atlas, plus the padding the editor added. */
export interface AtlasSprite {
    atlas: PackageItem;
    rect: Rect;
    rotated?: boolean;
    /** Padding the editor trimmed off the source image. */
    offsetX: number;
    offsetY: number;
    /** Size of the image before trimming — what layout should use. */
    originalWidth: number;
    originalHeight: number;
}

/**
 * Where a sprite sat inside the image it was cut from, or `null` when it was
 * published whole.
 *
 * The editor trims a sprite's transparent margins and records the offset of what
 * is left along with the size it trimmed from. An object's box is that untrimmed
 * size — the editor set it from the whole image — so a backend draws the art
 * inset by this rather than stretched across the box.
 */
export function spriteTrim(sprite: AtlasSprite): SpriteTrim | null {
    if (sprite.offsetX === 0 && sprite.offsetY === 0
        && sprite.originalWidth === sprite.rect.width
        && sprite.originalHeight === sprite.rect.height)
        return null;

    return {
        x: sprite.offsetX,
        y: sprite.offsetY,
        originalWidth: sprite.originalWidth,
        originalHeight: sprite.originalHeight,
    };
}

/** `0x46475549` is the ASCII bytes `FGUI` read big-endian. */
const PACKAGE_MAGIC = 0x46475549;

/** Resolves a `PackageItem` to a backend asset. Set by the renderer layer. */
export type AssetResolver = (item: PackageItem) => unknown;
let assetResolver: AssetResolver | null = null;

export function setAssetResolver(resolver: AssetResolver | null): void {
    assetResolver = resolver;
}

export { setObjectFactory, type TypeFactory as ObjectFactory } from './ObjectFactory.js';

export class UIPackage {
    private _id = '';
    private _name = '';
    private _path = '';
    private _items: PackageItem[] = [];
    private _itemsById: Record<string, PackageItem> = {};
    private _itemsByName: Record<string, PackageItem> = {};
    private _sprites: Record<string, AtlasSprite> = {};
    private _dependencies: PackageDependency[] = [];
    private _branches: string[] = [];
    private _branchIndex = -1;

    /** Nesting depth of object construction, used to suppress side effects. */
    public static _constructing = 0;

    private static _instById: Record<string, UIPackage> = {};
    private static _instByName: Record<string, UIPackage> = {};
    private static _branch = '';
    private static _vars: Record<string, string> = {};

    public static get branch(): string {
        return UIPackage._branch;
    }

    public static set branch(value: string) {
        UIPackage._branch = value;
        for (const pkgId in UIPackage._instById) {
            const pkg = UIPackage._instById[pkgId];
            pkg._branchIndex = pkg._branches.indexOf(value);
        }
    }

    public static getVar(key: string): string {
        return UIPackage._vars[key];
    }

    public static setVar(key: string, value: string): void {
        UIPackage._vars[key] = value;
    }

    public static getById(id: string): UIPackage | undefined {
        return UIPackage._instById[id];
    }

    public static getByName(name: string): UIPackage | undefined {
        return UIPackage._instByName[name];
    }

    public static getAllPackages(): UIPackage[] {
        return Object.values(UIPackage._instById);
    }

    /**
     * Parses published package bytes.
     *
     * @param buffer raw contents of the `.fui` (or `.bytes`) file.
     * @param path base path used to locate sibling assets, **without** an
     * extension — atlases resolve to `path + "_" + file`, so a package at
     * `ui/MainMenu` finds `ui/MainMenu_atlas0.png`.
     */
    public static parse(buffer: ArrayBuffer, path = ''): UIPackage {
        const pkg = new UIPackage();
        pkg.loadPackage(new ByteBuffer(buffer), path);
        UIPackage._instById[pkg.id] = pkg;
        UIPackage._instByName[pkg.name] = pkg;
        if (pkg._path)
            UIPackage._instById[pkg._path] = pkg;
        return pkg;
    }

    /**
     * Fetches a package and parses it.
     *
     * @param basePath package path **without** an extension, e.g. `ui/MainMenu`.
     *   Its atlases resolve to `basePath + "_" + file`, so this reads
     *   `ui/MainMenu.fui` and `ui/MainMenu_atlas0.png`.
     * @param extension the published package's file extension.
     * @returns the registered package. Atlas images are *not* awaited — the
     *   backend loads them lazily as objects that need them are built.
     */
    public static async load(basePath: string, extension = '.fui'): Promise<UIPackage> {
        const url = basePath + extension;
        const response = await fetch(url);
        if (!response.ok)
            throw new Error(`fairygui: could not fetch '${url}' (HTTP ${response.status})`);
        return UIPackage.parse(await response.arrayBuffer(), basePath);
    }

    public static removePackage(packageIdOrName: string): void {
        let pkg = UIPackage._instById[packageIdOrName];
        if (!pkg)
            pkg = UIPackage._instByName[packageIdOrName];
        if (!pkg)
            throw new Error('No package found: ' + packageIdOrName);

        delete UIPackage._instById[pkg.id];
        delete UIPackage._instByName[pkg.name];
        if (pkg._path)
            delete UIPackage._instById[pkg._path];
    }

    public static createObject(pkgName: string, resName: string, userClass?: new () => GObject): GObject | null {
        const pkg = UIPackage.getByName(pkgName);
        return pkg ? pkg.createObject(resName, userClass) : null;
    }

    public static createObjectFromURL(url: string, userClass?: new () => GObject): GObject | null {
        const pi = UIPackage.getItemByURL(url);
        return pi ? pi.owner.internalCreateObject(pi, userClass) : null;
    }

    public static getItemURL(pkgName: string, resName: string): string | null {
        const pkg = UIPackage.getByName(pkgName);
        if (!pkg)
            return null;
        const pi = pkg._itemsByName[resName];
        if (!pi)
            return null;
        return 'ui://' + pkg.id + pi.id;
    }

    /** Accepts both `ui://<pkgId><itemId>` and `ui://<pkgName>/<itemName>`. */
    public static getItemByURL(url: string): PackageItem | null {
        const pos1 = url.indexOf('//');
        if (pos1 === -1)
            return null;

        const pos2 = url.indexOf('/', pos1 + 2);
        if (pos2 === -1) {
            // ui://abcdefghijkl — 8 chars of package id, then the item id.
            if (url.length > 13) {
                const pkg = UIPackage.getById(url.substring(5, 13));
                if (pkg)
                    return pkg.getItemById(url.substring(13)) ?? null;
            }
        } else {
            const pkg = UIPackage.getByName(url.substring(pos1 + 2, pos2));
            if (pkg)
                return pkg.getItemByName(url.substring(pos2 + 1)) ?? null;
        }
        return null;
    }

    public static normalizeURL(url: string): string | null {
        if (url == null)
            return null;

        const pos1 = url.indexOf('//');
        if (pos1 === -1)
            return null;

        const pos2 = url.indexOf('/', pos1 + 2);
        if (pos2 === -1)
            return url;

        const pkgName = url.substring(pos1 + 2, pos2);
        const srcName = url.substring(pos2 + 1);
        return UIPackage.getItemURL(pkgName, srcName);
    }

    private loadPackage(buffer: ByteBuffer, path: string): void {
        if (buffer.readUint() !== PACKAGE_MAGIC)
            throw new Error("FairyGUI: old package format found in '" + path + "'");

        this._path = path;
        buffer.version = buffer.readInt();
        const ver2 = buffer.version >= 2;
        buffer.readBool(); // compressed — the editor never writes compressed packages
        this._id = buffer.readString();
        this._name = buffer.readString();
        buffer.skip(20); // reserved

        const indexTablePos = buffer.position;
        let cnt: number;
        let i: number;
        let nextPos: number;

        // --- segment 4: string table -------------------------------------
        buffer.seek(indexTablePos, 4);
        cnt = buffer.readInt();
        const stringTable: string[] = new Array<string>(cnt);
        buffer.stringTable = stringTable;
        for (i = 0; i < cnt; i++)
            stringTable[i] = buffer.readString();

        // --- segment 5: long strings, patched over the table above --------
        if (buffer.seek(indexTablePos, 5)) {
            cnt = buffer.readInt();
            for (i = 0; i < cnt; i++) {
                const index = buffer.readUshort();
                const len = buffer.readInt();
                stringTable[index] = buffer.readString(len);
            }
        }

        // --- segment 0: dependencies and branches -------------------------
        buffer.seek(indexTablePos, 0);
        cnt = buffer.readShort();
        for (i = 0; i < cnt; i++)
            this._dependencies.push({ id: buffer.readS(), name: buffer.readS() });

        let branchIncluded = false;
        if (ver2) {
            cnt = buffer.readShort();
            if (cnt > 0) {
                // Branch names are always present when the count is positive.
                this._branches = buffer.readSArray(cnt) as string[];
                if (UIPackage._branch)
                    this._branchIndex = this._branches.indexOf(UIPackage._branch);
            }
            branchIncluded = cnt > 0;
        }

        // --- segment 1: items ---------------------------------------------
        buffer.seek(indexTablePos, 1);

        let pos = path.lastIndexOf('/');
        const shortPath = pos === -1 ? '' : path.substring(0, pos + 1);
        const itemPath = path + '_';

        cnt = buffer.readShort();
        for (i = 0; i < cnt; i++) {
            nextPos = buffer.readInt();
            nextPos += buffer.position;

            const pi = new PackageItem();
            pi.owner = this;
            pi.type = buffer.readByte();
            pi.id = buffer.readS() as string;
            pi.name = buffer.readS();
            buffer.readS(); // source path, only meaningful inside the editor
            pi.file = buffer.readS();
            pi.exported = buffer.readBool();
            pi.width = buffer.readInt();
            pi.height = buffer.readInt();

            switch (pi.type) {
                case PackageItemType.Image: {
                    pi.objectType = ObjectType.Image;
                    const scaleOption = buffer.readByte();
                    if (scaleOption === 1) {
                        pi.scale9Grid = new Rect(
                            buffer.readInt(),
                            buffer.readInt(),
                            buffer.readInt(),
                            buffer.readInt(),
                        );
                        pi.tileGridIndice = buffer.readInt();
                    } else if (scaleOption === 2) {
                        pi.scaleByTile = true;
                    }
                    pi.smoothing = buffer.readBool();
                    break;
                }

                case PackageItemType.MovieClip: {
                    pi.smoothing = buffer.readBool();
                    pi.objectType = ObjectType.MovieClip;
                    pi.rawData = buffer.readBuffer();
                    break;
                }

                case PackageItemType.Font: {
                    pi.rawData = buffer.readBuffer();
                    break;
                }

                case PackageItemType.Component: {
                    const extension = buffer.readByte();
                    pi.objectType = extension > 0 ? extension : ObjectType.Component;
                    pi.rawData = buffer.readBuffer();
                    resolveExtension(pi);
                    break;
                }

                case PackageItemType.Atlas:
                case PackageItemType.Sound:
                case PackageItemType.Misc: {
                    pi.file = itemPath + pi.file;
                    break;
                }

                case PackageItemType.Spine:
                case PackageItemType.DragonBones: {
                    pi.file = shortPath + pi.file;
                    // Anchor is stored but only consumed by the skeleton widgets.
                    buffer.readFloat();
                    buffer.readFloat();
                    break;
                }
            }

            if (ver2) {
                const branchName = buffer.readS();
                if (branchName)
                    pi.name = branchName + '/' + (pi.name ?? '');

                const branchCnt = buffer.readUbyte();
                if (branchCnt > 0) {
                    if (branchIncluded)
                        pi.branches = buffer.readSArray(branchCnt) as string[];
                    else
                        this._itemsById[buffer.readS() as string] = pi;
                }

                const highResCnt = buffer.readUbyte();
                if (highResCnt > 0)
                    pi.highResolution = buffer.readSArray(highResCnt) as string[];
            }

            this._items.push(pi);
            this._itemsById[pi.id] = pi;
            if (pi.name != null)
                this._itemsByName[pi.name] = pi;

            buffer.position = nextPos;
        }

        // --- segment 2: atlas sprites -------------------------------------
        buffer.seek(indexTablePos, 2);

        cnt = buffer.readShort();
        for (i = 0; i < cnt; i++) {
            nextPos = buffer.readShort();
            nextPos += buffer.position;

            const itemId = buffer.readS() as string;
            const atlas = this._itemsById[buffer.readS() as string];
            const rect = new Rect(
                buffer.readInt(),
                buffer.readInt(),
                buffer.readInt(),
                buffer.readInt(),
            );

            const sprite: AtlasSprite = {
                atlas,
                rect,
                offsetX: 0,
                offsetY: 0,
                originalWidth: 0,
                originalHeight: 0,
            };
            sprite.rotated = buffer.readBool();
            if (ver2 && buffer.readBool()) {
                sprite.offsetX = buffer.readInt();
                sprite.offsetY = buffer.readInt();
                sprite.originalWidth = buffer.readInt();
                sprite.originalHeight = buffer.readInt();
            } else {
                sprite.originalWidth = rect.width;
                sprite.originalHeight = rect.height;
            }
            this._sprites[itemId] = sprite;

            buffer.position = nextPos;
        }

        // --- segment 3: per-image alpha hit-test masks ---------------------
        if (buffer.seek(indexTablePos, 3)) {
            cnt = buffer.readShort();
            for (i = 0; i < cnt; i++) {
                nextPos = buffer.readInt();
                nextPos += buffer.position;

                const pi = this._itemsById[buffer.readS() as string];
                if (pi && pi.type === PackageItemType.Image)
                    pi.hitTestData = new PixelHitTestData(buffer);

                buffer.position = nextPos;
            }
        }

        this.loadItemPayloads();
    }

    /** Decodes the `rawData` sub-buffers of movie clips and fonts. */
    private loadItemPayloads(): void {
        for (const pi of this._items) {
            if (pi.type === PackageItemType.MovieClip && pi.rawData)
                this.loadMovieClip(pi);
            else if (pi.type === PackageItemType.Font && pi.rawData)
                this.loadFont(pi);
        }
    }

    private loadMovieClip(item: PackageItem): void {
        const buffer = item.rawData!;

        buffer.seek(0, 0);
        item.interval = buffer.readInt() / 1000;
        item.swing = buffer.readBool();
        item.repeatDelay = buffer.readInt() / 1000;

        buffer.seek(0, 1);
        const frameCount = buffer.readShort();
        item.frames = new Array<Frame>(frameCount);

        for (let i = 0; i < frameCount; i++) {
            let nextPos = buffer.readShort();
            nextPos += buffer.position;

            const rect = new Rect(
                buffer.readInt(),
                buffer.readInt(),
                buffer.readInt(),
                buffer.readInt(),
            );
            const addDelay = buffer.readInt() / 1000;
            const spriteId = buffer.readS();

            item.frames[i] = { rect, addDelay, spriteId };

            buffer.position = nextPos;
        }
    }

    /**
     * A font item is either a TTF rasterised into the package's own atlas or a
     * bitmap font whose glyphs are sprites in a sibling atlas. Both decode into
     * the same glyph table; the two cases differ only in where a glyph's rect
     * comes from and whether an absent `xAdvance` can be derived.
     */
    private loadFont(item: PackageItem): void {
        const buffer = item.rawData!;

        buffer.seek(0, 0);
        const ttf = buffer.readBool();
        const canTint = buffer.readBool();
        const resizable = buffer.readBool();
        buffer.readBool(); // has channel
        let fontSize = buffer.readInt();
        const xadvance = buffer.readInt();
        const lineHeight = buffer.readInt();

        const mainSprite = this._sprites[item.id] ?? null;
        const glyphs = new Map<number, BitmapFontGlyph>();

        buffer.seek(0, 1);
        const cnt = buffer.readInt();
        for (let i = 0; i < cnt; i++) {
            let nextPos = buffer.readShort();
            nextPos += buffer.position;

            const charId = buffer.readUshort();
            const spriteId = buffer.readS();
            const x = buffer.readInt();
            const y = buffer.readInt();
            let xOffset = buffer.readInt();
            let yOffset = buffer.readInt();
            const w = buffer.readInt();
            const h = buffer.readInt();
            let xAdvance = buffer.readInt();
            const rawChannel = buffer.readByte();
            // The editor numbers channels red/green/blue, but writes them in
            // the order blue/green/red.
            const channel = rawChannel === 1 ? 3 : rawChannel === 3 ? 1 : rawChannel;

            const glyph: BitmapFontGlyph = {
                charId,
                spriteId,
                rect: new Rect(x, y, w, h),
                xOffset,
                yOffset,
                xAdvance,
                channel,
            };

            if (ttf) {
                // Glyph rects are relative to the font atlas, which is itself a
                // sprite inside the package atlas.
                if (mainSprite) {
                    glyph.rect.x += mainSprite.rect.x;
                    glyph.rect.y += mainSprite.rect.y;
                }
            } else {
                const sprite = spriteId != null ? this._sprites[spriteId] : undefined;
                if (sprite) {
                    glyph.rect.copy(sprite.rect);
                    xOffset += sprite.offsetX;
                    yOffset += sprite.offsetY;
                    glyph.xOffset = xOffset;
                    glyph.yOffset = yOffset;
                    if (fontSize === 0)
                        fontSize = sprite.originalHeight;
                }
                if (xAdvance === 0)
                    xAdvance = xadvance === 0 ? xOffset + glyph.rect.width : xadvance;
                glyph.xAdvance = xAdvance;
            }

            glyphs.set(charId, glyph);
            buffer.position = nextPos;
        }

        item.font = {
            isTTF: ttf,
            canTint,
            resizable,
            fontSize,
            lineHeight: lineHeight === 0 ? fontSize : lineHeight,
            xadvance,
            glyphs,
            mainSprite,
        };
        // A separate field rather than `asset`: `getItemAsset` stores whatever
        // the backend's resolver returned, and a resolver has nothing to give
        // for a font — it would wipe this.
        item.bitmapFont = new BitmapFont(item.font, this, 'ui://' + this._id + item.id);
    }

    public createObject(resName: string, userClass?: new () => GObject): GObject | null {
        const pi = this._itemsByName[resName];
        return pi ? this.internalCreateObject(pi, userClass) : null;
    }

    public internalCreateObject(item: PackageItem, userClass?: new () => GObject): GObject | null {
        const g = newObject(item, userClass);
        if (g == null)
            return null;

        UIPackage._constructing++;
        g.constructFromResource();
        UIPackage._constructing--;
        return g;
    }

    public getItemById(itemId: string): PackageItem | undefined {
        return this._itemsById[itemId];
    }

    public getItemByName(resName: string): PackageItem | undefined {
        return this._itemsByName[resName];
    }

    public getSprite(itemId: string): AtlasSprite | undefined {
        return this._sprites[itemId];
    }

    public getSpriteByName(resName: string): AtlasSprite | undefined {
        const pi = this._itemsByName[resName];
        return pi ? this._sprites[pi.id] : undefined;
    }

    /**
     * Resolves an item to a backend asset via the registered resolver, caching
     * the result on the item. Returns `null` when no resolver is installed.
     */
    public getItemAsset(item: PackageItem): unknown {
        if (!item.decoded) {
            item.decoded = true;
            if (assetResolver)
                item.asset = assetResolver(item);
        }
        return item.asset ?? null;
    }

    public get id(): string {
        return this._id;
    }

    public get name(): string {
        return this._name;
    }

    public get path(): string {
        return this._path;
    }

    public get dependencies(): PackageDependency[] {
        return this._dependencies;
    }

    public get branches(): string[] {
        return this._branches;
    }

    public get branchIndex(): number {
        return this._branchIndex;
    }

    public get items(): PackageItem[] {
        return this._items;
    }
}
