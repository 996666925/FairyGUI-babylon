import { GObject } from './GObject.js';
import { ObjectPropID } from './FieldTypes.js';
import {
    getRenderFactory,
    type IImageObject,
    type IRenderObject,
    type SpriteTrim,
} from './render/IRenderObject.js';

import type { Color } from './utils/Color.js';
import type { Rect } from './utils/Geometry.js';
import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { Frame, PackageItem } from './PackageItem.js';

/** What a decoded frame needs in order to be drawn. */
export interface ResolvedFrame {
    /** Backend texture handle, as `IImageObject.setSprite` wants it. */
    texture: unknown;
    /** Atlas region to sample, or `null` for the whole texture. */
    rect: Rect | null;
    rotated: boolean;
    /** Where that region sat in the untrimmed frame, when the editor trimmed it. */
    trim?: SpriteTrim | null;
}

/**
 * Recreates Laya's `Texture.create(..., offsetX, offsetY, sourceWidth,
 * sourceHeight)` frame canvas. MovieClip frame records describe where the
 * atlas pixels sit inside the clip's full logical canvas; treating the atlas
 * rect as the canvas makes trimmed frames jump and change size while playing.
 */
function movieClipFrameTrim(frame: Frame, width: number, height: number): SpriteTrim | null {
    const rect = frame.rect;
    if (rect.x === 0 && rect.y === 0 && rect.width === width && rect.height === height)
        return null;

    return {
        x: rect.x,
        y: rect.y,
        originalWidth: width,
        originalHeight: height,
    };
}

/**
 * Turns a `PackageItem.Frame` into something drawable.
 *
 * The reference baked a `cc.SpriteFrame` into every frame while parsing the
 * package, because `UIPackage` was the layer that owned assets. Here the core
 * only knows sprite ids, so resolution happens on demand, at the point of
 * drawing, and is the owner's job.
 */
export type FrameResolver = (frame: Frame) => ResolvedFrame | null;

/**
 * The frame-advance state machine behind `GMovieClip` and `GLoader`.
 *
 * The reference kept this in `display/MovieClip.ts` as a `cc.Component` that
 * extended `Image`, so both widgets could mount it on a node. The core has no
 * component system, so it is a plain class over an `IImageObject` instead —
 * same fields, same algorithm, same quirks.
 *
 * Time is pushed in through `update(dt)`; nothing here reads a clock. The
 * reference's `update` was driven by the engine's per-frame tick, which this
 * port replaces with `GObject.onUpdate(dt)`.
 */
export class MovieClip {
    /** Seconds each frame is held for, before its own `addDelay`. */
    public interval = 0;
    /** Whether playback ping-pongs instead of looping. */
    public swing = false;
    /** Extra hold on the first frame of every loop past the first. */
    public repeatDelay = 0;
    public timeScale = 1;
    /** Set by the owner; without it frames draw as bare rects. */
    public frameResolver: FrameResolver | null = null;

    private _content: IImageObject;
    private _playing = true;
    private _frameCount = 0;
    private _frames: Frame[] | null = null;
    private _frame = 0;
    private _start = 0;
    private _end = 0;
    private _times = 0;
    private _endAt = 0;
    /** `0` none, `1` next loop, `2` ending, `3` ended. */
    private _status = 0;
    private _callback: (() => void) | null = null;
    private _callbackObj: unknown = null;
    private _smoothing = true;

    /** Seconds accumulated towards the current frame's duration. */
    private _frameElapsed = 0;
    private _reversed = false;
    private _repeatedCount = 0;

    public constructor(content: IImageObject) {
        this._content = content;
    }

    public get frames(): Frame[] | null {
        return this._frames;
    }

    public set frames(value: Frame[] | null) {
        this._frames = value;
        if (this._frames) {
            this._frameCount = this._frames.length;

            if (this._end === -1 || this._end > this._frameCount - 1)
                this._end = this._frameCount - 1;
            if (this._endAt === -1 || this._endAt > this._frameCount - 1)
                this._endAt = this._frameCount - 1;

            if (this._frame < 0 || this._frame > this._frameCount - 1)
                this._frame = this._frameCount - 1;

            // The reference forced the sprite back to `Type.SIMPLE` here, which
            // also switches nine-slicing and tiling off.
            this._content.scale9Grid = null;
            this._content.scaleByTile = false;

            this.drawFrame();

            this._frameElapsed = 0;
            this._repeatedCount = 0;
            this._reversed = false;
        } else {
            this._frameCount = 0;
        }
    }

