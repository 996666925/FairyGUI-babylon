import { beforeEach, describe, expect, test } from '@rstest/core';
import { UBBParser } from '../src/core/UBBParser.js';
import { GTextField } from '../src/core/GTextField.js';
import { GRichTextField } from '../src/core/GRichTextField.js';
import { GMovieClip, MovieClip } from '../src/core/GMovieClip.js';
import { AutoSizeType, PackageItemType } from '../src/core/FieldTypes.js';
import { Color } from '../src/core/utils/Color.js';
import { Point } from '../src/core/utils/Geometry.js';
import { Rect } from '../src/core/utils/Geometry.js';
import { UIConfig, registerFont } from '../src/core/UIConfig.js';
import { UIPackage } from '../src/core/UIPackage.js';
import { GComponent } from '../src/core/GComponent.js';
import type { GObject } from '../src/core/GObject.js';
import { BitmapFont, type BitmapFontData } from '../src/core/display/BitmapFont.js';
import { setRenderFactory } from '../src/core/render/IRenderObject.js';
import { MockImageObject, MockRenderer, MockTextObject } from './helpers/mockRender.js';
import { readFixture } from './helpers/fixtures.js';

// The object factory has to be installed before a package can be built into widgets.
import '../src/index.js';

/** What the stub below always reports, whatever it was asked to lay out. */
const MEASURED_WIDTH = 120;
const MEASURED_HEIGHT = 40;

/**
 * A text surface that reports fixed measurements.
 *
 * The mock's own `measureTextWidth` scales with the string, which would make
 * every auto-size assertion depend on the text. A constant is what these tests
 * are actually about: whether `GTextField` asks the surface and believes the
 * answer.
 */
class StubTextObject extends MockTextObject {
    public measureTextWidth(): number {
        return MEASURED_WIDTH;
    }

    public measureTextHeight(): number {
        return MEASURED_HEIGHT;
    }
}

class StubRenderer extends MockRenderer {
    public texts: StubTextObject[] = [];

    public override createText(): StubTextObject {
        const text = new StubTextObject();
        this.texts.push(text);
        this.objects.push(text);
        return text;
    }
}

let renderer: StubRenderer;

/** The surface the most recently built text field is drawing into. */
function surface(): StubTextObject {
    return renderer.texts[renderer.texts.length - 1];
}

beforeEach(() => {
    renderer = new StubRenderer();
    setRenderFactory(renderer);

    // The parser is a shared singleton, so per-test state has to be reset.
    UBBParser.inst.linkUnderline = false;
    UBBParser.inst.linkColor = null;
});

