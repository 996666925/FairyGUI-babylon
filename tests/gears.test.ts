import { beforeEach, describe, expect, test } from '@rstest/core';
import { GObject } from '../src/core/GObject.js';
import { ObjectPropID } from '../src/core/FieldTypes.js';
import { Color } from '../src/core/utils/Color.js';
import { ByteBuffer } from '../src/core/utils/ByteBuffer.js';
import { setRenderFactory } from '../src/core/render/IRenderObject.js';
import { EaseType } from '../src/core/tween/EaseType.js';
import { TweenManager } from '../src/core/tween/TweenManager.js';
import {
    GearAnimation,
    GearBase,
    GearColor,
    GearDisplay,
    GearDisplay2,
    GearFontSize,
    GearIcon,
    GearIndex,
    GearLook,
    GearSize,
    GearText,
    GearXY,
} from '../src/core/gears/index.js';
import { MockRenderer } from './helpers/mockRender.js';

/**
 * Writes the package format big-endian, the way `ByteBuffer` reads it.
 *
 * Only the handful of kinds a gear payload uses; a test builds the exact
 * layout `GearBase.setup` walks rather than waiting on a real `.fui` fixture.
 */
class ByteWriter {
    private _bytes: number[] = [];

    public byte(v: number): this {
        this._bytes.push(v & 0xff);
        return this;
    }

    public bool(v: boolean): this {
        return this.byte(v ? 1 : 0);
    }

    public short(v: number): this {
        this._bytes.push((v >> 8) & 0xff, v & 0xff);
        return this;
    }

    public int(v: number): this {
        this._bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
        return this;
    }

    public float(v: number): this {
        const view = new DataView(new ArrayBuffer(4));
        view.setFloat32(0, v);
        for (let i = 0; i < 4; i++)
            this._bytes.push(view.getUint8(i));
        return this;
    }

    /** A string-table reference, as `readS` reads it. */
    public s(index: number): this {
        return this.short(index);
    }

    /** `readS`'s null marker. */
    public nullS(): this {
        return this.short(65534);
    }

    public toBuffer(stringTable: string[] = [], version = 1): ByteBuffer {
        const buffer = new ByteBuffer(new Uint8Array(this._bytes).buffer);
        buffer.stringTable = stringTable;
        buffer.version = version;
        return buffer;
    }
}

/** A bare `GObject` whose gear-driven property slots are observable. */
class TestWidget extends GObject {
    public playing = false;
    public frame = 0;
    public fontSize = 12;
    public tint: Color | null = null;
    public strokeColor: Color | null = null;

    private _text: string | null = null;
    private _icon: string | null = null;

    public override get text(): string | null {
        return this._text;
    }

    public override set text(value: string | null) {
        this._text = value;
    }

    public override get icon(): string | null {
        return this._icon;
    }

    public override set icon(value: string | null) {
        this._icon = value;
    }

    public override getProp(index: number): unknown {
        switch (index) {
            case ObjectPropID.Text: return this._text;
            case ObjectPropID.Icon: return this._icon;
            case ObjectPropID.Color: return this.tint;
            case ObjectPropID.OutlineColor: return this.strokeColor;
            case ObjectPropID.FontSize: return this.fontSize;
            case ObjectPropID.Playing: return this.playing;
            case ObjectPropID.Frame: return this.frame;
            default: return super.getProp(index);
        }
    }

    public override setProp(index: number, value: unknown): void {
        switch (index) {
            case ObjectPropID.Text: this._text = value as string | null; break;
            case ObjectPropID.Icon: this._icon = value as string | null; break;
            case ObjectPropID.Color: this.tint = value as Color | null; break;
            case ObjectPropID.OutlineColor: this.strokeColor = value as Color | null; break;
            case ObjectPropID.FontSize: this.fontSize = value as number; break;
            case ObjectPropID.Playing: this.playing = value as boolean; break;
            case ObjectPropID.Frame: this.frame = value as number; break;
            default: super.setProp(index, value);
        }
    }
}

/** What a gear needs of its owner's parent, without a real `GComponent`. */
interface ControllerStub {
    selectedPageId: string | null;
}

interface Harness {
    owner: TestWidget;
    controller: ControllerStub;
}

/**
 * Builds an owner under a parent that can answer `getControllerAt`.
 *
 * `Controller` is a real class in this repo, but a gear only ever reads
 * `selectedPageId` off it, and a stub keeps these tests independent of the
 * controller/component work still in flight.
 */
