import { describe, expect, test } from '@rstest/core';
import { UIPackage } from '../src/core/UIPackage.js';
import type { PackageItem } from '../src/core/PackageItem.js';
import { ObjectType, PackageItemType } from '../src/core/FieldTypes.js';
import { readFixture, readPngSize } from './helpers/fixtures.js';

/** Every package shipped in the demo, which doubles as a fixture corpus. */
const PACKAGES = [
    'Bag', 'Basics', 'Chat', 'Cooldown', 'Guide', 'HitTest', 'Joystick',
    'ListEffect', 'LoopList', 'MainMenu', 'ModalWaiting', 'PullToRefresh',
    'ScrollPane', 'Transition', 'TreeView', 'VirtualList',
];

function parse(name: string): UIPackage {
    return UIPackage.parse(readFixture(`${name}.fui`), `ui/${name}`);
}

describe('UIPackage.parse', () => {
    test('rejects a buffer without the FGUI magic', () => {
        expect(() => UIPackage.parse(new ArrayBuffer(64), 'bogus'))
            .toThrow(/old package format/);
    });

    test('reads the header of every shipped package', () => {
        for (const name of PACKAGES) {
            const pkg = parse(name);
            expect(pkg.name, `${name}: package name`).toBe(name);
            // Ids are 8 characters; several widgets assume that width.
            expect(pkg.id, `${name}: package id`).toHaveLength(8);
            expect(pkg.items.length, `${name}: item count`).toBeGreaterThan(0);
            expect(pkg.path, `${name}: path`).toBe(`ui/${name}`);
        }
    });

    test('item ids and names are unique and non-empty', () => {
        for (const name of PACKAGES) {
            const pkg = parse(name);
            const ids = new Set<string>();
            const names = new Set<string>();
            for (const item of pkg.items) {
                expect(item.id, `${name}: item id`).toBeTruthy();
                expect(ids.has(item.id), `${name}: duplicate id ${item.id}`).toBe(false);
                ids.add(item.id);

                if (item.name != null) {
                    expect(names.has(item.name), `${name}: duplicate name ${item.name}`).toBe(false);
                    names.add(item.name);
                }
            }
        }
    });

    test('every item is reachable through its id', () => {
        const pkg = parse('Basics');
        for (const item of pkg.items)
            expect(pkg.getItemById(item.id)).toBe(item);
    });

    test('reading the same package twice does not disturb the registries', () => {
        const first = parse('Bag');
        const second = parse('Bag');
        expect(second.id).toBe(first.id);
        expect(UIPackage.getByName('Bag')!.id).toBe(first.id);
    });
});

describe('UIPackage atlas sprites', () => {
    test('every sprite lies inside its atlas bitmap', () => {
        for (const name of PACKAGES) {
            const pkg = parse(name);
            const atlasSizes = new Map<string, { width: number; height: number }>();

            for (const item of pkg.items) {
                if (item.type !== PackageItemType.Atlas)
                    continue;
                // pi.file is "<base>_atlas0.png"; the fixture uses the same tail.
                const file = item.file!;
                atlasSizes.set(item.id, readPngSize(file.substring(file.lastIndexOf('/') + 1)));
            }

            expect(atlasSizes.size, `${name}: atlas count`).toBeGreaterThan(0);

            let spriteCount = 0;
            for (const item of pkg.items) {
                const sprite = pkg.getSprite(item.id);
                if (!sprite)
                    continue;
                spriteCount++;

                const size = atlasSizes.get(sprite.atlas.id);
                expect(size, `${name}/${item.name}: sprite has a known atlas`).toBeTruthy();

                const { rect } = sprite;
                expect(rect.width, `${name}/${item.name}: rect width`).toBeGreaterThan(0);
                expect(rect.height, `${name}/${item.name}: rect height`).toBeGreaterThan(0);
                expect(rect.x, `${name}/${item.name}: rect.x >= 0`).toBeGreaterThanOrEqual(0);
                expect(rect.y, `${name}/${item.name}: rect.y >= 0`).toBeGreaterThanOrEqual(0);
                expect(
                    rect.x + rect.width,
                    `${name}/${item.name}: rect within atlas width (${rect.x}+${rect.width} vs ${size!.width})`,
                ).toBeLessThanOrEqual(size!.width);
                expect(
                    rect.y + rect.height,
                    `${name}/${item.name}: rect within atlas height (${rect.y}+${rect.height} vs ${size!.height})`,
                ).toBeLessThanOrEqual(size!.height);

                // originalWidth/Height describe the untrimmed image, so they can
                // be larger than the packed rect but never smaller.
                expect(sprite.originalWidth).toBeGreaterThanOrEqual(rect.width);
                expect(sprite.originalHeight).toBeGreaterThanOrEqual(rect.height);
            }

            expect(spriteCount, `${name}: sprite count`).toBeGreaterThan(0);
        }
    });

    test('image items carry the size the editor published', () => {
        const pkg = parse('MainMenu');
        const images = pkg.items.filter((i) => i.type === PackageItemType.Image);
        expect(images.length).toBeGreaterThan(0);
        for (const item of images) {
            expect(item.width, `${item.name}: width`).toBeGreaterThan(0);
            expect(item.height, `${item.name}: height`).toBeGreaterThan(0);
        }
    });
});