describe('UBBParser', () => {
    test('leaves plain text alone', () => {
        expect(UBBParser.inst.parse('hello world')).toBe('hello world');
        expect(UBBParser.inst.parse('')).toBe('');
    });

    test('translates nested tags', () => {
        expect(UBBParser.inst.parse('[b]bold[color=#ff0000]red[/color][/b]'))
            .toBe('<b>bold<color=#ff0000>red</color></b>');
        expect(UBBParser.inst.lastColor).toBe('#ff0000');
    });

    test('leaves a tag with no closing bracket verbatim', () => {
        expect(UBBParser.inst.parse('hello [b')).toBe('hello [b');
        expect(UBBParser.inst.parse('hello [color=#fff')).toBe('hello [color=#fff');
    });

    test('honours the closing bracket of an unclosed tag', () => {
        // The tag itself is well formed; only its partner is missing, and the
        // reference emitted the opening markup regardless.
        expect(UBBParser.inst.parse('[b]abc')).toBe('<b>abc');
    });

    test('does not decode entities, and lets a backslash escape a bracket', () => {
        expect(UBBParser.inst.parse('a&amp;b&lt;c')).toBe('a&amp;b&lt;c');
        expect(UBBParser.inst.parse('\\[b]x')).toBe('[b]x');
    });

    test('translates a tag that carries no value', () => {
        expect(UBBParser.inst.parse('[b]x[/b]')).toBe('<b>x</b>');
        expect(UBBParser.inst.parse('[u]x[/u]')).toBe('<u>x</u>');
    });

    test('takes a url tag\'s target from its attribute', () => {
        expect(UBBParser.inst.parse('[url=http://a]click[/url]'))
            .toBe('<on click="onClickLink" param="http://a">click</on>');
    });

    test('repeats the url as link text when the tag has no attribute', () => {
        // A quirk worth pinning: `getTagText()` is called without `remove`, so
        // the scanned text is emitted again by the main loop as the link label.
        expect(UBBParser.inst.parse('[url]http://a[/url]'))
            .toBe('<on click="onClickLink" param="http://a">http://a</on>');
    });

    test('underlines and tints a url when asked to', () => {
        UBBParser.inst.linkUnderline = true;
        UBBParser.inst.linkColor = '#0000ff';

        expect(UBBParser.inst.parse('[url=http://a]click[/url]'))
            .toBe('<on click="onClickLink" param="http://a"><u><color=#0000ff>click</color></u></on>');
    });

    test('consumes an img tag and its source', () => {
        expect(UBBParser.inst.parse('[img]ui://abc[/img]')).toBe('<img src="ui://abc"/>');
        expect(UBBParser.inst.parse('[img][/img]')).toBe('');
    });

    test('records the last size tag', () => {
        UBBParser.inst.parse('[size=20]x[/size]');
        expect(UBBParser.inst.lastSize).toBe('20');
        expect(UBBParser.inst.lastColor).toBeNull();
    });

    test('leaves an unknown tag as written', () => {
        expect(UBBParser.inst.parse('[foo]bar[/foo]')).toBe('[foo]bar[/foo]');
    });

    test('drops recognised tags when asked to remove them', () => {
        expect(UBBParser.inst.parse('[b]bold[/b] [color=#ff0000]red[/color]', true))
            .toBe('bold red');
        // Still reported despite the tag being dropped, because it was
        // recognised — `GTextInput` reads this back for its placeholder.
        expect(UBBParser.inst.lastColor).toBe('#ff0000');

        expect(UBBParser.inst.parse('[url=http://a]click[/url]', true)).toBe('click');
        // Each parse resets it, so the url parse leaves no colour behind.
        expect(UBBParser.inst.lastColor).toBeNull();
    });
});

describe('GTextField auto sizing', () => {
    test('both: takes the measured text size', () => {
        const field = new GTextField();
        expect(field.autoSize).toBe(AutoSizeType.Both);

        field.text = 'hello';

        expect(field.width).toBe(MEASURED_WIDTH);
        expect(field.height).toBe(MEASURED_HEIGHT);
        expect(field.node.contentWidth).toBe(MEASURED_WIDTH);
        expect(field.node.contentHeight).toBe(MEASURED_HEIGHT);
        expect(surface().wrapWidth).toBe(0);
    });

    test('height: keeps the width and takes the measured height', () => {
        const field = new GTextField();
        field.autoSize = AutoSizeType.Height;
        field.setSize(300, 5);

        field.text = 'hello';

        expect(field.width).toBe(300);
        expect(field.height).toBe(MEASURED_HEIGHT);
        // Wrapping is what makes the measured height meaningful, so the box
        // width is handed to the surface.
        expect(surface().wrapWidth).toBe(300);
        expect(surface().autoSize).toBe(AutoSizeType.Height);
    });

    test('does not resize before the size is read', () => {
        const field = new GTextField();
        field.setSize(10, 10);
        field.text = 'hello';

        // `_width` is public state and is untouched until `ensureSizeCorrect()`
        // runs, which is what `width`/`height` trigger.
        expect(field._width).toBe(10);
        expect(field.width).toBe(MEASURED_WIDTH);
    });

    test('none: keeps the size it was given', () => {
        const field = new GTextField();
        field.autoSize = AutoSizeType.None;
        field.setSize(200, 100);

        field.text = 'hello';

        expect(field.width).toBe(200);
        expect(field.height).toBe(100);
        expect(surface().wrapWidth).toBe(200);
        expect(surface().autoSize).toBe(AutoSizeType.None);
        expect(field.node.contentWidth).toBe(200);
        expect(field.node.contentHeight).toBe(100);
    });

    test('shrink: keeps the size it was given', () => {
        const field = new GTextField();
        field.autoSize = AutoSizeType.None;
        field.setSize(200, 100);
        field.autoSize = AutoSizeType.Shrink;

        field.text = 'hello';

        expect(field.width).toBe(200);
        expect(field.height).toBe(100);
        expect(surface().autoSize).toBe(AutoSizeType.Shrink);
    });

    test('textWidth reports the laid-out text rather than the box', () => {
        const field = new GTextField();
        field.autoSize = AutoSizeType.None;
        field.setSize(500, 100);
        field.text = 'x';

        expect(field.textWidth).toBe(MEASURED_WIDTH);
        expect(field.width).toBe(500);
    });
});