function makeHarness(): Harness {
    const parent = new GObject();
    parent.setSize(300, 200);

    const controller: ControllerStub = { selectedPageId: 'p1' };
    const hooks = parent as unknown as {
        getControllerAt(index: number): unknown;
        setBoundsChangedFlag(): void;
    };
    hooks.getControllerAt = () => controller;
    // `GObject.setSize`/`setPosition` call into the parent; `GComponent` will
    // have this, a bare `GObject` does not.
    hooks.setBoundsChangedFlag = () => { };

    const owner = new TestWidget();
    (owner as unknown as { _parent: GObject })._parent = parent;

    return { owner, controller };
}

const PAGES = ['p1', 'p2'];

beforeEach(() => {
    setRenderFactory(new MockRenderer());
    GearBase.disableAllTweenEffect = false;
});

describe('gear registration', () => {
    test('GearBase.create resolves every slot to its gear class', () => {
        const { owner } = makeHarness();
        const expected = [
            GearDisplay, GearXY, GearSize, GearLook, GearColor,
            GearAnimation, GearText, GearIcon, GearDisplay2, GearFontSize,
        ];
        for (let i = 0; i < expected.length; i++)
            expect(GearBase.create(owner, i)).toBeInstanceOf(expected[i]);
    });

    test('an unregistered slot is an error, not a silent no-op', () => {
        const { owner } = makeHarness();
        expect(() => GearBase.create(owner, 10)).toThrow(/no gear registered/);
    });
});

describe('GearFontSize', () => {
    // One int per page, plus an int for "no page selected", then no tween.
    function setup(owner: TestWidget): GearFontSize {
        const w = new ByteWriter();
        w.short(0).short(2);
        w.s(0).int(20);
        w.s(1).int(30);
        w.bool(true).int(14);
        w.bool(false);
        const gear = owner.getGear(GearIndex.FontSize) as GearFontSize;
        gear.setup(w.toBuffer(PAGES));
        return gear;
    }

    test('apply pushes the selected page value, and the default otherwise', () => {
        const { owner, controller } = makeHarness();
        const gear = setup(owner);

        controller.selectedPageId = 'p1';
        gear.apply();
        expect(owner.fontSize).toBe(20);

        controller.selectedPageId = 'p2';
        gear.apply();
        expect(owner.fontSize).toBe(30);

        controller.selectedPageId = 'no-such-page';
        gear.apply();
        expect(owner.fontSize).toBe(14);
    });

    test('updateState writes the live value back against the active page', () => {
        const { owner, controller } = makeHarness();
        const gear = setup(owner);

        controller.selectedPageId = 'p1';
        gear.apply();
        owner.fontSize = 99;
        gear.updateState();

        controller.selectedPageId = 'p2';
        gear.apply();
        expect(owner.fontSize).toBe(30);

        controller.selectedPageId = 'p1';
        gear.apply();
        expect(owner.fontSize).toBe(99);
    });
});

describe('GearSize', () => {
    function setup(owner: TestWidget): GearSize {
        const w = new ByteWriter();
        w.short(0).short(2);
        w.s(0).int(100).int(50).float(1).float(1);
        w.s(1).int(200).int(80).float(2).float(0.5);
        w.bool(false);
        w.bool(false);
        const gear = owner.getGear(GearIndex.Size) as GearSize;
        gear.setup(w.toBuffer(PAGES));
        return gear;
    }

    test('apply pushes width, height and scale of the selected page', () => {
        const { owner, controller } = makeHarness();
        owner.setSize(5, 5);
        const gear = setup(owner);

        controller.selectedPageId = 'p1';
        gear.apply();
        expect(owner.width).toBe(100);
        expect(owner.height).toBe(50);
        expect(owner.scaleX).toBe(1);
        expect(owner.scaleY).toBe(1);

        controller.selectedPageId = 'p2';
        gear.apply();
        expect(owner.width).toBe(200);
        expect(owner.height).toBe(80);
        expect(owner.scaleX).toBe(2);
        expect(owner.scaleY).toBe(0.5);
    });

    test('updateFromRelations shifts every stored size', () => {
        const { owner, controller } = makeHarness();
        owner.setSize(5, 5);
        const gear = setup(owner);

        controller.selectedPageId = 'p1';
        gear.apply();

        gear.updateFromRelations(10, 20);

        controller.selectedPageId = 'p2';
        gear.apply();
        expect(owner.width).toBe(210);
        expect(owner.height).toBe(100);

        // The reference finishes updateFromRelations by recording the owner's
        // current size against the *active* page, so p1 is not shifted.
        controller.selectedPageId = 'p1';
        gear.apply();
        expect(owner.width).toBe(100);
        expect(owner.height).toBe(50);
    });
});

