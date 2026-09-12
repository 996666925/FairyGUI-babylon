import { EaseType } from '../tween/EaseType.js';
import type { ByteBuffer } from '../utils/ByteBuffer.js';
import type { GObject } from '../GObject.js';
import type { Controller } from '../Controller.js';
import type { GTweener } from '../tween/GTweener.js';

/** Tween settings for a gear's page transitions. */
export class GearTweenConfig {
    public tween = true;
    public easeType = EaseType.QuadOut;
    public duration = 0.3;
    public delay = 0;

    /** @internal Set while a `GearDisplay` lock is held. */
    public _displayLockToken = 0;
    /** @internal The in-flight tween, or `null`. */
    public _tweener: GTweener | null = null;
}

/**
 * Slot indices `GObject.getGear` uses, in the order the editor numbers them.
 */
export const GearIndex = {
    Display: 0,
    XY: 1,
    Size: 2,
    Look: 3,
    Color: 4,
    Animation: 5,
    Text: 6,
    Icon: 7,
    Display2: 8,
    FontSize: 9,
} as const;

type GearCtor = new (owner: GObject) => GearBase;

/**
 * Gear classes by slot index, filled in by `registerGear`.
 *
 * A registry rather than a direct import list: `GearBase.create` is called from
 * `GObject`, and importing the subclasses here would close a cycle
 * (`GObject` → `GearBase` → `GearXY` → `GObject`) that ESM resolves too eagerly
 * to be safe.
 */
const Classes: Array<GearCtor | undefined> = [];

export function registerGear(index: number, ctor: GearCtor): void {
    Classes[index] = ctor;
}

/**
 * Base of the ten "gears" — the editor's mechanism for driving a property from
 * a controller's selected page.
 *
 * Each subclass stores one value per page and applies the current page's value
 * when the controller changes, optionally tweening to it.
 */
export class GearBase {
    /** When true, page changes snap instead of tweening. */
    public static disableAllTweenEffect = false;

    protected _owner: GObject;
    protected _controller: Controller | null = null;
    protected _tweenConfig: GearTweenConfig | null = null;

    public static create(owner: GObject, index: number): GearBase {
        const ctor = Classes[index];
        if (!ctor) {
            throw new Error(
                `fairygui: no gear registered for index ${index}. ` +
                'Import the core entry point, which registers all ten gear types.',
            );
        }
        return new ctor(owner);
    }

    public constructor(owner: GObject) {
        this._owner = owner;
    }

    public dispose(): void {
        if (this._tweenConfig?._tweener) {
            this._tweenConfig._tweener.kill();
            this._tweenConfig._tweener = null;
        }
    }

    public get controller(): Controller | null {
        return this._controller;
    }

    public set controller(val: Controller | null) {
        if (val === this._controller)
            return;
        this._controller = val;
        if (this._controller)
            this.init();
    }

    public get tweenConfig(): GearTweenConfig {
        this._tweenConfig ??= new GearTweenConfig();
        return this._tweenConfig;
    }

    public setup(buffer: ByteBuffer): void {
        this._controller = this._owner.parent?.getControllerAt(buffer.readShort()) ?? null;
        this.init();

        const cnt = buffer.readShort();
        this.readPages(buffer, cnt);

        if (buffer.readBool()) {
            this._tweenConfig = new GearTweenConfig();
            this._tweenConfig.easeType = buffer.readByte();
            this._tweenConfig.duration = buffer.readFloat();
            this._tweenConfig.delay = buffer.readFloat();
        }

        if (buffer.version >= 2)
            this.readExtra(buffer, cnt);
    }

    /**
     * Decodes the per-page payload.
     *
     * The default reads a value per named page plus an optional entry for
     * "no page selected". `GearDisplay` and `GearDisplay2` override this to read
     * a plain list of page names instead.
     */
    protected readPages(buffer: ByteBuffer, cnt: number): void {
        for (let i = 0; i < cnt; i++) {
            const page = buffer.readS();
            if (page == null)
                continue;
            this.addStatus(page, buffer);
        }

        if (buffer.readBool())
            this.addStatus(null, buffer);
    }

    /** Decodes payload only present in package format v2+. */
    protected readExtra(_buffer: ByteBuffer, _cnt: number): void {
    }

    /** Records the value for one page. Subclasses must implement. */
    protected addStatus(_pageId: string | null, _buffer: ByteBuffer): void {
    }

    /** Seeds internal state when the controller is (re)assigned. */
    protected init(): void {
    }

    /** Pushes the current page's value onto the owner, tweening if configured. */
    public apply(): void {
    }

    /** Records the owner's current values as belonging to the active page. */
    public updateState(): void {
    }

    /** Shifts every stored position by a delta, after a layout change. */
    public updateFromRelations(_dx: number, _dy: number): void {
    }
}