describe('GTextField template variables', () => {
    test('substitutes a named variable', () => {
        const field = new GTextField();
        field.templateVars = { name: 'World' };
        field.text = 'Hello {name}';

        expect(surface().text).toBe('Hello World');
    });

    test('falls back inline, drops a bare miss, and keeps an empty placeholder', () => {
        const field = new GTextField();
        field.setVar('a', 'A');
        field.text = '{a=fallback}|{missing=fallback}|{missing}|{}';

        expect(surface().text).toBe('A|fallback||{}');
    });

    test('leaves placeholders alone until there is a variable table', () => {
        // Template parsing is skipped entirely while `templateVars` is null, so
        // the braces survive — the reference did the same.
        const field = new GTextField();
        field.text = 'Hello {name}';
        expect(surface().text).toBe('Hello {name}');

        field.setVar('name', 'World');
        field.flushVars();

        expect(surface().text).toBe('Hello World');
    });
});

describe('GTextField markup and surface binding', () => {
    test('leaves ubb alone until it is turned on', () => {
        const field = new GTextField();
        expect(field.ubb).toBe(false);

        field.text = '[b]hi[/b]';
        expect(surface().text).toBe('[b]hi[/b]');

        field.ubb = true;
        expect(surface().text).toBe('hi');
    });

    test('the ubbEnabled spelling reaches the same setting', () => {
        const field = new GTextField();
        field.ubbEnabled = true;
        expect(field.ubb).toBe(true);
    });

    test('applies font, size, colour and alignment to the surface', () => {
        const field = new GTextField();
        field.font = 'Arial';
        field.fontSize = 20;
        field.leading = 4;
        field.letterSpacing = 2;
        field.align = 1;
        field.singleLine = true;
        field.underline = true;
        field.bold = true;

        const text = surface();
        expect(text.font).toBe('Arial');
        expect(text.fontSize).toBe(20);
        expect(text.leading).toBe(4);
        expect(text.letterSpacing).toBe(2);
        expect(text.align).toBe(1);
        expect(text.singleLine).toBe(true);
        expect(text.underline).toBe(true);
        expect(text.fontStyle).toBe('bold');

        field.italic = true;
        expect(surface().fontStyle).toBe('bolditalic');
    });

    test('falls back to the default font for a url that names nothing', () => {
        const field = new GTextField();
        field.font = 'ui://nothinghere';
        expect(surface().font).toBe('Arial');
    });

    test('greys the surface colour when the field is disabled', () => {
        const field = new GTextField();
        field.color = { r: 255, g: 0, b: 0, a: 255 } as never;
        field.grayed = true;

        // Rec. 601 luma of pure red, which is what the reference's `toGrayed`
        // produced too.
        expect(Math.round(surface().color.r)).toBe(Math.round(255 * 0.299));
    });
});

/**
 * `Basics` ships both flavours of package font: `HitNumber`, whose glyphs are
 * sprites in the package atlas, and `BMFontTest`, a TTF rasterised into it.
 */
function basics(): UIPackage {
    return UIPackage.parse(readFixture('Basics.fui'), 'ui/Basics');
}