    public get frameCount(): number {
        return this._frameCount;
    }

    public get frame(): number {
        return this._frame;
    }

    public set frame(value: number) {
        if (this._frame !== value) {
            if (this._frames && value >= this._frameCount)
                value = this._frameCount - 1;

            this._frame = value;
            this._frameElapsed = 0;
            this.drawFrame();
        }
    }

    public get playing(): boolean {
        return this._playing;
    }

    public set playing(value: boolean) {
        if (this._playing !== value)
            this._playing = value;
    }

    public get smoothing(): boolean {
        return this._smoothing;
    }

    public set smoothing(value: boolean) {
        this._smoothing = value;
    }

    public rewind(): void {
        this._frame = 0;
        this._frameElapsed = 0;
        this._reversed = false;
        this._repeatedCount = 0;

        this.drawFrame();
    }

    /** Copies clip position from another clip, without touching play state. */
    public syncStatus(anotherMc: MovieClip): void {
        this._frame = anotherMc._frame;
        this._frameElapsed = anotherMc._frameElapsed;
        this._reversed = anotherMc._reversed;
        this._repeatedCount = anotherMc._repeatedCount;

        this.drawFrame();
    }

    /**
     * Skips the clip forward by `timeInSeconds`, in one call.
     *
     * Used by `GMovieClip.advance` and by the `DeltaTime` property slot, where
     * the caller wants to jump rather than to tick. Whole rounds are detected by
     * watching for the frame and direction returning to where they started, and
     * are skipped in a single subtraction.
     */
    public advance(timeInSeconds: number): void {
        if (!this._frames || this._frameCount === 0)
            return;

        const beginFrame = this._frame;
        const beginReversed = this._reversed;
        const backupTime = timeInSeconds;

        while (true) {
            let tt = this.interval + this._frames[this._frame].addDelay;
            if (this._frame === 0 && this._repeatedCount > 0)
                tt += this.repeatDelay;

            if (tt <= 0) {
                // A clip whose frames are all zero-length. The reference
                // subtracted zero forever and divided by a zero round time; it
                // could only hang, so this stops instead.
                this._frameElapsed = 0;
                break;
            }

            if (timeInSeconds < tt) {
                this._frameElapsed = 0;
                break;
            }

            timeInSeconds -= tt;

            this.stepFrame();

            if (this._frame === beginFrame && this._reversed === beginReversed) { // a full round
                const roundTime = backupTime - timeInSeconds;
                timeInSeconds -= Math.floor(timeInSeconds / roundTime) * roundTime;
            }
        }

        this.drawFrame();
    }

    /** Advances one frame in the current direction, handling swing. */
    private stepFrame(): void {
        if (this.swing) {
            if (this._reversed) {
                this._frame--;
                if (this._frame <= 0) {
                    this._frame = 0;
                    this._repeatedCount++;
                    this._reversed = !this._reversed;
                }
            } else {
                this._frame++;
                if (this._frame > this._frameCount - 1) {
                    this._frame = Math.max(0, this._frameCount - 2);
                    this._repeatedCount++;
                    this._reversed = !this._reversed;
                }
            }
        } else {
            this._frame++;
            if (this._frame > this._frameCount - 1) {
                this._frame = 0;
                this._repeatedCount++;
            }
        }
    }

    /**
     * Plays frames `start`…`end`, `times` times (`0` loops forever), then
     * settles on `endAt` and calls back. Any argument left out takes its
     * default: `0`, `-1` (the last frame), `0` (forever), `-1` (same as `end`).
     */
    public setPlaySettings(
        start?: number, end?: number, times?: number, endAt?: number,
        endCallback?: (() => void) | null, callbackObj?: unknown,
    ): void {
        if (start === undefined)
            start = 0;
        if (end === undefined)
            end = -1;
        if (times === undefined)
            times = 0;
        if (endAt === undefined)
            endAt = -1;

        this._start = start;
        this._end = end;
        if (this._end === -1 || this._end > this._frameCount - 1)
            this._end = this._frameCount - 1;
        this._times = times;
        this._endAt = endAt;
        if (this._endAt === -1)
            this._endAt = this._end;
        this._status = 0;
        this._callback = endCallback ?? null;
        this._callbackObj = callbackObj;

        this.frame = start;
    }