describe('GearXY', () => {
    test('apply pushes the selected page point', () => {
        const { owner, controller } = makeHarness();
        const w = new ByteWriter();
        w.short(0).short(2);
        w.s(0).int(10).int(20);
        w.s(1).int(30).int(40);
        w.bool(false);
        w.bool(false);
        const gear = owner.getGear(GearIndex.XY) as GearXY;
        gear.setup(w.toBuffer(PAGES));

        controller.selectedPageId = 'p1';
        gear.apply();
        expect(owner.x).toBe(10);
        expect(owner.y).toBe(20);

        controller.selectedPageId = 'p2';
        gear.apply();
        expect(owner.x).toBe(30);
        expect(owner.y).toBe(40);
    });

    test('updateFromRelations shifts the stored positions', () => {
        const { owner, controller } = makeHarness();
        const w = new ByteWriter();
        w.short(0).short(2);
        w.s(0).int(10).int(20);
        w.s(1).int(30).int(40);
        w.bool(false);
        w.bool(false);
        const gear = owner.getGear(GearIndex.XY) as GearXY;
        gear.setup(w.toBuffer(PAGES));

        controller.selectedPageId = 'p1';
        gear.apply();

        gear.updateFromRelations(5, 7);

        controller.selectedPageId = 'p2';
        gear.apply();
        expect(owner.x).toBe(35);
        expect(owner.y).toBe(47);
    });

    test('percent mode reads the v2 extension and scales against the parent', () => {
        const { owner, controller } = makeHarness();
        const w = new ByteWriter();
        w.short(0).short(1);
        w.s(0).int(10).int(20);
        w.bool(false);
        w.bool(false);
        // v2 extra: the percent flag, then px/py for each page.
        w.bool(true);
        w.s(0).float(0.5).float(0.25);
        w.bool(false);
        const gear = owner.getGear(GearIndex.XY) as GearXY;
        gear.setup(w.toBuffer(['p1'], 2));

        expect(gear.positionsInPercent).toBe(true);

        controller.selectedPageId = 'p1';
        gear.apply();
        expect(owner.x).toBe(150);  // 0.5 * parent width
        expect(owner.y).toBe(50);   // 0.25 * parent height
    });

    test('updateFromRelations is a no-op in percent mode', () => {
        const { owner, controller } = makeHarness();
        const w = new ByteWriter();
        w.short(0).short(1);
        w.s(0).int(10).int(20);
        w.bool(false);
        w.bool(false);
        w.bool(true);
        w.s(0).float(0.5).float(0.25);
        w.bool(false);
        const gear = owner.getGear(GearIndex.XY) as GearXY;
        gear.setup(w.toBuffer(['p1'], 2));

        controller.selectedPageId = 'p1';
        gear.apply();
        gear.updateFromRelations(5, 7);
        gear.apply();
        expect(owner.x).toBe(150);
        expect(owner.y).toBe(50);
    });
});

describe('GearDisplay', () => {
    function setup(owner: TestWidget): GearDisplay {
        const w = new ByteWriter();
        w.short(0).short(2);
        w.s(0).s(1);
        w.bool(false);
        const gear = owner.getGear(GearIndex.Display) as GearDisplay;
        gear.setup(w.toBuffer(PAGES));
        return gear;
    }

    test('reads a page list and reports connected for it', () => {
        const { owner, controller } = makeHarness();
        const gear = setup(owner);

        expect(gear.pages).toEqual(['p1', 'p2']);

        controller.selectedPageId = 'p1';
        gear.apply();
        expect(gear.connected).toBe(true);

        controller.selectedPageId = 'p2';
        gear.apply();
        expect(gear.connected).toBe(true);

        controller.selectedPageId = 'p3';
        gear.apply();
        expect(gear.connected).toBe(false);
    });

    test('with no controller it is always connected', () => {
        const { owner } = makeHarness();
        expect(new GearDisplay(owner).connected).toBe(true);
    });

    test('a lock holds it connected, and a page change voids a stale lock', () => {
        const { owner, controller } = makeHarness();
        const gear = setup(owner);

        controller.selectedPageId = 'p3';
        gear.apply();
        expect(gear.connected).toBe(false);

        const token = gear.addLock();
        expect(gear.connected).toBe(true);
        gear.releaseLock(token);
        expect(gear.connected).toBe(false);

        const stale = gear.addLock();
        expect(gear.connected).toBe(true);
        gear.apply();                  // moves the token on, dropping the lock
        expect(gear.connected).toBe(false);
        gear.releaseLock(stale);       // ignored: stale token
        expect(gear.connected).toBe(false);
    });
});