describe('bitmap fonts', () => {
    test('a font item decodes into a table a renderer can draw from', () => {
        const pkg = basics();
        const item = pkg.getItemByName('HitNumber')!;
        const font = item.bitmapFont!;

        expect(font).toBeInstanceOf(BitmapFont);
        expect(font.url).toBe(`ui://${pkg.id}${item.id}`);
        expect(font.size, 'design size').toBe(50);
        expect(font.lineHeight).toBe(50);
        expect(font.canTint).toBe(false);
        expect(font.resizable).toBe(false);
        expect(font.data.glyphs.size).toBe(10);

        // `'0'`: the rect is already in atlas coordinates, the offsets are what
        // the pen adds. These are the numbers the geometry is asserted against.
        const zero = font.glyph(48)!;
        expect([zero.rect.x, zero.rect.y, zero.rect.width, zero.rect.height]).toEqual([482, 200, 35, 37]);
        expect([zero.xOffset, zero.yOffset]).toEqual([11, 7]);
        expect(font.advanceOf(zero)).toBe(33);

        // A sprite-backed glyph still has to name the atlas to sample it from.
        const source = font.sourceFor(zero)!;
        expect(source.atlas.type).toBe(PackageItemType.Atlas);
        expect(source.rotated).toBe(false);
    });

    test('a field naming a package font hands the table to the surface', () => {
        const pkg = basics();

        const field = new GTextField();
        field.font = 'ui://Basics/HitNumber';

        const text = surface();
        expect(text.bitmapFont, 'the glyph table reached the surface').toBeInstanceOf(BitmapFont);
        expect(text.bitmapFont!.url).toBe(`ui://${pkg.id}${pkg.getItemByName('HitNumber')!.id}`);
        // The name is still the URL the field was given, for a backend that
        // reads names rather than tables.
        expect(text.font).toBe('ui://Basics/HitNumber');
    });

    test('a font that cannot scale snaps the size the surface draws at', () => {
        basics();

        const field = new GTextField();
        field.fontSize = 30;
        field.font = 'ui://Basics/HitNumber';

        // The request stays on the field — `fontSize` reports what was asked
        // for — while the surface, which can only draw the baked bitmaps, gets
        // the design size.
        expect(field.fontSize).toBe(30);
        expect(surface().fontSize).toBe(50);

        // ...and the same the other way round, where the font arrives first.
        const other = new GTextField();
        other.font = 'ui://Basics/HitNumber';
        other.fontSize = 30;
        expect(other.fontSize).toBe(30);
        expect(surface().fontSize).toBe(50);
    });

    test('a font registered by name scales', () => {
        const pkg = basics();
        const source = pkg.getItemByName('HitNumber')!.bitmapFont!;
        const scalable: BitmapFontData = { ...source.data, resizable: true };
        registerFont('scalable-test-font', new BitmapFont(scalable, pkg, 'scalable-test-font'));

        const field = new GTextField();
        field.font = 'scalable-test-font';
        field.fontSize = 30;

        expect(surface().bitmapFont!.url).toBe('scalable-test-font');
        expect(surface().fontSize, 'a scalable font is drawn at the size asked for').toBe(30);
    });

    test('a url naming something that is not a font falls back to the default', () => {
        basics();
        const field = new GTextField();
        // `Demo_Text` is a component; its URL resolves, but to no font.
        field.font = 'ui://Basics/Demo_Text';

        expect(surface().font).toBe(UIConfig.defaultFont);
        expect(surface().bitmapFont).toBeNull();
    });

    test('a font that cannot be tinted ignores the field colour', () => {
        basics();
        const field = new GTextField();
        field.font = 'ui://Basics/HitNumber';
        field.color = new Color(255, 0, 0, 255);

        // The glyphs carry their own colours, so the field's red is dropped
        // rather than multiplied into them.
        expect([surface().color.r, surface().color.g]).toEqual([255, 255]);

        field.grayed = true;
        expect(surface().color.r, 'greying is a tint too').toBe(255);
    });

    test('a font that can be tinted takes the field colour', () => {
        basics();
        const field = new GTextField();
        field.font = 'ui://Basics/BMFontTest';
        field.color = new Color(255, 0, 0, 255);

        expect(surface().bitmapFont!.canTint).toBe(true);
        expect([surface().color.r, surface().color.g]).toEqual([255, 0]);
    });
});