describe('UIPackage components', () => {
    test('component items expose their raw payload', () => {
        const pkg = parse('Basics');
        const components = pkg.items.filter((i) => i.type === PackageItemType.Component);
        expect(components.length).toBeGreaterThan(0);
        for (const item of components) {
            expect(item.rawData, `${item.name}: rawData`).toBeTruthy();
            expect(item.rawData!.length, `${item.name}: rawData length`).toBeGreaterThan(0);
        }
    });

    test('component payloads are re-readable after parsing', () => {
        // rawData is a window into the package buffer; if the parser left the
        // cursor wrong, reading it back would run past the end.
        const pkg = parse('Transition');
        for (const item of pkg.items) {
            if (item.type !== PackageItemType.Component || !item.rawData)
                continue;
            const buf = item.rawData;
            buf.position = 0;
            expect(() => buf.readShort(), `${item.name}: first field`).not.toThrow();
        }
    });
});

/**
 * Values captured from a known-good parse of the shipped packages. They are not
 * derived from the format — they exist so that a change to the reader that still
 * produces "plausible" output cannot pass unnoticed.
 */
describe('UIPackage golden values', () => {
    test('MainMenu parses to its published shape', () => {
        const pkg = parse('MainMenu');
        expect(pkg.id).toBe('58oxr1hs');
        expect(pkg.items).toHaveLength(9);

        const root = pkg.getItemByName('Main')!;
        expect(root.type).toBe(PackageItemType.Component);
        expect(root.objectType).toBe(ObjectType.Component);
        expect([root.width, root.height]).toEqual([1136, 640]);

        // Two Button extensions and two plain images round out the package.
        const buttons = pkg.items.filter((i) => i.objectType === ObjectType.Button);
        expect(buttons.map((i) => i.name).sort()).toEqual(['Button', 'CloseButton']);

        const atlas = pkg.items.find((i) => i.type === PackageItemType.Atlas)!;
        expect(atlas.file).toBe('ui/MainMenu_atlas0.png');
        expect(readPngSize('MainMenu_atlas0.png')).toEqual({ width: 128, height: 128 });
    });

    test('Bag parses to its published shape', () => {
        const pkg = parse('Bag');
        expect(pkg.id).toBe('rbw1tv9t');
        expect(pkg.items).toHaveLength(17);

        const clip = pkg.getItemByName('quan')!;
        expect(clip.type).toBe(PackageItemType.MovieClip);
        expect(clip.frames).toHaveLength(12);
        expect(clip.interval).toBeGreaterThan(0);
        expect(readPngSize('Bag_atlas0.png')).toEqual({ width: 1024, height: 512 });
    });

    test('nine-slice items keep their grid and tile flag', () => {
        const pkg = parse('MainMenu');
        const stretched = pkg.getItemByName('b7_png')!;
        expect(stretched.scale9Grid).toBeTruthy();
        // The grid must fit inside the image it cuts up.
        const grid = stretched.scale9Grid!;
        expect(grid.x).toBeGreaterThanOrEqual(0);
        expect(grid.y).toBeGreaterThanOrEqual(0);
        expect(grid.xMax).toBeLessThanOrEqual(stretched.width);
        expect(grid.yMax).toBeLessThanOrEqual(stretched.height);
    });
});

describe('UIPackage.load', () => {
    test('fetches "<basePath>.fui" and parses it against the base path', async () => {
        const original = globalThis.fetch;
        const asked: string[] = [];
        globalThis.fetch = (async (url: string) => {
            asked.push(url);
            const bytes = readFixture('MainMenu.fui');
            return {
                ok: true,
                status: 200,
                arrayBuffer: async () => bytes,
            };
        }) as unknown as typeof fetch;

        try {
            const pkg = await UIPackage.load('ui/MainMenu');
            expect(asked).toEqual(['ui/MainMenu.fui']);
            expect(pkg.name).toBe('MainMenu');

            // The base path is what atlases resolve against.
            const atlas = pkg.items.find((i) => i.type === PackageItemType.Atlas)!;
            expect(atlas.file).toBe('ui/MainMenu_atlas0.png');
        } finally {
            globalThis.fetch = original;
        }
    });

    test('honours a custom package extension', async () => {
        const original = globalThis.fetch;
        let asked = '';
        globalThis.fetch = (async (url: string) => {
            asked = url;
            return { ok: true, status: 200, arrayBuffer: async () => readFixture('Bag.fui') };
        }) as unknown as typeof fetch;

        try {
            await UIPackage.load('ui/Bag', '.bytes');
            expect(asked).toBe('ui/Bag.bytes');
        } finally {
            globalThis.fetch = original;
        }
    });

    test('reports a failed fetch rather than parsing an error page', async () => {
        const original = globalThis.fetch;
        globalThis.fetch = (async () => ({
            ok: false,
            status: 404,
            arrayBuffer: async () => new ArrayBuffer(0),
        })) as unknown as typeof fetch;

        try {
            await expect(UIPackage.load('ui/Missing')).rejects.toThrow(/404/);
        } finally {
            globalThis.fetch = original;
        }
    });
});