describe('GearDisplay2', () => {
    function setup(owner: TestWidget, condition: number | null, version: number): GearDisplay2 {
        const w = new ByteWriter();
        w.short(0).short(1);
        w.s(0);
        w.bool(false);
        if (version >= 2)
            w.byte(condition as number);
        const gear = owner.getGear(GearIndex.Display2) as GearDisplay2;
        gear.setup(w.toBuffer(['p1'], version));
        return gear;
    }

    test('condition 0 ANDs the incoming state', () => {
        const { owner, controller } = makeHarness();
        const gear = setup(owner, 0, 2);

        controller.selectedPageId = 'p1';
        gear.apply();
        expect(gear.evaluate(true)).toBe(true);
        expect(gear.evaluate(false)).toBe(false);

        controller.selectedPageId = 'p2';
        gear.apply();
        expect(gear.evaluate(true)).toBe(false);
    });

    test('any other condition ORs the incoming state', () => {
        const { owner, controller } = makeHarness();
        const gear = setup(owner, 1, 2);

        controller.selectedPageId = 'p1';
        gear.apply();
        expect(gear.evaluate(false)).toBe(true);

        controller.selectedPageId = 'p2';
        gear.apply();
        expect(gear.evaluate(false)).toBe(false);
        expect(gear.evaluate(true)).toBe(true);
    });

    test('a v1 package leaves condition undefined, so the gear ORs', () => {
        const { owner, controller } = makeHarness();
        const gear = setup(owner, null, 1);

        expect(gear.condition).toBeUndefined();

        controller.selectedPageId = 'p1';
        gear.apply();
        expect(gear.evaluate(false)).toBe(true);
    });
});