describe('GTextField outline and shadow', () => {
    test('the outline and shadow reach the surface', () => {
        // Both are drawn by the surface, so the core only has to pass them on —
        // which it did not, leaving every authored outline and shadow unrendered.
        const field = new GTextField();
        field.stroke = 2;
        field.strokeColor = new Color(0, 0, 0, 255);
        field.shadowOffset = new Point(3, 4);
        field.shadowColor = new Color(255, 0, 0, 255);

        const text = surface();
        expect(text.stroke, 'outline width').toBe(2);
        expect([text.strokeColor.r, text.strokeColor.g, text.strokeColor.b]).toEqual([0, 0, 0]);
        expect([text.shadowOffsetX, text.shadowOffsetY]).toEqual([3, 4]);
        expect(text.shadowColor.r, 'shadow colour').toBe(255);
    });

    test('a field built from a package keeps the outline it was authored with', () => {
        const pkg = basics();
        const screen = pkg.createObject('Demo_ComboBox') as GComponent;

        const outlined: GTextField[] = [];
        const walk = (o: GObject): void => {
            const field = o as GTextField;
            if (field.stroke > 0)
                outlined.push(field);
            const com = o as GComponent;
            for (let i = 0; i < com.numChildren; i++)
                walk(com.getChildAt(i));
        };
        walk(screen);

        // Two of the four combos' titles are authored with a 1px black outline.
        expect(outlined.length).toBe(2);
        for (const field of outlined) {
            expect(field.stroke).toBe(1);
            expect(field.strokeColor!.toHex(), 'black ink').toBe('#000000ff');
            expect((field.node as MockTextObject).stroke, 'and the surface has it').toBe(1);
        }
    });
});

describe('GRichTextField', () => {
    test('keeps markup and wraps the text in a colour span', () => {
        const field = new GRichTextField();
        expect(field.autoSize).toBe(AutoSizeType.None);
        expect(field.linkUnderline).toBe(true);

        field.ubb = true;
        field.text = '[b]hi[/b]';

        expect(surface().rich).toBe(true);
        expect(surface().text).toBe('<color=#ffffff><b>hi</b></color>');
    });

    test('wraps at the box width, and not at all in auto-size mode', () => {
        const field = new GRichTextField();
        field.setSize(200, 100);
        field.text = 'hi';
        expect(surface().wrapWidth).toBe(200);

        field.autoSize = AutoSizeType.Both;
        field.text = 'hi';
        expect(surface().wrapWidth).toBe(0);
    });

    test('doubles the leading, matching the reference line height', () => {
        const field = new GRichTextField();
        field.fontSize = 12;
        field.leading = 3;

        // The reference set `lineHeight = fontSize + leading * 2`; the seam
        // carries the gap, so the gap is what doubles.
        expect(surface().leading).toBe(6);
    });

    test('wraps style flags around the text', () => {
        const field = new GRichTextField();
        field.bold = true;
        field.italic = true;
        field.text = 'x';

        expect(surface().text).toBe('<color=#ffffff><i><b>x</b></i></color>');
    });
});