    /**
     * Advances the clip by one tick.
     *
     * A render tick can be longer than one movie-clip frame (for example after
     * a tab was backgrounded). Consume every elapsed frame here and retain the
     * remainder for the next tick. Dropping that remainder makes the next
     * frame start early and is visible as uneven playback when the render loop
     * recovers.
     */
    public update(dt: number): void {
        if (!this._playing || this._frameCount === 0 || this._status === 3 || !this._frames)
            return;

        if (this.timeScale !== 1)
            dt *= this.timeScale;

        // A negative or non-finite delta cannot advance a clip. In particular,
        // guarding Infinity keeps malformed host timing from spinning below.
        if (!Number.isFinite(dt) || dt <= 0)
            return;

        this._frameElapsed += dt;

        let frameChanged = false;
        // Protect the render loop from pathological input while still allowing
        // a normal long frame to catch up across many animation frames.
        let steps = 0;
        while (steps++ < 10000) {
            let tt = this.interval + this._frames[this._frame].addDelay;
            if (this._frame === 0 && this._repeatedCount > 0)
                tt += this.repeatDelay;

            // A clip with no positive duration cannot make progress. This also
            // prevents a zero-duration clip from becoming an infinite loop.
            if (!(tt > 0)) {
                this._frameElapsed = 0;
                break;
            }
            if (this._frameElapsed < tt)
                break;

            this._frameElapsed -= tt;
            this.stepFrame();
            frameChanged = true;

            if (this._status === 1) { // new loop
                this._frame = this._start;
                this._frameElapsed = 0;
                this._status = 0;
            } else if (this._status === 2) { // ending
                this._frame = this._endAt;
                this._frameElapsed = 0;
                this._status = 3; // ended

                this.fireEndCallback();
                break;
            } else if (this._frame === this._end) {
                if (this._times > 0) {
                    this._times--;
                    if (this._times === 0)
                        this._status = 2; // ending
                    else
                        this._status = 1; // new loop
                } else if (this._start !== 0) {
                    this._status = 1; // new loop
                }
            }
        }

        if (frameChanged)
            this.drawFrame();
    }

    /** Runs and clears the end-of-playback callback, exactly once. */
    private fireEndCallback(): void {
        if (this._callback != null) {
            const callback = this._callback;
            const caller = this._callbackObj;
            this._callback = null;
            this._callbackObj = null;
            callback.call(caller);
        }
    }

    private drawFrame(): void {
        if (this._frameCount > 0 && this._frames && this._frame < this._frames.length) {
            const frame = this._frames[this._frame];
            const resolved = this.frameResolver ? this.frameResolver(frame) : null;

            if (resolved)
                this._content.setSprite(resolved.texture, resolved.rect, resolved.rotated, resolved.trim ?? null);
            else
                // Unresolvable sprite: the reference left the frame with no
                // texture at all, which draws nothing. Falling back to the
                // frame's own rect at least keeps the frame's geometry, so a
                // missing atlas region is visible rather than silent.
                this._content.setSprite(null, frame.rect, false);
        }
    }
}

/**
 * An image sequence, drawn frame by frame from a package's atlas.
 *
 * Built on `IImageObject` rather than `ITextObject`: each frame is an atlas
 * region, and the timing comes from the item's `interval`/`swing`/`repeatDelay`
 * plus each frame's own `addDelay`. Frames are advanced by `onUpdate(dt)`,
 * which the root drives — nothing consults a wall clock.
 */
export class GMovieClip extends GObject {
    /** The drawing node. Same object as `node`, narrowed. */
    public _content: IImageObject;

    private _mc: MovieClip;

    public constructor() {
        super();

        this._content = this._node as IImageObject;
        this._touchDisabled = true;

        this._mc = new MovieClip(this._content);
        this._mc.setPlaySettings();
    }

    protected createDisplayObject(): IRenderObject {
        return getRenderFactory().createImage();
    }

    public get color(): Color {
        return this._content.color;
    }

    public set color(value: Color) {
        this._content.color = value;
        this.updateGear(4);
    }

    public get playing(): boolean {
        return this._mc.playing;
    }

    public set playing(value: boolean) {
        if (this._mc.playing !== value) {
            this._mc.playing = value;
            this.updateGear(5);
        }
    }

    public get frame(): number {
        return this._mc.frame;
    }

    public set frame(value: number) {
        if (this._mc.frame !== value) {
            this._mc.frame = value;
            this.updateGear(5);
        }
    }