describe('UIPackage URLs', () => {
    test('resolves id-based and name-based ui:// URLs', () => {
        const pkg = parse('MainMenu');
        // The package is named "MainMenu"; its root component is "Main".
        const item = pkg.items.find((i) => i.name === 'Main')!;
        expect(item).toBeTruthy();

        const byId = UIPackage.getItemByURL(`ui://${pkg.id}${item.id}`);
        expect(byId?.id).toBe(item.id);

        const byName = UIPackage.getItemByURL(`ui://${pkg.name}/${item.name}`);
        expect(byName?.id).toBe(item.id);
    });

    test('normalizeURL turns a name URL into an id URL', () => {
        const pkg = parse('Bag');
        const item = pkg.items.find((i) => i.name != null)!;
        const normalized = UIPackage.normalizeURL(`ui://${pkg.name}/${item.name}`);
        expect(normalized).toBe(`ui://${pkg.id}${item.id}`);
    });

    test('getItemURL returns null for unknown inputs', () => {
        parse('Cooldown');
        expect(UIPackage.getItemURL('NoSuchPackage', 'x')).toBeNull();
        expect(UIPackage.getItemURL('Cooldown', 'NoSuchItem')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// bitmap fonts
// ---------------------------------------------------------------------------

describe('UIPackage fonts', () => {
    /** Every font item in the shipped corpus, with the package it came from. */
    function fontItems(): Array<{ pkg: UIPackage; item: PackageItem }> {
        const out: Array<{ pkg: UIPackage; item: PackageItem }> = [];
        for (const name of PACKAGES) {
            const pkg = parse(name);
            for (const item of pkg.items) {
                if (item.type === PackageItemType.Font)
                    out.push({ pkg, item });
            }
        }
        return out;
    }

    test('every font item decodes into a table a renderer can draw from', () => {
        const fonts = fontItems();
        expect(fonts.length, 'the corpus does have fonts to check').toBeGreaterThan(0);

        for (const { pkg, item } of fonts) {
            const where = `${pkg.name}/${item.name}`;
            const font = item.bitmapFont;
            expect(font, `${where}: decoded at parse time`).toBeDefined();
            expect(font!.url, `${where}: url`).toBe(`ui://${pkg.id}${item.id}`);
            expect(font!.data.glyphs.size, `${where}: glyphs`).toBeGreaterThan(0);
            expect(font!.lineHeight, `${where}: line height`).toBeGreaterThan(0);

            // A glyph the renderer cannot place is a glyph it cannot draw, so
            // every entry has to name the ink it samples.
            for (const glyph of font!.data.glyphs.values()) {
                expect(glyph.rect.width, `${where}: glyph width`).toBeGreaterThan(0);
                expect(glyph.rect.height, `${where}: glyph height`).toBeGreaterThan(0);
            }
        }
    });

    test('glyph ink sits inside the line box the font declares', () => {
        // This is the placement model the renderer relies on: a line is
        // `lineHeight` tall and each glyph is drawn at its own offset from that
        // line's top. If a published font ever contradicted it, the glyphs would
        // spill into the line below rather than the model being wrong.
        for (const { pkg, item } of fontItems()) {
            const font = item.bitmapFont!;
            const where = `${pkg.name}/${item.name}`;
            for (const glyph of font.data.glyphs.values()) {
                expect(
                    glyph.yOffset + glyph.rect.height,
                    `${where}: char ${glyph.charId} fits its line`,
                ).toBeLessThanOrEqual(font.lineHeight);
            }
        }
    });

    test('a font samples a single atlas', () => {
        // One text object is one mesh with one texture, so a font whose glyphs
        // were packed across two atlases could not be drawn in one pass. Nothing
        // the editor publishes does that, and the renderer drops what it cannot
        // sample — this is the assertion that would catch it.
        for (const { pkg, item } of fontItems()) {
            const font = item.bitmapFont!;
            const atlases = new Set<string>();
            for (const glyph of font.data.glyphs.values()) {
                const source = font.sourceFor(glyph);
                expect(source, `${pkg.name}/${item.name}: char ${glyph.charId} has a source`).not.toBeNull();
                atlases.add(source!.atlas.id);
            }
            expect(atlases.size, `${pkg.name}/${item.name}: atlases sampled`).toBeLessThanOrEqual(1);
        }
    });

    test('a glyph knows whether its region is stored rotated', () => {
        // The renderer hands this to the UV mapping, which swaps the displayed
        // width and height when it is set.
        for (const { pkg, item } of fontItems()) {
            const font = item.bitmapFont!;
            for (const glyph of font.data.glyphs.values()) {
                const source = font.sourceFor(glyph)!;
                expect(typeof source.rotated, `${pkg.name}/${item.name}: rotated flag`).toBe('boolean');
            }
        }
    });
});