describe('MovieClip', () => {
    /** A three-frame clip, one second each, on a mock image surface. */
    function makeClip(): { mc: MovieClip; content: MockImageObject } {
        const content = new MockImageObject();
        const mc = new MovieClip(content);
        mc.frameResolver = (frame) => ({ texture: 'tex', rect: frame.rect, rotated: false });
        mc.interval = 1;
        mc.setPlaySettings();
        mc.frames = [
            { rect: new Rect(0, 0, 10, 10), addDelay: 0, spriteId: 'a' },
            { rect: new Rect(10, 0, 10, 10), addDelay: 0, spriteId: 'b' },
            { rect: new Rect(20, 0, 10, 10), addDelay: 0, spriteId: 'c' },
        ];
        return { mc, content };
    }

    test('draws the first frame as soon as it has one', () => {
        const { mc, content } = makeClip();

        expect(mc.frameCount).toBe(3);
        expect(mc.frame).toBe(0);
        expect(content.sprite?.texture).toBe('tex');
        expect(content.sprite?.rect?.x).toBe(0);
    });

    test('keeps MovieClip frame offsets on the published canvas', () => {
        const pkg = UIPackage.parse(readFixture('TreeView.fui'), 'ui/TreeView');
        const clip = pkg.createObject('heart') as GMovieClip;
        const content = clip._content as MockImageObject;

        // Laya's frame texture is created with the frame rect's x/y and the
        // MovieClip item's 75x66 size. The first heart frame is 54x47 at
        // (11,15), so it must not be stretched into the whole content box.
        expect(content.sprite?.trim).toEqual({
            x: 11,
            y: 15,
            originalWidth: 75,
            originalHeight: 66,
        });

        clip.frame = 7;
        expect(content.sprite?.trim).toBeNull();
    });

    test('holds a frame until its interval elapses', () => {
        const { mc } = makeClip();

        mc.update(0.5);
        expect(mc.frame).toBe(0);

        mc.update(0.6);
        expect(mc.frame).toBe(1);

        mc.update(1);
        expect(mc.frame).toBe(2);

        mc.update(1);
        expect(mc.frame).toBe(0);
    });

    test('catches up across frames while retaining the elapsed remainder', () => {
        const { mc } = makeClip();

        mc.update(2.5);
        expect(mc.frame).toBe(2);

        // The half-second left after frames 0 and 1 is still part of frame 2.
        mc.update(0.5);
        expect(mc.frame).toBe(0);
    });

    test('ignores invalid time deltas', () => {
        const { mc } = makeClip();

        mc.update(Number.NaN);
        mc.update(Number.POSITIVE_INFINITY);
        mc.update(-1);

        expect(mc.frame).toBe(0);
    });

    test('does not advance while paused, and rewinds on request', () => {
        const { mc } = makeClip();
        mc.playing = false;

        mc.update(5);
        expect(mc.frame).toBe(0);

        mc.playing = true;
        mc.update(1.1);
        expect(mc.frame).toBe(1);

        mc.rewind();
        expect(mc.frame).toBe(0);
    });

    test('advance skips whole rounds instead of ticking', () => {
        const { mc } = makeClip();

        mc.advance(1.5);
        expect(mc.frame).toBe(1);

        // 3.5s is one whole round plus a half, and lands where a round plus a
        // half from the current frame should rather than counting frames down.
        mc.rewind();
        mc.advance(3.5);
        expect(mc.frame).toBe(0);
        expect(mc.playing).toBe(true);
    });

    test('stops on the end frame and calls back once', () => {
        const { mc } = makeClip();
        let ended = 0;
        mc.setPlaySettings(0, 1, 1, 0, () => { ended++; });

        mc.update(1);
        expect(mc.frame).toBe(1);

        mc.update(1);
        expect(mc.frame).toBe(0);
        expect(ended).toBe(1);

        // Settled: further ticks do nothing.
        mc.update(10);
        expect(mc.frame).toBe(0);
        expect(ended).toBe(1);
    });

    test('a clip with no frames ignores ticking', () => {
        const mc = new MovieClip(new MockImageObject());

        // Interval zero with no frames is the shape that used to spin: the
        // round-skip divided by zero and never terminated.
        mc.update(1);
        mc.advance(1);
        mc.rewind();

        expect(mc.frameCount).toBe(0);
    });

    test('GMovieClip tolerates a tick before any content is bound', () => {
        const clip = new GMovieClip();
        clip.onUpdate(0.5);

        expect(clip.frame).toBe(0);
        expect(clip.playing).toBe(true);
    });
});