describe('value-per-page gears', () => {
    test('GearText keeps an explicit null apart from a missing entry', () => {
        const { owner, controller } = makeHarness();
        owner.text = 'start';

        const w = new ByteWriter();
        w.short(0).short(2);
        w.s(0).nullS();     // p1: explicitly cleared
        w.s(1).s(2);        // p2: 'hi'
        w.bool(false);
        w.bool(false);
        const gear = owner.getGear(GearIndex.Text) as GearText;
        gear.setup(w.toBuffer(['p1', 'p2', 'hi']));

        controller.selectedPageId = 'p2';
        gear.apply();
        expect(owner.text).toBe('hi');

        controller.selectedPageId = 'p1';
        gear.apply();
        expect(owner.text).toBeNull();

        controller.selectedPageId = 'no-such-page';
        gear.apply();
        expect(owner.text).toBe('start');
    });

    test('GearIcon follows the same null rules', () => {
        const { owner, controller } = makeHarness();
        owner.icon = 'ui://start';

        const w = new ByteWriter();
        w.short(0).short(1);
        w.s(0).s(1);        // p1: 'icon-a'
        w.bool(false);
        w.bool(false);
        const gear = owner.getGear(GearIndex.Icon) as GearIcon;
        gear.setup(w.toBuffer(['p1', 'icon-a']));

        controller.selectedPageId = 'p1';
        gear.apply();
        expect(owner.icon).toBe('icon-a');

        owner.icon = 'ui://changed';
        gear.updateState();
        controller.selectedPageId = 'no-such-page';
        gear.apply();
        expect(owner.icon).toBe('ui://start');
        controller.selectedPageId = 'p1';
        gear.apply();
        expect(owner.icon).toBe('ui://changed');
    });

    test('GearAnimation drives playing and frame through the property slots', () => {
        const { owner, controller } = makeHarness();

        const w = new ByteWriter();
        w.short(0).short(2);
        w.s(0).bool(true).int(12);
        w.s(1).bool(false).int(3);
        w.bool(false);
        w.bool(false);
        const gear = owner.getGear(GearIndex.Animation) as GearAnimation;
        gear.setup(w.toBuffer(PAGES));

        controller.selectedPageId = 'p1';
        gear.apply();
        expect(owner.playing).toBe(true);
        expect(owner.frame).toBe(12);

        controller.selectedPageId = 'p2';
        gear.apply();
        expect(owner.playing).toBe(false);
        expect(owner.frame).toBe(3);

        owner.frame = 99;
        gear.updateState();
        controller.selectedPageId = 'p1';
        gear.apply();
        expect(owner.frame).toBe(12);
        controller.selectedPageId = 'p2';
        gear.apply();
        expect(owner.frame).toBe(99);
    });

    test('GearLook applies alpha, rotation, grayed and touchable', () => {
        const { owner, controller } = makeHarness();

        const w = new ByteWriter();
        w.short(0).short(2);
        w.s(0).float(0.5).float(90).bool(true).bool(false);
        w.s(1).float(1).float(0).bool(false).bool(true);
        w.bool(false);
        w.bool(false);
        const gear = owner.getGear(GearIndex.Look) as GearLook;
        gear.setup(w.toBuffer(PAGES));

        controller.selectedPageId = 'p1';
        gear.apply();
        expect(owner.alpha).toBe(0.5);
        expect(owner.rotation).toBe(90);
        expect(owner.grayed).toBe(true);
        expect(owner.touchable).toBe(false);

        controller.selectedPageId = 'p2';
        gear.apply();
        expect(owner.alpha).toBe(1);
        expect(owner.rotation).toBe(0);
        expect(owner.grayed).toBe(false);
        expect(owner.touchable).toBe(true);
    });

    test('GearColor applies both colours, and reads four bytes per colour', () => {
        const { owner, controller } = makeHarness();

        const w = new ByteWriter();
        w.short(0).short(2);
        w.s(0).byte(10).byte(20).byte(30).byte(128);
        w.byte(1).byte(2).byte(3).byte(4);
        w.s(1).byte(200).byte(0).byte(0).byte(255);
        w.byte(0).byte(0).byte(0).byte(255);
        w.bool(false);
        w.bool(false);
        const gear = owner.getGear(GearIndex.Color) as GearColor;
        gear.setup(w.toBuffer(PAGES));

        controller.selectedPageId = 'p1';
        gear.apply();
        expect(owner.tint).toBeInstanceOf(Color);
        expect(owner.tint!.r).toBe(10);
        expect(owner.tint!.g).toBe(20);
        expect(owner.tint!.b).toBe(30);
        // The reference calls `readColor()` without `hasAlpha`, which discards
        // the stored alpha byte and pins the colour opaque.
        expect(owner.tint!.a).toBe(255);
        expect(owner.strokeColor!.r).toBe(1);
        expect(owner.strokeColor!.g).toBe(2);
        expect(owner.strokeColor!.b).toBe(3);

        controller.selectedPageId = 'p2';
        gear.apply();
        expect(owner.tint!.r).toBe(200);
    });
});

describe('tweened page changes', () => {
    test('a tween config eases the value instead of snapping to it', () => {
        const { owner, controller } = makeHarness();

        const w = new ByteWriter();
        w.short(0).short(1);
        w.s(0).int(100).int(0);
        w.bool(false);
        w.bool(true).byte(EaseType.Linear).float(0.3).float(0);
        const gear = owner.getGear(GearIndex.XY) as GearXY;
        gear.setup(w.toBuffer(['p1']));

        controller.selectedPageId = 'p1';
        gear.apply();
        expect(owner.x).toBe(0);                 // in flight, not applied yet
        expect(gear.tweenConfig._tweener).not.toBeNull();

        TweenManager.update(0.15);
        expect(owner.x).toBeGreaterThan(0);
        expect(owner.x).toBeLessThan(100);

        // The duration is a float32 in the package format (0.30000001192…), so
        // two 0.15 second steps leave the tween a hair short of its endpoint
        // and still running.
        TweenManager.update(0.15);
        expect(owner.x).toBeCloseTo(100);
        expect(gear.tweenConfig._tweener).not.toBeNull();

        TweenManager.update(0.01);
        expect(owner.x).toBe(100);
        expect(gear.tweenConfig._tweener).toBeNull();
    });

    test('disableAllTweenEffect makes the same gear snap', () => {
        const { owner, controller } = makeHarness();

        const w = new ByteWriter();
        w.short(0).short(1);
        w.s(0).int(100).int(0);
        w.bool(false);
        w.bool(true).byte(EaseType.Linear).float(0.3).float(0);
        const gear = owner.getGear(GearIndex.XY) as GearXY;
        gear.setup(w.toBuffer(['p1']));

        GearBase.disableAllTweenEffect = true;
        controller.selectedPageId = 'p1';
        gear.apply();
        expect(owner.x).toBe(100);
        expect(gear.tweenConfig._tweener).toBeNull();
    });
});
