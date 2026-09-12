import type { AtlasSprite, UIPackage } from '../UIPackage.js';
import type { PackageItem } from '../PackageItem.js';
import type { Rect } from '../utils/Geometry.js';

/** One glyph of a bitmap-font item. */
export interface BitmapFontGlyph {
    charId: number;
    /** Sprite backing this glyph when the font packs into a shared atlas. */
    spriteId: string | null;
    /** Region of the atlas to sample, already resolved to atlas coordinates. */
    rect: Rect;
    xOffset: number;
    yOffset: number;
    xAdvance: number;
    /**
     * Which channel holds coverage: `1` red, `2` green, `3` blue, `4` alpha.
     * Populated only for fonts published with channel packing.
     */
    channel: number;
}

/**
 * A font item's decoded glyph table.
 *
 * The editor publishes fonts either as a TTF rasterised into the package's own
 * atlas (glyph rects are absolute within that atlas) or as a bitmap font whose
 * glyphs reference sprites in a sibling atlas (rects come from the sprite).
 * Both collapse to the same table here; the differences survive only in the
 * metrics and in `mainSprite`.
 */
export interface BitmapFontData {
    isTTF: boolean;
    canTint: boolean;
    /** Whether the glyphs may be scaled freely (signed-distance or vector source). */
    resizable: boolean;
    fontSize: number;
    lineHeight: number;
    /** Fallback advance for glyphs that do not specify one. */
    xadvance: number;
    glyphs: Map<number, BitmapFontGlyph>;
    /** Atlas sprite covering the whole font texture, for TTF-derived fonts. */
    mainSprite: AtlasSprite | null;
}

/** Where a glyph's ink lives: the atlas to sample it from and how it is stored. */
export interface BitmapGlyphSource {
    atlas: PackageItem;
    rotated: boolean;
}

/**
 * A font published inside a package, ready to draw with.
 *
 * The decoded table is the core's (`BitmapFontData`); this adds the two things
 * a renderer needs on top of the metrics: which atlas item a glyph's rectangle
 * belongs to, and whether that rectangle is stored rotated. Both live on the
 * `AtlasSprite` rather than on the glyph, which is why the lookup goes back
 * through the package.
 *
 * Nothing here is resolved to a texture — that is the backend's, along with the
 * glyph geometry itself.
 */
export class BitmapFont {
    private readonly _data: BitmapFontData;
    private readonly _owner: UIPackage;
    private readonly _url: string;
    /** `spriteId → sprite`, cached because the walk asks per glyph per frame. */
    private readonly _sprites = new Map<string, AtlasSprite | null>();

    public constructor(data: BitmapFontData, owner: UIPackage, url: string) {
        this._data = data;
        this._owner = owner;
        this._url = url;
    }

    /** The `ui://` URL this font was published at, or the registered name. */
    public get url(): string {
        return this._url;
    }

    public get data(): BitmapFontData {
        return this._data;
    }

    /** Whether the glyphs were rasterised from a TTF rather than packed as sprites. */
    public get isTTF(): boolean {
        return this._data.isTTF;
    }

    /**
     * Whether the glyph textures may be modulated by the text colour. When they
     * may not, they carry their own colours and the field's is ignored.
     */
    public get canTint(): boolean {
        return this._data.canTint;
    }

    /**
     * Whether the glyphs survive being scaled. A font that does not scale is
     * drawn at its design size whatever size the field asks for.
     */
    public get resizable(): boolean {
        return this._data.resizable;
    }

    /** Design size the glyphs were rasterised at. */
    public get size(): number {
        return this._data.fontSize;
    }

    /** Line advance, already defaulted to the design size when the item had none. */
    public get lineHeight(): number {
        return this._data.lineHeight;
    }

    /** Looked up by **UTF-16 code unit**, which is what the item table is keyed on. */
    public glyph(charCode: number): BitmapFontGlyph | undefined {
        return this._data.glyphs.get(charCode);
    }

    public hasGlyph(charCode: number): boolean {
        return this._data.glyphs.has(charCode);
    }

    /**
     * Pen advance for a glyph.
     *
     * The item's own `xAdvance` normally answers this, but the parser only
     * applies the font-level fallback for sprite-backed glyphs — a TTF glyph
     * published with a zero would otherwise stall the pen on that character.
     */
    public advanceOf(glyph: BitmapFontGlyph): number {
        if (glyph.xAdvance > 0)
            return glyph.xAdvance;
        if (this._data.xadvance > 0)
            return this._data.xadvance;
        return glyph.xOffset + glyph.rect.width;
    }

    /** The atlas region a glyph is cut from, or `null` if the item named none. */
    public sourceFor(glyph: BitmapFontGlyph): BitmapGlyphSource | null {
        const sprite = this.spriteFor(glyph);
        if (sprite)
            return { atlas: sprite.atlas, rotated: sprite.rotated ?? false };
        // A rasterised TTF carries its glyphs in the font's own texture, and the
        // item's whole-texture sprite is the one that names it.
        const main = this._data.mainSprite;
        return main ? { atlas: main.atlas, rotated: false } : null;
    }

    private spriteFor(glyph: BitmapFontGlyph): AtlasSprite | null {
        const id = glyph.spriteId;
        if (id == null)
            return null;

        let sprite = this._sprites.get(id);
        if (sprite === undefined) {
            sprite = this._owner.getSprite(id) ?? null;
            this._sprites.set(id, sprite);
        }
        return sprite;
    }
}