    public get timeScale(): number {
        return this._mc.timeScale;
    }

    public set timeScale(value: number) {
        this._mc.timeScale = value;
    }

    public rewind(): void {
        this._mc.rewind();
    }

    public syncStatus(anotherMc: GMovieClip): void {
        this._mc.syncStatus(anotherMc._mc);
    }

    public advance(timeInSeconds: number): void {
        this._mc.advance(timeInSeconds);
    }

    /**
     * Plays frames `start`…`end`, `times` times (`0` loops forever), then
     * settles on `endAt` (`-1` means `end`) and calls `endCallback`.
     */
    public setPlaySettings(
        start?: number, end?: number, times?: number, endAt?: number,
        endCallback?: (() => void) | null, callbackObj?: unknown,
    ): void {
        this._mc.setPlaySettings(start, end, times, endAt, endCallback, callbackObj);
    }

    /** Driven by the root; the reference's clip was ticked by the engine. */
    public onUpdate(dt: number): void {
        this._mc.update(dt);
    }

    protected handleGrayedChanged(): void {
        this._content.grayed = this._grayed;
    }

    protected handleSizeChanged(): void {
        super.handleSizeChanged();
        // The reference also re-asserted `sizeMode = CUSTOM` here, which is a
        // Cocos sprite-mode side effect with no analogue in this seam: the
        // content box is set by `super.handleSizeChanged()` alone.
    }

    public getProp(index: number): unknown {
        switch (index) {
            case ObjectPropID.Color:
                return this.color;
            case ObjectPropID.Playing:
                return this.playing;
            case ObjectPropID.Frame:
                return this.frame;
            case ObjectPropID.TimeScale:
                return this.timeScale;
            default:
                return super.getProp(index);
        }
    }

    public setProp(index: number, value: unknown): void {
        switch (index) {
            case ObjectPropID.Color:
                this.color = value as Color;
                break;
            case ObjectPropID.Playing:
                this.playing = value as boolean;
                break;
            case ObjectPropID.Frame:
                this.frame = value as number;
                break;
            case ObjectPropID.TimeScale:
                this.timeScale = value as number;
                break;
            case ObjectPropID.DeltaTime:
                this.advance(value as number);
                break;
            default:
                super.setProp(index, value);
                break;
        }
    }

    public constructFromResource(): void {
        const contentItem = this.packageItem!.getBranch();
        this.sourceWidth = contentItem.width;
        this.sourceHeight = contentItem.height;
        this.initWidth = this.sourceWidth;
        this.initHeight = this.sourceHeight;

        this.setSize(this.sourceWidth, this.sourceHeight);

        this.bindMovieClip(contentItem.getHighResolution());
    }

    /** Points the clip at a movie-clip item's timing and frames. */
    private bindMovieClip(resItem: PackageItem): void {
        const owner = resItem.owner;

        // The resolver must be in place before `frames` is assigned, because
        // that assignment draws the first frame.
        this._mc.frameResolver = (frame: Frame): ResolvedFrame | null => {
            if (frame.spriteId == null)
                return null;
            const sprite = owner.getSprite(frame.spriteId);
            if (!sprite)
                return null;
            return {
                texture: owner.getItemAsset(sprite.atlas),
                rect: sprite.rect,
                rotated: sprite.rotated ?? false,
                // Laya places the frame texture at frame.rect.x/y inside the
                // MovieClip's item-sized canvas. Do not use spriteTrim here:
                // that metadata belongs to standalone image layout and is not
                // part of Laya's MovieClip frame construction.
                trim: movieClipFrameTrim(frame, resItem.width, resItem.height),
            };
        };

        this._mc.interval = resItem.interval ?? 0;
        this._mc.swing = resItem.swing ?? false;
        this._mc.repeatDelay = resItem.repeatDelay ?? 0;
        this._mc.smoothing = resItem.smoothing ?? true;
        this._mc.frames = resItem.frames ?? null;
    }

    public setup_beforeAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_beforeAdd(buffer, beginPos);

        buffer.seek(beginPos, 5);

        if (buffer.readBool())
            this.color = buffer.readColor();
        buffer.readByte(); // flip — stored but never used by the reference
        // Assigned on the clip rather than through `frame`/`playing`, so that
        // construction does not trip a gear update.
        this._mc.frame = buffer.readInt();
        this._mc.playing = buffer.readBool();
    }
}
