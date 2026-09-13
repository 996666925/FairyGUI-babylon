import { afterEach, beforeEach, describe, expect, test } from '@rstest/core';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';

import {
    AlignType, AutoSizeType, FillMethod, FillOrigin, FlipType, PackageItemType, VertAlignType,
} from '../src/core/FieldTypes.js';
import { Color } from '../src/core/utils/Color.js';
import { Rect } from '../src/core/utils/Geometry.js';
import { UIPackage, setAssetResolver } from '../src/core/UIPackage.js';
import { readFixture } from './helpers/fixtures.js';

import { Mat2D } from '../src/babylon/Mat2D.js';
import { ClipStack, MAX_CLIP_RECTS } from '../src/babylon/ClipRects.js';
import {
    fillPolygon,
    GeometryBuilder,
    nineSliceBorders,
    nineSliceRegions,
    signedArea,
    SpriteMapping,
    tileRegions,
    triangulatePolygon,
} from '../src/babylon/GeometryBuilder.js';
import {
    layoutText,
    lineOffsetX,
    lineOffsetY,
    stripMarkup,
    type Canvas2DContextLike,
    type CanvasLike,
    type ITextMetricsProvider,
    type TextStyle,
} from '../src/babylon/TextLayout.js';
import { BabImageObject } from '../src/babylon/BabImageObject.js';
import { BabTextObject } from '../src/babylon/BabTextObject.js';
import { closeNativeInput } from '../src/babylon/TextInput.js';
import { BabylonRenderer, createBabylonRenderer } from '../src/babylon/BabylonRenderer.js';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/** A metrics provider with known round numbers: 10px per character, 20px lines. */
class StubMetrics implements ITextMetricsProvider {
    public constructor(
        private readonly charWidth = 10,
        private readonly lineHeightPx = 20,
    ) {}

    public measure(text: string, _style: TextStyle): number {
        return text.length * this.charWidth;
    }

    public lineHeight(_style: TextStyle): number {
        return this.lineHeightPx;
    }
}

/** A canvas that records what was drawn on it, standing in for a real one. */
class StubCanvas implements CanvasLike {
    public width: number;
    public height: number;
    public calls: string[] = [];
    public texts: string[] = [];
    /** `fillStyle` of every fill, in call order — `fillText` and `fillRect` alike. */
    public fills: string[] = [];

    public constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
    }

    public getContext(): Canvas2DContextLike {
        return new StubContext(this) as unknown as Canvas2DContextLike;
    }
}

/** A canvas whose font reports an ascent, so a line can be placed by it. */
class AscentCanvas extends StubCanvas {
    public override getContext(): Canvas2DContextLike {
        const ctx = new StubContext(this);
        ctx.inkAscent = 12;
        ctx.inkDescent = 4;
        return ctx as unknown as Canvas2DContextLike;
    }
}

class TallDescentCanvas extends StubCanvas {
    public override getContext(): Canvas2DContextLike {
        const ctx = new StubContext(this);
        ctx.inkAscent = 18;
        ctx.inkDescent = 8;
        return ctx as unknown as Canvas2DContextLike;
    }
}

class StubContext {
    /** Reported as the measured ink's ascent when set; unset on a plain stub. */
    public inkAscent: number | undefined;
    public inkDescent: number | undefined;
    public font = '';
    public textAlign = '';
    public textBaseline = '';
    public fillStyle: unknown = '';
    public strokeStyle: unknown = '';
    public lineWidth = 1;
    public globalAlpha = 1;

    public constructor(private readonly canvas: StubCanvas) {}

    public save(): void { this.canvas.calls.push('save'); }
    public restore(): void { this.canvas.calls.push('restore'); }
    public scale(x: number, y: number): void { this.canvas.calls.push(`scale:${x},${y}`); }
    public translate(x: number, y: number): void { this.canvas.calls.push(`translate:${x},${y}`); }
    public clearRect(): void { this.canvas.calls.push('clearRect'); }
    public fillRect(): void {
        this.canvas.calls.push('fillRect');
        this.canvas.fills.push(String(this.fillStyle));
    }
    public strokeRect(): void { this.canvas.calls.push('strokeRect'); }
    public measureText(text: string): { width: number; actualBoundingBoxAscent?: number; actualBoundingBoxDescent?: number } {
        return this.inkAscent === undefined
            ? { width: text.length * 10 }
            : { width: text.length * 10, actualBoundingBoxAscent: this.inkAscent, actualBoundingBoxDescent: this.inkDescent ?? 4 };
    }

    public fillText(text: string, x: number, y: number): void {
        this.canvas.calls.push('fillText');
        this.canvas.texts.push(`${text}@${x.toFixed(1)},${y.toFixed(1)}`);
        this.canvas.fills.push(String(this.fillStyle));
    }
}

const NO_STROKE = new Color(0, 0, 0, 0);
const WHITE = new Color(255, 255, 255, 255);

function makeScene(): { engine: NullEngine; scene: Scene } {
    const engine = new NullEngine({
        renderWidth: 400,
        renderHeight: 300,
        textureSize: 256,
        deterministicLockstep: false,
        lockstepMaxSteps: 1,
    });
    return { engine, scene: new Scene(engine) };
}

/** UVs the mesh ended up with, in vertex order. */
function uvsOf(obj: BabImageObject): number[] {
    return Array.from(obj.babNode.getVerticesData(VertexBuffer.UVKind) ?? []);
}

/**
 * A stand-in for an atlas `Texture` that has not loaded yet.
 *
 * Its size is mutable so a test can play out the sequence that matters: geometry
 * is built against the placeholder, then the real dimensions arrive.
 */
class FakeAtlas {
    public width = 1;
    public height = 1;
    public ready = false;
    public readonly onLoadObservable = new Observable<BaseTexture>();

    public getSize(): { width: number; height: number } {
        return { width: this.width, height: this.height };
    }

    public getScene(): unknown {
        return null;
    }

    public getInternalTexture(): unknown {
        return {};
    }

    public isReady(): boolean {
        return this.ready;
    }
}

function makeRenderer(): BabylonRenderer {
    const { scene } = makeScene();
    return createBabylonRenderer({ scene, textMetrics: new StubMetrics() });
}

/**
 * A texture handle for `renderer`.
 *
 * The texture itself is the renderer's real 1×1 white one — `ShaderMaterial`
 * calls `isReady()` on every sampler it binds, so a hand-rolled stand-in would
 * fail inside Babylon rather than at the call site. Only the *size* matters for
 * the UV arithmetic, and that travels in the handle.
 */
function spriteHandle(renderer: BabylonRenderer, width = 256, height = 256): { texture: BaseTexture; width: number; height: number } {
    return { texture: renderer.whiteTexture, width, height };
}

/** Vertex positions the mesh ended up with, in node space. */
function positionsOf(obj: BabImageObject): number[] {
    return Array.from(obj.babNode.getVerticesData(VertexBuffer.PositionKind) ?? []);
}

/** Every quad `(x0,y0, x1,y1, x2,y2, x3,y3)` the geometry produced. */
function quadsOf(obj: BabImageObject): number[][] {
    const positions = positionsOf(obj);
    const quads: number[][] = [];
    for (let i = 0; i + 11 < positions.length; i += 12) {
        const quad: number[] = [];
        for (let v = 0; v < 4; v++)
            quad.push(positions[i + v * 3], positions[i + v * 3 + 1]);
        quads.push(quad);
    }
    return quads;
}

/** Winding sign of a triangle once the UI root has mirrored it, in world space. */
function worldArea(positions: number[], indices: number[], triangle: number): number {
    const i0 = indices[triangle * 3];
    const i1 = indices[triangle * 3 + 1];
    const i2 = indices[triangle * 3 + 2];
    // The root flips y, so world = (x, -y).
    return signedArea(
        positions[i0 * 3], -positions[i0 * 3 + 1],
        positions[i1 * 3], -positions[i1 * 3 + 1],
        positions[i2 * 3], -positions[i2 * 3 + 1],
    );
}

// ---------------------------------------------------------------------------
// transform math
// ---------------------------------------------------------------------------

describe('BabRenderObject transforms', () => {
    test('a child of a scaled, translated parent lands where arithmetic says', () => {
        const renderer = makeRenderer();
        const parent = renderer.createObject();
        const child = renderer.createObject();
        renderer.attachToStage(parent);
        parent.addChild(child);
        parent.setContentSize(100, 100);
        child.setContentSize(40, 20);

        parent.setPosition(10, 20);
        child.setPosition(5, 5);
        child.setScale(2, 2);

        // child local (1,1) -> *2 -> (2,2) -> +(5,5) = (7,7) -> +(10,20) = (17,27)
        const p = child.localToGlobal(1, 1);
        expect(p.x).toBeCloseTo(17, 6);
        expect(p.y).toBeCloseTo(27, 6);
    });

    test('nested parents compose position, scale and rotation', () => {
        const renderer = makeRenderer();
        const a = renderer.createObject();
        const b = renderer.createObject();
        renderer.attachToStage(a);
        a.addChild(b);
        a.setContentSize(100, 100);
        b.setContentSize(10, 10);

        a.setPosition(10, 20);
        a.angle = 90;
        a.setScale(2, 3);
        b.setPosition(5, 5);
        b.setScale(2, 1);

        // b: local (1,1) -> S(2,1) -> (2,1) -> +(5,5) = (7,6)
        // a: S(2,3) -> (14,18); R(90° clockwise in y-down) maps (x,y) -> (-y,x)
        //    -> (-18,14); +(10,20) -> (-8,34)
        const p = b.localToGlobal(1, 1);
        expect(p.x).toBeCloseTo(-8, 6);
        expect(p.y).toBeCloseTo(34, 6);
    });

    test('a pivot puts the rotation origin at the node position', () => {
        const renderer = makeRenderer();
        const obj = renderer.createObject();
        renderer.attachToStage(obj);
        obj.setContentSize(40, 20);
        obj.setPivot(0.5, 0.5);
        obj.setPosition(100, 50);
        obj.angle = 90;

        // The pivot point (20,10) in content space is the node's own origin.
        const pivot = obj.localToGlobal(20, 10);
        expect(pivot.x).toBeCloseTo(100, 6);
        expect(pivot.y).toBeCloseTo(50, 6);

        // The content box's top-left is (-20,-10) from the pivot; rotated 90°
        // clockwise that is (10,-20); added to the pivot location.
        const corner = obj.localToGlobal(0, 0);
        expect(corner.x).toBeCloseTo(110, 6);
        expect(corner.y).toBeCloseTo(30, 6);
    });

    test('globalToLocal round-trips localToGlobal', () => {
        const renderer = makeRenderer();
        const a = renderer.createObject();
        const b = renderer.createObject();
        renderer.attachToStage(a);
        a.addChild(b);
        a.setContentSize(50, 50);
        b.setContentSize(50, 50);
        a.setPosition(30, -12);
        a.angle = 37;
        a.setScale(1.5, 0.75);
        b.setPosition(4, 9);
        b.setScale(2, 2);

        const global = b.localToGlobal(3, 7);
        // b(3,7) -> *2 -> (6,14) -> +(4,9) = (10,23) in a's local space.
        expect(global.x).not.toBe(3);
        const back = b.globalToLocal(global.x, global.y);
        expect(back.x).toBeCloseTo(3, 4);
        expect(back.y).toBeCloseTo(7, 4);
    });

    test('the result is UI-root space, not Babylon world space', () => {
        const renderer = makeRenderer();
        const obj = renderer.createObject();
        renderer.attachToStage(obj);
        obj.setContentSize(10, 10);
        obj.setPosition(0, 50);

        // The contract has y growing downwards, so this stays positive...
        expect(obj.localToGlobal(0, 0).y).toBeCloseTo(50, 6);

        // ...while Babylon, being y-up, sees the mirror image of it.
        obj.babNode.computeWorldMatrix(true);
        const world = obj.babNode.getWorldMatrix().getTranslation();
        expect(world.x).toBeCloseTo(0, 6);
        expect(world.y).toBeCloseTo(-50, 6);
    });

    test('a positive angle rotates clockwise on screen', () => {
        const renderer = makeRenderer();
        const parent = renderer.createObject();
        const probe = renderer.createObject();
        renderer.attachToStage(parent);
        parent.addChild(probe);
        parent.setContentSize(100, 100);
        probe.setContentSize(1, 1);

        parent.angle = 90;
        probe.setPosition(1, 0);

        // Clockwise from "right" is "down", and down is +y in FairyGUI.
        const ui = probe.localToGlobal(0, 0);
        expect(ui.x).toBeCloseTo(0, 6);
        expect(ui.y).toBeCloseTo(1, 6);

        // The same conclusion through Babylon: the world position is the y flip
        // of the UI position, so it must be (0, -1).
        probe.babNode.computeWorldMatrix(true);
        const world = probe.babNode.getWorldMatrix().getTranslation();
        expect(world.x).toBeCloseTo(0, 6);
        expect(world.y).toBeCloseTo(-1, 6);
    });

    test('a pivot changes the mesh origin but not the reported matrix', () => {
        const renderer = makeRenderer();
        const obj = renderer.createImage();
        renderer.attachToStage(obj);
        obj.setSprite(spriteHandle(renderer), null, false);
        obj.setContentSize(20, 10);
        obj.setPivot(1, 1);
        obj.commitGeometry();

        // Pivot (1,1) of a 20x10 box is (20,10), so the top-left vertex of the
        // node-space quad sits at (-20,-10).
        const positions = positionsOf(obj);
        expect(Math.min(...positions.filter((_, i) => i % 3 === 0))).toBeCloseTo(-20, 6);
        expect(Math.min(...positions.filter((_, i) => i % 3 === 1))).toBeCloseTo(-10, 6);

        // The contract's local space is unchanged by the pivot offset: the
        // content-space point (0,0) still maps to the node position minus the
        // pivot under the object's own rotation.
        obj.setPosition(100, 100);
        const p = obj.localToGlobal(20, 10);
        expect(p.x).toBeCloseTo(100, 6);
        expect(p.y).toBeCloseTo(100, 6);
    });

    test('an invisible parent hides its children through the Babylon hierarchy', () => {
        const renderer = makeRenderer();
        const parent = renderer.createObject();
        const child = renderer.createObject();
        renderer.attachToStage(parent);
        parent.addChild(child);

        expect(child.babNode.isEnabled()).toBe(true);
        parent.visible = false;
        // `GObject._finalVisible` never consults the ancestors, so the backend
        // has to carry invisibility down: `setEnabled` disables the subtree.
        expect(child.babNode.isEnabled()).toBe(false);
        parent.visible = true;
        expect(child.babNode.isEnabled()).toBe(true);
    });

    test('Mat2D inverts consistently and survives a degenerate matrix', () => {
        const m = Mat2D.fromTRS(10, 20, 30, 2, 3, 4, 5);
        const x = m.transformX(7, 11);
        const y = m.transformY(7, 11);
        const inv = m.clone().invert();
        expect(inv.transformX(x, y)).toBeCloseTo(7, 6);
        expect(inv.transformY(x, y)).toBeCloseTo(11, 6);

        const flat = new Mat2D().set(0, 0, 0, 0, 5, 5).invert();
        expect(flat.a).toBe(1);
        expect(Number.isFinite(flat.tx)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// winding
// ---------------------------------------------------------------------------

describe('geometry winding under the y flip', () => {
    test('quads come out counter-clockwise once the root mirrors them', () => {
        const builder = new GeometryBuilder();
        builder.addQuad(0, 0, 10, 0, 10, 10, 0, 10, 0, 0, 1, 0, 1, 1, 0, 1);

        // Clockwise on screen, so the naive order would be (0,1,2)/(0,2,3).
        expect(builder.indices.slice(0, 6)).toEqual([0, 2, 1, 0, 3, 2]);

        // In world space (y negated) both triangles are counter-clockwise, which
        // is what Babylon treats as front-facing.
        expect(worldArea(builder.positions, builder.indices, 0)).toBeGreaterThan(0);
        expect(worldArea(builder.positions, builder.indices, 1)).toBeGreaterThan(0);
    });

    test('the naive winding would be back-facing, so the correction is load bearing', () => {
        const builder = new GeometryBuilder();
        for (const [x, y] of [[0, 0], [10, 0], [10, 10], [0, 10]])
            builder.addVertex(x, y, 0, 0);
        builder.indices.push(0, 1, 2, 0, 2, 3);
        expect(worldArea(builder.positions, builder.indices, 0)).toBeLessThan(0);
        expect(worldArea(builder.positions, builder.indices, 1)).toBeLessThan(0);
    });

    test('triangulation emits clockwise-in-UI triangles, which flip to front-facing', () => {
        const square = [0, 0, 10, 0, 10, 10, 0, 10];
        const indices: number[] = [];
        const count = triangulatePolygon(square, indices);

        expect(count).toBe(2);
        expect(indices.length).toBe(6);
        for (let t = 0; t < count; t++) {
            const a = indices[t * 3];
            const b = indices[t * 3 + 1];
            const c = indices[t * 3 + 2];
            expect(worldArea(
                [square[a * 2], square[a * 2 + 1], 0, square[b * 2], square[b * 2 + 1], 0, square[c * 2], square[c * 2 + 1], 0],
                [0, 1, 2],
                0,
            )).toBeGreaterThan(0);
        }
    });

    test('a counter-clockwise polygon is normalised rather than inverted', () => {
        const ccw = [0, 0, 0, 10, 10, 10, 10, 0];
        const indices: number[] = [];
        expect(triangulatePolygon(ccw, indices)).toBe(2);
        const cw = [0, 0, 10, 0, 10, 10, 0, 10];
        const other: number[] = [];
        expect(triangulatePolygon(cw, other)).toBe(2);
        // Both wind the same way, so neither ends up back-facing.
        expect(indices.length).toBe(other.length);
    });
});

// ---------------------------------------------------------------------------
// nine-slice and tiling
// ---------------------------------------------------------------------------

describe('nine-slice', () => {
    const grid = new Rect(10, 10, 20, 20);
    const regions = nineSliceRegions(200, 100, 40, 40, grid);
    const bySource = (x: number, y: number) => regions.find((r) => r.srcX === x && r.srcY === y);

    test('corners keep their source pixel size when the object grows', () => {
        for (const corner of [bySource(0, 0), bySource(30, 0), bySource(0, 30), bySource(30, 30)]) {
            expect(corner).toBeDefined();
            expect(corner!.srcW).toBe(10);
            expect(corner!.srcH).toBe(10);
            // Destination size equals source size: a corner is never stretched.
            expect(corner!.dstW).toBe(10);
            expect(corner!.dstH).toBe(10);
        }
    });

    test('edges stretch along one axis only', () => {
        const top = bySource(10, 0)!;
        expect(top.dstW).toBe(180); // 200 - 10 - 10
        expect(top.dstH).toBe(10);

        const left = bySource(0, 10)!;
        expect(left.dstW).toBe(10);
        expect(left.dstH).toBe(80); // 100 - 10 - 10
    });

    test('the centre stretches along both axes', () => {
        const centre = bySource(10, 10)!;
        expect(centre.srcW).toBe(20);
        expect(centre.srcH).toBe(20);
        expect(centre.dstW).toBe(180);
        expect(centre.dstH).toBe(80);
    });

    test('source rects never depend on the destination size', () => {
        const sources = (list: ReturnType<typeof nineSliceRegions>) =>
            list.map((r) => `${r.srcX},${r.srcY},${r.srcW},${r.srcH}`).join('|');
        expect(sources(nineSliceRegions(60, 60, 40, 40, grid)))
            .toBe(sources(nineSliceRegions(400, 400, 40, 40, grid)));
    });

    test('borders shrink proportionally when the destination is too small', () => {
        const borders = nineSliceBorders(15, 40, 40, 40, grid);
        expect(borders.left).toBeCloseTo(7.5, 6);
        expect(borders.right).toBeCloseTo(7.5, 6);
        expect(borders.top).toBe(10);
        expect(borders.bottom).toBe(10);
    });

    test('the corners reach the mesh at their source size', () => {
        const renderer = makeRenderer();
        const image = renderer.createImage();
        renderer.attachToStage(image);
        image.setSprite(spriteHandle(renderer), new Rect(0, 0, 40, 40), false);
        image.scale9Grid = grid;
        image.setContentSize(200, 100);
        image.commitGeometry();

        const quads = quadsOf(image);
        const corner = quads.find((q) => q[0] === 0 && q[1] === 0)!;
        expect(corner[2] - corner[0]).toBeCloseTo(10, 6);
        expect(corner[7] - corner[1]).toBeCloseTo(10, 6);

        const topRight = quads.find((q) => q[0] === 190 && q[1] === 0)!;
        expect(topRight[2] - topRight[0]).toBeCloseTo(10, 6);

        const centre = quads.find((q) => q[0] === 10 && q[1] === 10)!;
        expect(centre[2] - centre[0]).toBeCloseTo(180, 6);
        expect(centre[7] - centre[1]).toBeCloseTo(80, 6);
    });

    test('a scaled-up corner still samples only its own source texels', () => {
        const renderer = makeRenderer();
        const image = renderer.createImage();
        renderer.attachToStage(image);
        image.setSprite(spriteHandle(renderer, 256, 256), new Rect(0, 0, 40, 40), false);
        image.scale9Grid = grid;
        image.setContentSize(200, 100);
        image.commitGeometry();

        const uvs = Array.from(image.babNode.getVerticesData(VertexBuffer.UVKind)!);
        // The sprite is a 40px region of a 256px atlas, so its own UV span is
        // 0..40/256. The corner quad covers 0..10 of those 40 pixels.
        const spriteSpan = 40 / 256;
        expect(uvs[0]).toBeCloseTo(0, 6);
        expect(uvs[2]).toBeCloseTo(spriteSpan * 0.25, 6);
        expect(uvs[4]).toBeCloseTo(spriteSpan * 0.25, 6);
        expect(uvs[6]).toBeCloseTo(0, 6);
    });
});

describe('tiling', () => {
    test('a zero mask repeats the whole sprite across the whole box', () => {
        const regions = tileRegions(90, 60, 30, 30, null, 0);
        expect(regions.length).toBe(6); // round(90/30) * round(60/30)
        for (const r of regions) {
            expect(r.srcW).toBe(30);
            expect(r.srcH).toBe(30);
            expect(r.dstW).toBe(30);
            expect(r.dstH).toBe(30);
        }
    });

    test('tiles repeat at the source size and the last one is cut at the edge', () => {
        const regions = tileRegions(100, 50, 30, 30, null, 0);
        // Four across and two down, the last of each running past the block.
        expect(regions.length).toBe(8);

        const covered = regions.reduce((sum, r) => sum + r.dstW * r.dstH, 0);
        expect(covered).toBeCloseTo(100 * 50, 6);

        for (const r of regions) {
            // Never resampled: what is sampled is exactly what is drawn.
            expect(r.srcW).toBe(r.dstW);
            expect(r.srcH).toBe(r.dstH);
        }
    });

    test('a block smaller than one tile shows its corner, not a squeezed copy', () => {
        // A tiled progress bar's artwork is a strip wider than the bar itself.
        // Fitting it as one whole tile squashed the whole strip into the bar.
        const regions = tileRegions(20, 10, 90, 23, null, 0);
        expect(regions.length).toBe(1);
        expect([regions[0].srcW, regions[0].dstW]).toEqual([20, 20]);
        expect([regions[0].srcH, regions[0].dstH]).toEqual([10, 10]);
    });

    test('the tile mask selects which grid cells repeat', () => {
        const grid = new Rect(10, 10, 20, 20);
        // Bit 4 is the centre cell of the 3x3 grid. Its destination band is
        // 180x80 and its source cell is 20x20, so it repeats 9 x 4 times.
        const regions = tileRegions(200, 100, 40, 40, grid, 1 << 4);
        const centre = regions.filter((r) => r.srcX === 10 && r.srcY === 10);
        expect(centre.length).toBe(36);
        // Whole 20px cells: the band is an exact number of them.
        expect(centre.every((r) => Math.abs(r.srcW - 20) < 1e-6 && Math.abs(r.srcH - 20) < 1e-6),
            JSON.stringify(centre.filter((r) => Math.abs(r.srcW - 20) > 1e-6 || Math.abs(r.srcH - 20) > 1e-6)[0])).toBe(true);

        // The surviving border cells are still single, stretched regions.
        const right = regions.filter((r) => r.srcX === 30 && r.srcY === 0);
        expect(right.length).toBe(1);
        expect(right[0].dstW).toBe(10);

        // With no bits set the *whole sprite* tiles across the whole box instead.
        const whole = tileRegions(200, 100, 40, 40, grid, 0);
        expect(whole.length).toBe(5 * 3); // ceil(200/40) * ceil(100/40)
        // Never resampled: each tile draws exactly what it samples, and the
        // last row is cut at the edge of the box rather than squeezed to fit.
        expect(whole.every((r) => r.srcW === r.dstW && r.srcH === r.dstH)).toBe(true);
        expect(whole.filter((r) => r.dstH < 40).length, 'the cut row').toBe(5);
    });
});

// ---------------------------------------------------------------------------
// atlas UVs
// ---------------------------------------------------------------------------

describe('trimmed sprites', () => {
    test('a trimmed sprite is drawn inset by what was cut off it', () => {
        // The editor trims a sprite's transparent margins and keeps the offset
        // of the region that survived. An object's box is the size the image had
        // before the trim — the editor sets it from the whole image — so the art
        // belongs inset by the offset, not stretched across the box. Spreading it
        // both stretched the image and shifted it up and left.
        const renderer = makeRenderer();
        const image = renderer.createImage();
        renderer.attachToStage(image);
        image.setContentSize(40, 40);
        image.setSprite(spriteHandle(renderer, 256, 256), new Rect(2, 1, 37, 37), false, {
            x: 2, y: 1, originalWidth: 40, originalHeight: 40,
        });
        image.commitGeometry();

        const pos = positionsOf(image);
        const xs = pos.filter((_, i) => i % 3 === 0);
        const ys = pos.filter((_, i) => i % 3 === 1);
        expect([Math.min(...xs), Math.min(...ys)], 'top-left, at the offset').toEqual([2, 1]);
        expect([Math.max(...xs), Math.max(...ys)], "and the region's own size").toEqual([39, 38]);

        // The whole region is still sampled: the trim moves the quad, not the UVs.
        const uv = uvsOf(image);
        expect([uv[0], uv[1]]).toEqual([2 / 256, 1 / 256]);
        expect([uv[4], uv[5]]).toEqual([39 / 256, 38 / 256]);
    });

    test('an untrimmed sprite still fills its box', () => {
        const renderer = makeRenderer();
        const image = renderer.createImage();
        renderer.attachToStage(image);
        image.setContentSize(40, 40);
        image.setSprite(spriteHandle(renderer, 256, 256), new Rect(0, 0, 40, 40), false, {
            x: 0, y: 0, originalWidth: 40, originalHeight: 40,
        });
        image.commitGeometry();

        const pos = positionsOf(image);
        const xs = pos.filter((_, i) => i % 3 === 0);
        expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 40]);
    });
});

describe('atlas UVs', () => {
    test('a sub-rect maps to the expected normalised corners', () => {
        const mapping = new SpriteMapping().set(new Rect(32, 16, 64, 48), 256, 256, false);
        expect(mapping.u0).toBeCloseTo(0.125, 6);
        expect(mapping.v0).toBeCloseTo(0.0625, 6);
        expect(mapping.u1).toBeCloseTo(0.375, 6);
        expect(mapping.v1).toBeCloseTo(0.25, 6);
        expect(mapping.width).toBe(64);
        expect(mapping.height).toBe(48);
    });

    test('a null rect samples the whole texture', () => {
        const mapping = new SpriteMapping().set(null, 128, 64, false);
        expect([mapping.u0, mapping.v0, mapping.u1, mapping.v1]).toEqual([0, 0, 1, 1]);
    });

    test('a rotated region maps u with t and v backwards with s', () => {
        const mapping = new SpriteMapping().set(new Rect(0, 0, 64, 48), 256, 256, true);
        // The stored footprint is 64x48; displayed it is 48 wide, 64 tall.
        expect(mapping.width).toBe(48);
        expect(mapping.height).toBe(64);

        const out = { u: 0, v: 0 };
        mapping.uv(0, 0, out);
        expect([out.u, out.v]).toEqual([mapping.u0, mapping.v1]); // top-left
        mapping.uv(1, 0, out);
        expect([out.u, out.v]).toEqual([mapping.u0, mapping.v0]); // top-right
        mapping.uv(1, 1, out);
        expect([out.u, out.v]).toEqual([mapping.u1, mapping.v0]); // bottom-right
        mapping.uv(0, 1, out);
        expect([out.u, out.v]).toEqual([mapping.u1, mapping.v1]); // bottom-left
    });

    test('the centre of a rotated region is the centre of the region', () => {
        const plain = new SpriteMapping().set(new Rect(0, 0, 64, 64), 256, 256, false);
        const rotated = new SpriteMapping().set(new Rect(0, 0, 64, 64), 256, 256, true);
        const a = plain.uv(0.5, 0.5, { u: 0, v: 0 });
        const b = rotated.uv(0.5, 0.5, { u: 0, v: 0 });
        expect(b.u).toBeCloseTo(a.u, 6);
        expect(b.v).toBeCloseTo(a.v, 6);
    });

    test('a sub-rect reaches the mesh, and a flip mirrors only s', () => {
        const renderer = makeRenderer();
        const image = renderer.createImage();
        renderer.attachToStage(image);
        image.setSprite(spriteHandle(renderer, 256, 256), new Rect(64, 128, 64, 32), false);
        image.setContentSize(64, 32);
        image.commitGeometry();

        const uvs = Array.from(image.babNode.getVerticesData(VertexBuffer.UVKind)!);
        // top-left, top-right, bottom-right, bottom-left
        expect(uvs[0]).toBeCloseTo(64 / 256, 6);
        expect(uvs[1]).toBeCloseTo(128 / 256, 6);
        expect(uvs[2]).toBeCloseTo(128 / 256, 6);
        expect(uvs[3]).toBeCloseTo(128 / 256, 6);
        expect(uvs[5]).toBeCloseTo(160 / 256, 6);

        image.flip = FlipType.Horizontal;
        image.invalidateGeometry();
        image.commitGeometry();
        const flipped = Array.from(image.babNode.getVerticesData(VertexBuffer.UVKind)!);
        expect(flipped[0]).toBeCloseTo(128 / 256, 6);
        expect(flipped[1]).toBeCloseTo(128 / 256, 6);
        expect(flipped[5]).toBeCloseTo(160 / 256, 6); // v untouched
    });

    test('a vertical flip mirrors only t', () => {
        const renderer = makeRenderer();
        const image = renderer.createImage();
        renderer.attachToStage(image);
        image.setSprite(spriteHandle(renderer, 256, 256), new Rect(0, 0, 64, 64), false);
        image.setContentSize(64, 64);
        image.flip = FlipType.Vertical;
        image.commitGeometry();

        const uvs = Array.from(image.babNode.getVerticesData(VertexBuffer.UVKind)!);
        expect(uvs[0]).toBeCloseTo(0, 6);       // u untouched
        expect(uvs[1]).toBeCloseTo(0.25, 6);    // t mirrored
    });
});

// ---------------------------------------------------------------------------
// progress fills
// ---------------------------------------------------------------------------

describe('progress fills', () => {
    test('a fill redraws when its amount changes', () => {
        // A progress bar — the cooldown sample's radial one, say — writes
        // `fillAmount` on every frame it animates. The appearance properties are
        // baked into the vertices, so while they were plain fields the
        // assignment never reached the mesh: the value moved and the shape did
        // not, which reads as a progress that will not play.
        const renderer = makeRenderer();
        const image = renderer.createImage();
        renderer.attachToStage(image);
        image.setSprite(spriteHandle(renderer), new Rect(0, 0, 64, 64), false);
        image.setContentSize(64, 64);
        image.fillMethod = FillMethod.Radial360;
        image.fillOrigin = FillOrigin.Top;
        image.fillAmount = 0.25;
        image.commitGeometry();

        const quarter = positionsOf(image);
        expect(quarter.length, 'a quarter turn is drawn').toBeGreaterThan(0);

        image.fillAmount = 0.75;
        image.commitGeometry();

        expect(positionsOf(image), 'and the mesh follows the new amount').not.toEqual(quarter);
    });

    test('a horizontal fill from the left covers a fraction of the width', () => {
        expect(fillPolygon(FillMethod.Horizontal, FillOrigin.Left, true, 0.25))
            .toEqual([0, 0, 0.25, 0, 0.25, 1, 0, 1]);
    });

    test('a horizontal fill from the right grows leftwards', () => {
        const poly = fillPolygon(FillMethod.Horizontal, FillOrigin.Right, true, 0.25);
        expect(poly[0]).toBeCloseTo(0.75, 6);
        expect(poly[2]).toBeCloseTo(1, 6);
    });

    test('a vertical fill from the bottom grows upwards', () => {
        const poly = fillPolygon(FillMethod.Vertical, FillOrigin.Bottom, true, 0.5);
        const ys = [poly[1], poly[3], poly[5], poly[7]];
        expect(Math.min(...ys)).toBeCloseTo(0.5, 6);
        expect(Math.max(...ys)).toBeCloseTo(1, 6);
    });

    test('a full radial fill is the whole square', () => {
        const poly = fillPolygon(FillMethod.Radial360, FillOrigin.Top, true, 1);
        expect(poly.length).toBe(8);
        const xs = poly.filter((_, i) => i % 2 === 0);
        expect(Math.min(...xs)).toBeCloseTo(0, 6);
        expect(Math.max(...xs)).toBeCloseTo(1, 6);
    });

    test('a partial radial fill stays inside the unit square', () => {
        const poly = fillPolygon(FillMethod.Radial360, FillOrigin.Top, true, 0.25);
        expect(poly.length).toBeGreaterThanOrEqual(6);
        for (let i = 0; i < poly.length; i += 2) {
            expect(poly[i]).toBeGreaterThanOrEqual(-1e-6);
            expect(poly[i]).toBeLessThanOrEqual(1 + 1e-6);
            expect(poly[i + 1]).toBeGreaterThanOrEqual(-1e-6);
            expect(poly[i + 1]).toBeLessThanOrEqual(1 + 1e-6);
        }
    });

    test('a half-radial from the top covers only the top half', () => {
        const poly = fillPolygon(FillMethod.Radial180, FillOrigin.Top, true, 1);
        const ys = poly.filter((_, i) => i % 2 === 1);
        expect(Math.min(...ys)).toBeCloseTo(0, 6);
        expect(Math.max(...ys)).toBeGreaterThanOrEqual(0.5);
    });

    test('a zero amount fills nothing', () => {
        expect(fillPolygon(FillMethod.Horizontal, FillOrigin.Left, true, 0).length).toBe(0);
        expect(fillPolygon(FillMethod.Radial360, FillOrigin.Top, true, 0).length).toBe(0);
    });

    test('the filled shape reaches the mesh with the right extent', () => {
        const renderer = makeRenderer();
        const image = renderer.createImage();
        renderer.attachToStage(image);
        image.setSprite(spriteHandle(renderer, 64, 64), null, false);
        image.setContentSize(100, 100);
        image.fillMethod = FillMethod.Horizontal;
        image.fillOrigin = FillOrigin.Left;
        image.fillAmount = 0.5;
        image.commitGeometry();

        const positions = positionsOf(image);
        let maxX = 0;
        for (let i = 0; i < positions.length; i += 3)
            maxX = Math.max(maxX, positions[i]);
        expect(maxX).toBeCloseTo(50, 6);
    });
});

// ---------------------------------------------------------------------------
// text layout
// ---------------------------------------------------------------------------

describe('text layout', () => {
    const metrics = new StubMetrics(10, 20);
    const base = {
        style: { font: null, fontSize: 10, fontStyle: '' },
        align: AlignType.Left,
        verticalAlign: VertAlignType.Top,
        singleLine: false,
        letterSpacing: 0,
        leading: 0,
        wrapWidth: 0,
        autoSize: AutoSizeType.None,
        boxWidth: 0,
        boxHeight: 0,
    };

    test('wraps at the box width when auto-size is off', () => {
        const layout = layoutText({ ...base, text: 'abcdef', boxWidth: 30 }, metrics);
        expect(layout.lines.map((l) => l.text)).toEqual(['abc', 'def']);
        expect(layout.textWidth).toBe(30);
        expect(layout.textHeight).toBe(40);
    });

    test('wraps at whitespace in preference to mid-word', () => {
        const layout = layoutText({ ...base, text: 'aa bb cc', boxWidth: 70 }, metrics);
        expect(layout.lines.map((l) => l.text)).toEqual(['aa bb', 'cc']);
        expect(layout.lines[0].width).toBe(50);
        expect(layout.lines[1].width).toBe(20);
    });

    test('a single word wider than the wrap width is broken by character', () => {
        const layout = layoutText({ ...base, text: 'aaaaaaaa', boxWidth: 30 }, metrics);
        expect(layout.lines.map((l) => l.text)).toEqual(['aaa', 'aaa', 'aa']);
    });

    test('a wrapped line reports the offset it started at', () => {
        const layout = layoutText({ ...base, text: 'aa bb cc', boxWidth: 70 }, metrics);
        expect(layout.lines[0].start).toBe(0);
        expect(layout.lines[1].start).toBe(6);
    });

    test('auto-size Both hugs the text', () => {
        const layout = layoutText({ ...base, text: 'abcdef', autoSize: AutoSizeType.Both }, metrics);
        expect(layout.lines.length).toBe(1);
        expect(layout.boxWidth).toBe(60);
        expect(layout.boxHeight).toBe(20);
    });

    test('auto-size Height keeps the width and fits the height', () => {
        const layout = layoutText({
            ...base, text: 'abcdef', autoSize: AutoSizeType.Height, wrapWidth: 30, boxWidth: 30, boxHeight: 500,
        }, metrics);
        expect(layout.wrapWidth).toBe(30);
        expect(layout.boxWidth).toBe(30);
        expect(layout.boxHeight).toBe(40);
    });

    test('auto-size None leaves the declared box alone', () => {
        const layout = layoutText({
            ...base, text: 'abcdef', autoSize: AutoSizeType.None, boxWidth: 30, boxHeight: 500,
        }, metrics);
        expect(layout.boxWidth).toBe(30);
        expect(layout.boxHeight).toBe(500);
    });

    test('auto-size Shrink behaves like Both', () => {
        const both = layoutText({ ...base, text: 'abcdef', autoSize: AutoSizeType.Both }, metrics);
        const shrink = layoutText({ ...base, text: 'abcdef', autoSize: AutoSizeType.Shrink }, metrics);
        expect(shrink.boxWidth).toBe(both.boxWidth);
        expect(shrink.boxHeight).toBe(both.boxHeight);
    });

    test('an explicit wrap width overrides auto-size Both', () => {
        const layout = layoutText({ ...base, text: 'abcdef', autoSize: AutoSizeType.Both, wrapWidth: 30 }, metrics);
        expect(layout.lines.length).toBe(2);
        expect(layout.boxWidth).toBe(30);
    });

    test('single-line mode never wraps', () => {
        const layout = layoutText({
            ...base, text: 'abcdef', singleLine: true, autoSize: AutoSizeType.Height, boxWidth: 30,
        }, metrics);
        expect(layout.lines.length).toBe(1);
        expect(layout.textWidth).toBe(60);
    });

    test('leading and line height add up', () => {
        const layout = layoutText({ ...base, text: 'abcdef', boxWidth: 30, leading: 5 }, metrics);
        expect(layout.lineHeight).toBe(20);
        expect(layout.lineStep).toBe(25);
        // Two whole line boxes — the leading is inside each of them, not a gap
        // dropped between. The reference's line height was `fontSize + leading`
        // and it sized the block to a whole number of those.
        expect(layout.textHeight).toBe(50);
    });

    test('letter spacing is included in the measured width', () => {
        const layout = layoutText({ ...base, text: 'abcd', letterSpacing: 2, autoSize: AutoSizeType.Both }, metrics);
        expect(layout.textWidth).toBe(46); // 4*10 + 3*2
    });

    test('alignment offsets are computed from the box', () => {
        expect(lineOffsetX(40, 100, AlignType.Left)).toBe(0);
        expect(lineOffsetX(40, 100, AlignType.Center)).toBe(30);
        expect(lineOffsetX(40, 100, AlignType.Right)).toBe(60);
        expect(lineOffsetY(40, 100, VertAlignType.Top)).toBe(0);
        expect(lineOffsetY(40, 100, VertAlignType.Middle)).toBe(30);
        expect(lineOffsetY(40, 100, VertAlignType.Bottom)).toBe(60);
    });

    test('markup is stripped and links recorded', () => {
        const stripped = stripMarkup('Hi <a href="ui://x">there</a> and <b>bold</b>');
        expect(stripped.text).toBe('Hi there and bold');
        expect(stripped.links.length).toBe(1);
        expect(stripped.links[0].href).toBe('ui://x');
        expect(stripped.text.substring(stripped.links[0].start, stripped.links[0].end)).toBe('there');
    });

    test('<br> becomes a newline the layout honours', () => {
        const stripped = stripMarkup('a<br>b');
        expect(stripped.text).toBe('a\nb');
        const layout = layoutText({ ...base, text: stripped.text, autoSize: AutoSizeType.Both }, metrics);
        expect(layout.lines.length).toBe(2);
        expect(layout.boxHeight).toBe(40);
    });

    test('text objects measure before anything is committed', () => {
        const renderer = makeRenderer();
        const text = renderer.createText();
        text.fontSize = 10;
        text.text = 'abcdef';
        text.autoSize = AutoSizeType.Both;

        // 10px per character from the stub, with no canvas, texture or size set.
        // The height is the stub's 20px line box plus the object's default 3px
        // leading — the box a line occupies, not the ink inside it.
        expect(text.measureTextWidth()).toBe(60);
        expect(text.measureTextHeight()).toBe(23);
        expect(text.contentWidth).toBe(0);
        expect(text.getTexture()).toBeNull();
    });

    test('a text object reports a wrapped height for its declared width', () => {
        const renderer = makeRenderer();
        const text = renderer.createText();
        text.fontSize = 10;
        text.text = 'abcdef';
        text.autoSize = AutoSizeType.Height;

        // The stub reports a 20px line box, and `leading` is part of the box a
        // line occupies rather than a gap dropped between two of them.
        text.leading = 0;
        text.setContentSize(30, 0);
        expect(text.measureTextHeight()).toBe(40); // wrapped to 2 lines

        text.leading = 3;
        expect(text.measureTextHeight()).toBe(46); // 2 * (20 + 3)
    });

    test('a link can be located by point', () => {
        const renderer = makeRenderer();
        const text = renderer.createText() as BabTextObject;
        text.fontSize = 10;
        text.rich = true;
        text.text = 'ab<a href="ui://go">cd</a>ef';
        text.autoSize = AutoSizeType.Both;
        text.setContentSize(60, 20);

        expect(text.links.length).toBe(1);
        expect(text.hitTestLink(5, 10)).toBeNull();   // 'a'
        expect(text.hitTestLink(25, 10)).toBe('ui://go'); // 'c'
        expect(text.hitTestLink(35, 10)).toBe('ui://go'); // 'd'
        expect(text.hitTestLink(45, 10)).toBeNull();  // 'e'

        let fired = '';
        text.onLinkClick = (href) => { fired = href; };
        expect(text.clickLink(25, 10)).toBe(true);
        expect(fired).toBe('ui://go');
        expect(text.clickLink(5, 10)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// text rasterisation
// ---------------------------------------------------------------------------

describe('text rasterisation', () => {
    test('a DynamicTexture is created behind the seam and sized by textureScale', () => {
        const { scene } = makeScene();
        const renderer = createBabylonRenderer({
            scene,
            textMetrics: new StubMetrics(10, 20),
            createCanvas: (w, h) => new StubCanvas(w, h),
        });

        const text = renderer.createText() as BabTextObject;
        text.fontSize = 10;
        text.text = 'abc';
        text.autoSize = AutoSizeType.Both;
        text.setContentSize(30, 20);
        text.textureScale = 2;
        text.commitGeometry();

        expect(text.canRasterise).toBe(true);
        const texture = text.getTexture() as { getSize(): { width: number; height: number } };
        expect(texture).not.toBeNull();

        // 3 chars * 10px * scale 2 = 60 texels wide, and one line box — the
        // stub's 20px line plus the default 3px leading — doubled, plus a
        // transparent margin on every side so glyph ink that overhangs its
        // advance box has somewhere to land instead of being shaved off.
        // fontSize 10 gives a 5px margin, doubled by the scale.
        const margin = 10;
        expect(texture.getSize().width).toBe(60 + margin * 2);
        expect(texture.getSize().height).toBe(46 + margin * 2);

        // The quad is the laid-out block grown by the margin on every side and
        // samples the whole texture. Both grew together, so the text still falls
        // exactly where the layout put it — and ink that overhangs its advance
        // box is drawn instead of sliced off.
        const uv = Array.from(text.babNode.getVerticesData(VertexBuffer.UVKind) ?? []).map(Number);
        const us = uv.filter((_, i) => i % 2 === 0);
        expect(Math.max(...us) - Math.min(...us), 'the whole texture').toBeCloseTo(1, 6);

        const pos = Array.from(text.babNode.getVerticesData(VertexBuffer.PositionKind) ?? []).map(Number);
        const xs = pos.filter((_, i) => i % 3 === 0);
        // fontSize 10 gives a 5px margin in layout units; the texture's is that
        // doubled by the scale, and the quad uses the layout-unit figure.
        expect(Math.max(...xs) - Math.min(...xs), 'block plus a margin each side').toBeCloseTo(30 + 2 * 5, 6);
    });

    test('the quad follows the text as it grows', () => {
        // The base class only learns the quad has to be rebuilt through
        // `invalidateGeometry`, and a text that grows without the core
        // committing a new content size — a counter nobody reads `width` off —
        // has to be caught here. Missing it left the quad at the size of the
        // first text ever drawn while the raster grew to fit the longer one, and
        // the label was sampled into that stale quad: each added character
        // squeezed the glyphs a little harder, so the font got thinner as the
        // number got longer.
        const { scene } = makeScene();
        const renderer = createBabylonRenderer({
            scene,
            textMetrics: new StubMetrics(10, 20),
            createCanvas: (w, h) => new StubCanvas(w, h),
        });

        const text = renderer.createText() as BabTextObject;
        text.fontSize = 10;
        text.autoSize = AutoSizeType.None;
        text.setContentSize(60, 26);

        const quadWidths: number[] = [];
        const textureWidths: number[] = [];
        for (const value of ['1', '12', '12345']) {
            text.text = value;
            text.commitGeometry();

            const positions = Array.from(text.babNode.getVerticesData(VertexBuffer.PositionKind) ?? []).map(Number);
            const xs = positions.filter((_, i) => i % 3 === 0);
            quadWidths.push(Math.max(...xs) - Math.min(...xs));

            const texture = text.getTexture() as { getSize(): { width: number } };
            textureWidths.push(texture.getSize().width);
        }

        // 10px a character, plus the 5px margin fontSize 10 asks for on each
        // side; the quad and the raster have to agree at every length.
        expect(textureWidths).toEqual([20, 30, 60]);
        expect(quadWidths).toEqual(textureWidths);
    });

    test('text rasterises at the display density by default', () => {
        // The viewport is laid out in CSS pixels while the backbuffer is not, so
        // a one-for-one raster is magnified on a high-density screen and reads
        // as soft. The default has to follow the hardware scaling level.
        const { engine, scene } = makeScene();
        const renderer = createBabylonRenderer({ scene, textMetrics: new StubMetrics() });
        const text = renderer.createText() as BabTextObject;

        expect(renderer.pixelRatio).toBe(1 / engine.getHardwareScalingLevel());
        expect(text.textureScale).toBe(renderer.pixelRatio);
    });

    test('fractional display density snaps Canvas2D glyph origins to raster texels', () => {
        const engine = new FractionalScaledNullEngine({
            renderWidth: 700,
            renderHeight: 500,
            textureSize: 256,
            deterministicLockstep: false,
            lockstepMaxSteps: 1,
        });
        let canvas: StubCanvas | null = null;
        const renderer = createBabylonRenderer({
            engine,
            textMetrics: new StubMetrics(),
            createCanvas: (w, h) => (canvas = new StubCanvas(w, h)),
        });
        const text = renderer.createText() as BabTextObject;
        text.fontSize = 10;
        text.text = 'abc';
        text.autoSize = AutoSizeType.Both;
        text.commitGeometry();

        expect(renderer.pixelRatio).toBeCloseTo(1.75, 6);
        // (20px line + 3px leading) / 2 = 11.5 UI px. At 1.75x this is
        // rounded to 20 device texels, i.e. 11.428... UI px.
        expect((canvas as unknown as StubCanvas).texts[0]).toBe('abc@0.0,11.4');
    });

    test('default text follows a later device-pixel-ratio change', () => {
        const engine = new MutableScaledNullEngine({
            renderWidth: 400,
            renderHeight: 300,
            textureSize: 256,
            deterministicLockstep: false,
            lockstepMaxSteps: 1,
        });
        const renderer = createBabylonRenderer({
            engine,
            textMetrics: new StubMetrics(10, 20),
            createCanvas: (w, h) => new StubCanvas(w, h),
        });
        const text = renderer.createText() as BabTextObject;
        text.fontSize = 10;
        text.text = 'abc';
        text.autoSize = AutoSizeType.Both;
        text.commitGeometry();

        const initial = text.getTexture() as { getSize(): { width: number } };
        expect(initial.getSize().width).toBe(40);

        engine.level = 0.5;
        text.commitGeometry();

        const retina = text.getTexture() as { getSize(): { width: number } };
        expect(text.textureScale).toBe(2);
        expect(retina.getSize().width).toBe(80);
    });

    test('an editable field with no DOM to hand over to keeps drawing its text', () => {
        // Editing hands the text, the caret and the selection to a DOM input
        // laid over the field. A host without a document has no overlay to hand
        // over to, so the field has to keep its own raster rather than going
        // blank for good.
        const { scene } = makeScene();
        const renderer = createBabylonRenderer({
            scene,
            textMetrics: new StubMetrics(10, 20),
            createCanvas: (w, h) => new StubCanvas(w, h),
        });

        const text = renderer.createText() as BabTextObject;
        text.text = 'abc';
        text.fontSize = 10;
        text.autoSize = AutoSizeType.Both;
        text.editable = true;
        text.commitGeometry();
        const drawn = text.babNode.getTotalVertices();
        expect(drawn, 'the field draws itself').toBe(4);

        text.openKeyboard();
        text.commitGeometry();

        expect(text.babNode.getTotalVertices(), 'and goes on drawing').toBe(drawn);
    });

    test('reopening a field hands the text back to the overlay, with no ghost', () => {
        // The raster is skipped while the overlay is up, but skipping is not
        // enough: the mesh keeps whatever it uploaded last. A field that was
        // typed into and then blurred drew its own text again, and opening it a
        // second time left that quad up alongside the overlay's.
        const doc = installFakeDocument();
        try {
            const { scene } = makeScene();
            const renderer = createBabylonRenderer({
                scene,
                textMetrics: new StubMetrics(10, 20),
                createCanvas: (w, h) => new StubCanvas(w, h),
            });

            const text = renderer.createText() as BabTextObject;
            text.text = 'abc';
            text.fontSize = 10;
            text.autoSize = AutoSizeType.Both;
            text.editable = true;
            text.commitGeometry();

            text.openKeyboard();
            text.commitGeometry();
            expect(text.babNode.getTotalVertices(), 'nothing drawn while editing').toBe(0);

            closeNativeInput();
            text.commitGeometry();
            expect(text.babNode.getTotalVertices(), 'the field draws itself again').toBe(4);

            text.openKeyboard();
            text.commitGeometry();
            expect(text.babNode.getTotalVertices(), 'and stands down once more').toBe(0);
        } finally {
            closeNativeInput();
            doc.restore();
        }
    });

    test('the raster grows to hold an outline and a drop shadow', () => {
        // The margin around the raster is what keeps ink that leaves the advance
        // box from being shaved off. An outline straddles the glyph edge and a
        // shadow lands a whole offset away, so both have to be counted or a
        // thick outline loses its outer half and a long shadow is cut short.
        const canvases: StubCanvas[] = [];
        const { scene } = makeScene();
        const renderer = createBabylonRenderer({
            scene,
            textMetrics: new StubMetrics(10, 20),
            createCanvas: (w, h) => {
                const canvas = new StubCanvas(w, h);
                canvases.push(canvas);
                return canvas;
            },
        });

        const text = renderer.createText() as BabTextObject;
        text.text = 'abc';
        text.fontSize = 10;
        text.autoSize = AutoSizeType.Both;
        text.leading = 0;
        text.commitGeometry();
        // 30px of text and a 20px line, with the 5px margin a 10px font asks for.
        expect(canvases[0].width, 'text plus a 5px margin each side').toBe(40);

        text.stroke = 4;
        text.shadowOffsetX = -6;
        text.shadowOffsetY = 3;
        text.commitGeometry();

        // 5 (ink) + 4/2 (outline) + 6 (the longer shadow axis) = 13 a side.
        expect(canvases[canvases.length - 1].width).toBe(30 + 13 * 2);
        expect(canvases[canvases.length - 1].height).toBe(20 + 13 * 2);
    });

    test('a line is placed by centring what sits above the baseline', () => {
        // `measureText('Mg')` reports the ink — a capital tall, which a Latin font
        // sets about a tenth of its size below its own ascent. A run placed by
        // that sits visibly high: it showed against a tree row's icon, which is
        // centred, and the same lift pushed a combo's title off its middle.
        const canvases: StubCanvas[] = [];
        const { scene } = makeScene();
        const renderer = createBabylonRenderer({
            scene,
            textMetrics: new StubMetrics(10, 20),
            createCanvas: (w, h) => {
                const canvas = new AscentCanvas(w, h);
                canvases.push(canvas);
                return canvas;
            },
        });

        const text = renderer.createText() as BabTextObject;
        text.text = 'abc';
        text.fontSize = 10;
        text.autoSize = AutoSizeType.Both;
        text.leading = 0;
        text.commitGeometry();

        // The stub reports a 12px ascent and a 20px line box, so the capitals
        // are centred in it: the baseline sits at (20 + 12) / 2.
        expect(canvases[0].texts[0]).toBe('abc@0.0,16.0');
    });

    test('a leading value does not push measured glyphs below the raster', () => {
        const canvases: StubCanvas[] = [];
        const { scene } = makeScene();
        const renderer = createBabylonRenderer({
            scene,
            textMetrics: new StubMetrics(10, 20),
            createCanvas: (w, h) => {
                const canvas = new AscentCanvas(w, h);
                canvases.push(canvas);
                return canvas;
            },
        });

        const text = renderer.createText() as BabTextObject;
        text.text = 'abc';
        text.fontSize = 10;
        text.autoSize = AutoSizeType.Both;
        // The default leading is 3px. It belongs between lines, not below the
        // final line, so the baseline must still be based on lineHeight.
        text.commitGeometry();

        expect(canvases[0].texts[0]).toBe('abc@0.0,16.0');
    });

    test('a large ascent and descent remain inside the transparent raster margin', () => {
        const canvases: StubCanvas[] = [];
        const { scene } = makeScene();
        const renderer = createBabylonRenderer({
            scene,
            textMetrics: new StubMetrics(10, 20),
            createCanvas: (w, h) => {
                const canvas = new TallDescentCanvas(w, h);
                canvases.push(canvas);
                return canvas;
            },
        });
        const text = renderer.createText() as BabTextObject;
        text.text = 'gyp';
        text.fontSize = 10;
        text.autoSize = AutoSizeType.Both;
        text.commitGeometry();

        // The 18px ascent and 8px descent exceed the 20px layout line. The
        // glyph keeps its natural baseline and the 5px transparent margin keeps
        // both overhangs inside the raster rather than clipping either edge.
        expect(canvases[0].texts[0]).toBe('gyp@0.0,19.0');
        expect(canvases[0].height).toBe(33);
    });

    test('the colour is applied as a tint, never baked into the raster', () => {
        // The text path tints through the shader's `uTint`, which is the
        // object's colour. Painting the glyphs in that colour as well applied it
        // twice: a mid-grey label landed at a quarter of its value, and a
        // half-transparent one at a quarter of its opacity.
        const canvases: StubCanvas[] = [];
        const { scene } = makeScene();
        const renderer = createBabylonRenderer({
            scene,
            textMetrics: new StubMetrics(10, 20),
            createCanvas: (w, h) => {
                const canvas = new StubCanvas(w, h);
                canvases.push(canvas);
                return canvas;
            },
        });

        const text = renderer.createText() as BabTextObject;
        text.text = 'ab';
        text.fontSize = 10;
        text.autoSize = AutoSizeType.Both;
        text.color = new Color(128, 64, 32, 128);
        text.commitGeometry();

        expect(canvases[0].fills[0], 'the ink is white, alpha included').toBe('#ffffffff');

        // And since the colour never reaches the pixels, changing it is no
        // reason to repaint.
        text.color = new Color(255, 255, 255, 255);
        text.commitGeometry();
        expect(canvases[0].fills.length, 'a colour change is not a repaint').toBe(1);
        expect(canvases.length, 'and allocates no new texture').toBe(1);
    });

    test('a text object lays itself out once, not twice', () => {
        // The layout is compared against a snapshot of the fields it was built
        // from, and that comparison only runs when there is a layout to compare
        // against. A first pass that left the snapshot at its initial values made
        // the second call see a difference that was not there — every field laid
        // itself out and repainted twice on the way up.
        const canvases: StubCanvas[] = [];
        const { scene } = makeScene();
        const renderer = createBabylonRenderer({
            scene,
            textMetrics: new StubMetrics(10, 20),
            createCanvas: (w, h) => {
                const canvas = new StubCanvas(w, h);
                canvases.push(canvas);
                return canvas;
            },
        });

        const text = renderer.createText() as BabTextObject;
        text.text = 'ab';
        text.fontSize = 10;
        text.autoSize = AutoSizeType.Both;
        text.commitGeometry();

        expect(canvases[0].fills.length, 'painted once').toBe(1);

        text.commitGeometry();
        expect(canvases[0].fills.length, 'and a second commit has nothing to do').toBe(1);
        expect(text.measureTextWidth(), 'and the layout is still the measured one').toBe(20);
    });

    test('textureScale stays out of the layout numbers', () => {
        const { scene } = makeScene();
        const renderer = createBabylonRenderer({
            scene,
            textMetrics: new StubMetrics(10, 20),
            createCanvas: (w, h) => new StubCanvas(w, h),
        });
        const text = renderer.createText() as BabTextObject;
        text.fontSize = 10;
        text.text = 'abc';
        text.autoSize = AutoSizeType.Both;
        text.textureScale = 3;
        expect(text.measureTextWidth()).toBe(30);
        expect(text.measureTextHeight(), 'one line box, leading included').toBe(23);
    });

    test('underline and alignment reach the rasteriser', () => {
        const canvases: StubCanvas[] = [];
        const { scene } = makeScene();
        const renderer = createBabylonRenderer({
            scene,
            textMetrics: new StubMetrics(10, 20),
            createCanvas: (w, h) => {
                const canvas = new StubCanvas(w, h);
                canvases.push(canvas);
                return canvas;
            },
        });

        const text = renderer.createText() as BabTextObject;
        text.text = 'abcdef';
        text.fontSize = 10;
        text.align = AlignType.Right;
        text.underline = true;
        text.autoSize = AutoSizeType.Both;
        text.setContentSize(60, 20);
        text.commitGeometry();

        const canvas = canvases[canvases.length - 1];
        expect(canvas.calls).toContain('fillText');
        // Right-aligned, and centred in the line box: (20 + 3) / 2.
        expect(canvas.texts[0]).toBe('abcdef@0.0,11.5');
        // The underline is drawn as a filled bar under the line.
        expect(canvas.calls).toContain('fillRect');
    });

    test('symmetric label padding does not shift centered text', () => {
        const { scene } = makeScene();
        const renderer = createBabylonRenderer({
            scene,
            textMetrics: new StubMetrics(10, 20),
            createCanvas: (w, h) => new StubCanvas(w, h),
        });
        const text = renderer.createText() as BabTextObject;
        text.text = 'ab';
        text.fontSize = 10;
        text.align = AlignType.Center;
        text.verticalAlign = VertAlignType.Middle;
        text.autoSize = AutoSizeType.None;
        text.setContentSize(40, 40);
        text.commitGeometry();

        const positions = Array.from(text.babNode.getVerticesData(VertexBuffer.PositionKind)!);
        const minX = Math.min(positions[0], positions[3], positions[6], positions[9]);
        const maxX = Math.max(positions[0], positions[3], positions[6], positions[9]);
        const minY = Math.min(positions[1], positions[4], positions[7], positions[10]);
        const maxY = Math.max(positions[1], positions[4], positions[7], positions[10]);
        expect((minX + maxX) / 2).toBeCloseTo(20, 6);
        expect((minY + maxY) / 2).toBeCloseTo(20, 6);
    });

    test('a text object with no canvas factory lays out but draws nothing', () => {
        const { scene } = makeScene();
        const renderer = createBabylonRenderer({ scene, textMetrics: new StubMetrics(), createCanvas: null });
        const text = renderer.createText() as BabTextObject;
        text.text = 'hello';
        text.autoSize = AutoSizeType.Both;
        text.setContentSize(50, 20);
        text.commitGeometry();

        expect(text.canRasterise).toBe(false);
        expect(text.getTexture()).toBeNull();
        expect(text.babNode.getTotalVertices()).toBe(0);
        // The layout still answered, so the core can size the object.
        expect(text.measureTextWidth()).toBe(50);
    });

    test('the quad tracks a re-measure after the text changes', () => {
        const { scene } = makeScene();
        const renderer = createBabylonRenderer({
            scene,
            textMetrics: new StubMetrics(10, 20),
            createCanvas: (w, h) => new StubCanvas(w, h),
        });
        const text = renderer.createText() as BabTextObject;
        text.fontSize = 10;
        text.text = 'ab';
        text.autoSize = AutoSizeType.Both;
        text.setContentSize(20, 20);
        renderer.attachToStage(text);
        renderer.update();

        let maxX = 0;
        const positions = Array.from(text.babNode.getVerticesData(VertexBuffer.PositionKind)!);
        for (let i = 0; i < positions.length; i += 3)
            maxX = Math.max(maxX, positions[i]);
        // The block is 20 wide; the quad carries its 5px raster margin and the
        // 2px Laya-compatible layout offset.
        expect(maxX).toBeCloseTo(20 + 5 + 2, 6);

        text.text = 'abcd';
        text.setContentSize(40, 20);
        renderer.update();
        const after = Array.from(text.babNode.getVerticesData(VertexBuffer.PositionKind)!);
        maxX = 0;
        for (let i = 0; i < after.length; i += 3)
            maxX = Math.max(maxX, after[i]);
        expect(maxX).toBeCloseTo(40 + 5 + 2, 6);
    });
});

// ---------------------------------------------------------------------------
// bitmap fonts
// ---------------------------------------------------------------------------

/**
 * `Basics/HitNumber` measured from the package itself: glyph rects are in
 * coordinates of the 1024×1024 `Basics_atlas0.png`, offsets are pen-relative,
 * and the design size is 50.
 */
const HIT_ATLAS_SIZE = 1024;
const HIT_ZERO = { x: 482, y: 200, w: 35, h: 37, offsetX: 11, offsetY: 7, advance: 33 };
const HIT_ONE = { x: 787, y: 102, w: 26, h: 47, offsetX: 13, offsetY: 2, advance: 33 };
const HIT_TWO = { x: 176, y: 886, w: 49, h: 46, offsetX: 1, offsetY: 3, advance: 32 };

/** Positions the mesh ended up with, as `[x, y]` pairs in vertex order. */
function glyphPositionsOf(obj: BabTextObject): Array<[number, number]> {
    const raw = Array.from(obj.babNode.getVerticesData(VertexBuffer.PositionKind) ?? []).map(Number);
    const out: Array<[number, number]> = [];
    for (let i = 0; i < raw.length; i += 3)
        out.push([raw[i], raw[i + 1]]);
    return out;
}

function textUvsOf(obj: BabTextObject): number[] {
    return Array.from(obj.babNode.getVerticesData(VertexBuffer.UVKind) ?? []).map(Number);
}

describe('bitmap text rendering', () => {
    /**
     * A field drawing with `Basics/HitNumber`.
     *
     * The atlas is a stand-in whose size can be set: under `NullEngine` a real
     * `Texture` reports the engine's placeholder texture size rather than the
     * image's, which would silently make every UV wrong.
     */
    function makeField(options: { canvas?: boolean; atlasReady?: boolean } = {}): {
        text: BabTextObject;
        atlas: FakeAtlas;
    } {
        const atlas = new FakeAtlas();
        atlas.width = HIT_ATLAS_SIZE;
        atlas.height = HIT_ATLAS_SIZE;
        atlas.ready = options.atlasReady ?? true;

        const { scene } = makeScene();
        const renderer = createBabylonRenderer({
            scene,
            textMetrics: new StubMetrics(10, 20),
            ...(options.canvas === false ? {} : { createCanvas: (w, h) => new StubCanvas(w, h) }),
        });

        setAssetResolver((item) => (item.type === PackageItemType.Atlas ? atlas : null));
        const pkg = UIPackage.parse(readFixture('Basics.fui'), 'ui/Basics');
        const font = pkg.getItemByName('HitNumber')!.bitmapFont!;

        const text = renderer.createText() as BabTextObject;
        text.bitmapFont = font;
        // `GTextField` snaps this; a surface driven directly has to be told.
        text.fontSize = font.size;
        text.autoSize = AutoSizeType.Both;
        // No leading, so a line's box is exactly the font's own line height and
        // a glyph lands at its bare `yOffset`. The leading offset has its own
        // test below.
        text.leading = 0;
        return { text, atlas };
    }

    test('a glyph is drawn as one quad cut from the package atlas', () => {
        const { text, atlas } = makeField();
        text.text = '0';
        text.commitGeometry();

        expect(text.bitmapAtlasTexture, 'sampling the package atlas').toBe(atlas as never);

        const pos = glyphPositionsOf(text);
        expect(pos.length, 'one quad per glyph').toBe(4);
        expect(pos[0], 'top-left, where the glyph offset says').toEqual([2 + HIT_ZERO.offsetX, 2 + HIT_ZERO.offsetY]);
        expect(pos[1]).toEqual([2 + HIT_ZERO.offsetX + HIT_ZERO.w, 2 + HIT_ZERO.offsetY]);
        expect(pos[3]).toEqual([2 + HIT_ZERO.offsetX, 2 + HIT_ZERO.offsetY + HIT_ZERO.h]);

        const uv = textUvsOf(text);
        expect(uv[0], 'u0').toBeCloseTo(HIT_ZERO.x / HIT_ATLAS_SIZE, 6);
        expect(uv[1], 'v0').toBeCloseTo(HIT_ZERO.y / HIT_ATLAS_SIZE, 6);
        expect(uv[2], 'u1').toBeCloseTo((HIT_ZERO.x + HIT_ZERO.w) / HIT_ATLAS_SIZE, 6);
        expect(uv[5], 'v1').toBeCloseTo((HIT_ZERO.y + HIT_ZERO.h) / HIT_ATLAS_SIZE, 6);
    });

    test('the pen advances by each glyph\'s own advance', () => {
        const { text } = makeField();
        text.text = '12';
        text.commitGeometry();

        const pos = glyphPositionsOf(text);
        expect(pos.length).toBe(8);
        // `'2'` starts a whole advance along — 33 for `'1'`, not its 26px ink.
        expect(pos[4]).toEqual([2 + HIT_ONE.advance + HIT_TWO.offsetX, 2 + HIT_TWO.offsetY]);
    });

    test('changing the text redraws the glyphs', () => {
        // A package font's geometry is cut from the atlas for the text it was
        // laid out with. The layout used to be taken only by the rasterisation
        // path, which a bitmap-font field does not have — so a field whose text
        // changed went on drawing the glyphs it was first built with, and a
        // cooldown's digits stayed on whichever number they started at.
        const { text } = makeField();
        text.text = '0';
        text.commitGeometry();
        const first = textUvsOf(text);
        expect(first.length, 'one glyph').toBe(8);

        // What the core does between two commits: it measures the field to size
        // it, which settles the layout flag. Without this the flag is left over
        // from the build above and masks the bug.
        expect(text.measureTextWidth()).toBeGreaterThan(0);

        text.text = '5';
        text.commitGeometry();

        expect(textUvsOf(text), 'the glyph for the new character').not.toEqual(first);
    });

    test('leading moves a glyph down into its line box', () => {
        // Each line owns a box of the font's line height plus the leading, and
        // the glyphs sit centred in it — which is where the reference put them,
        // its line height having been `fontSize + leading`.
        const { text } = makeField();
        text.leading = 10;
        text.text = '0';
        text.commitGeometry();

        // `HitNumber`'s own line is 50 tall, so its box grows to 60 and the
        // glyph is centred in it.
        expect(text.measureTextHeight()).toBe(60);
        expect(glyphPositionsOf(text)[0][1]).toBe(2 + (60 - 50) / 2 + HIT_ZERO.offsetY);
    });

    test('a second line starts a line height down', () => {
        const { text } = makeField();
        text.text = '1\n2';
        text.commitGeometry();

        expect(text.measureTextHeight(), 'two of the font\'s 50px lines').toBe(100);
        const pos = glyphPositionsOf(text);
        expect(pos.length).toBe(8);
        expect(pos[4], 'the second line\'s first glyph').toEqual([2 + HIT_TWO.offsetX, 2 + 50 + HIT_TWO.offsetY]);
    });

    test('the block is aligned inside the content box', () => {
        const { text } = makeField();
        text.autoSize = AutoSizeType.None;
        text.setContentSize(100, 50);
        text.align = AlignType.Right;
        text.text = '0';
        text.commitGeometry();

        // The line is 33 wide in a 100 box: 67 of leading space, then the
        // glyph's own offset.
        // Right alignment reserves the trailing 2px padding, so the glyph
        // starts two pixels before the unpadded right edge.
        expect(glyphPositionsOf(text)[0]).toEqual([67 - 2 + HIT_ZERO.offsetX, 2 + HIT_ZERO.offsetY]);
    });

    test('letter spacing moves the pen without changing the layout', () => {
        const { text } = makeField();
        text.letterSpacing = 10;
        text.text = '12';
        text.commitGeometry();

        expect(text.measureTextWidth(), '33 + spacing + 32').toBe(75);
        expect(glyphPositionsOf(text)[4][0]).toBe(2 + HIT_ONE.advance + 10 + HIT_TWO.offsetX);
    });

    test('a character with no glyph is skipped without stalling the pen', () => {
        const { text } = makeField();
        text.text = '1x2';
        text.commitGeometry();

        const pos = glyphPositionsOf(text);
        // Two glyphs have images; the third character does not, and the
        // reference advanced by nothing for it.
        expect(pos.length).toBe(8);
        expect(pos[4][0], '`2` sits where `x` left the pen').toBe(2 + HIT_ONE.advance + HIT_TWO.offsetX);
    });

    test('a space with no glyph still takes room', () => {
        const { text } = makeField();
        text.text = '1 2';
        text.commitGeometry();

        // Half the font size, which is the rule the reference runtime used;
        // advancing by nothing would run "1 2" together as "12".
        expect(glyphPositionsOf(text)[4][0]).toBe(2 + HIT_ONE.advance + 25 + HIT_TWO.offsetX);
    });

    test('a bitmap font draws with no canvas at all', () => {
        // The glyphs are already images, so nothing has to be rasterised — which
        // is the one thing the system-font path cannot do without a canvas.
        const { text } = makeField({ canvas: false });
        expect(text.canRasterise).toBe(false);

        text.text = '0';
        text.commitGeometry();

        expect(glyphPositionsOf(text).length).toBe(4);
        expect(text.getTexture(), 'and no raster is allocated').toBeNull();
    });

    test('a glyph waits for its atlas and then lands correctly', () => {
        const { text, atlas } = makeField({ atlasReady: false });
        text.text = '0';
        text.commitGeometry();

        // Drawing against the placeholder size would bake UVs that sample the
        // wrong region, and the geometry is cached.
        expect(glyphPositionsOf(text).length, 'nothing while the atlas is late').toBe(0);

        atlas.ready = true;
        text.commitGeometry();

        const uv = textUvsOf(text);
        expect(glyphPositionsOf(text).length).toBe(4);
        expect(uv[0]).toBeCloseTo(HIT_ZERO.x / HIT_ATLAS_SIZE, 6);
    });

    test('rich text keeps to the raster path', () => {
        // Markup is flattened before layout here, so there are no runs for a
        // per-run font to hang off; the reference's rich text never drew a
        // bitmap glyph either.
        const { text } = makeField();
        text.rich = true;
        text.text = '12';
        text.commitGeometry();

        expect(text.bitmapAtlasTexture, 'no glyph atlas').toBeNull();
        expect(glyphPositionsOf(text).length, 'the single raster quad, not two glyphs').toBe(4);
        expect(text.getTexture(), 'a dynamic texture instead').not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// clipping
// ---------------------------------------------------------------------------

describe('clipping', () => {
    test('a point inside the rect passes and one outside is rejected', () => {
        const stack = new ClipStack();
        stack.push(new Mat2D(), new Rect(0, 0, 10, 10));
        expect(stack.containsUIPoint(5, 5)).toBe(true);
        expect(stack.containsUIPoint(15, 5)).toBe(false);
        expect(stack.containsUIPoint(-1, 5)).toBe(false);
    });

    test('every rect has to accept the point', () => {
        const stack = new ClipStack();
        stack.push(new Mat2D(), new Rect(0, 0, 100, 100));
        stack.push(new Mat2D(), new Rect(40, 40, 20, 20));
        expect(stack.containsUIPoint(50, 50)).toBe(true);
        expect(stack.containsUIPoint(10, 10)).toBe(false);
    });

    test('a rotated nested rect composes through its own inverse matrix', () => {
        // A clip whose local space is rotated 90° clockwise and moved to (50,50):
        // local -> UI is (x, y) -> (-y + 50, x + 50).
        const rotated = Mat2D.fromTRS(50, 50, 90, 1, 1, 0, 0);

        const childOnly = new ClipStack();
        childOnly.push(rotated, new Rect(-60, -60, 120, 120));
        expect(childOnly.containsUIPoint(50, 0)).toBe(true);
        expect(childOnly.containsUIPoint(105, 50)).toBe(true);

        // The second point escapes a 100x100 parent clip even though the rotated
        // child accepts it, which is exactly why the rects cannot be intersected.
        const nested = new ClipStack();
        nested.push(new Mat2D(), new Rect(0, 0, 100, 100));
        nested.push(rotated, new Rect(-60, -60, 120, 120));
        expect(nested.containsUIPoint(50, 0)).toBe(true);
        expect(nested.containsUIPoint(105, 50)).toBe(false);
    });

    test('more than four nested rects keeps the innermost and counts the loss', () => {
        const stack = new ClipStack();
        // Nested boxes growing outward: rect i is `(5 + i)` square, so #0 is the
        // outermost and #5 the innermost. Pushing six drops #0 and #1, leaving
        // #2..#5 to clip, of which #2 is the smallest and therefore binds.
        for (let i = 0; i < MAX_CLIP_RECTS + 2; i++)
            stack.push(new Mat2D(), new Rect(0, 0, 5 + i, 5 + i));

        expect(stack.count).toBe(MAX_CLIP_RECTS);
        expect(stack.droppedCount).toBe(2);

        // Inside #2..#5 but outside both dropped rects (#0 is 5x5, #1 is 6x6):
        // only the drop makes this true.
        expect(stack.containsUIPoint(6.5, 6.5)).toBe(true);
        // Outside #2 (7x7), so the outermost surviving rect still clips.
        expect(stack.containsUIPoint(7.5, 7.5)).toBe(false);
        // Outside #5 (10x10), so the innermost is honoured too.
        expect(stack.containsUIPoint(10.5, 10.5)).toBe(false);
    });

    test('inactive slots are written as pass-throughs', () => {
        const stack = new ClipStack();
        stack.push(new Mat2D(), new Rect(0, 0, 10, 10));
        const rects: number[] = new Array(MAX_CLIP_RECTS * 4).fill(0);
        const row0: number[] = new Array(MAX_CLIP_RECTS * 4).fill(0);
        const row1: number[] = new Array(MAX_CLIP_RECTS * 4).fill(0);
        stack.writeUniforms(rects, row0, row1);

        expect(rects.slice(0, 4)).toEqual([0, 0, 10, 10]);
        expect(row0.slice(4, 8)).toEqual([1, 0, 0, 0]);
        expect(row1.slice(4, 8)).toEqual([0, 1, 0, 0]);
        expect(rects[4]).toBeLessThan(-1e8);
        expect(rects[6]).toBeGreaterThan(1e8);
    });

    test('a rotated rect reaches the shader as a matrix, not a box', () => {
        const stack = new ClipStack();
        stack.push(Mat2D.fromTRS(50, 50, 90, 1, 1, 0, 0), new Rect(0, 0, 10, 10));
        const rects: number[] = new Array(MAX_CLIP_RECTS * 4).fill(0);
        const row0: number[] = new Array(MAX_CLIP_RECTS * 4).fill(0);
        const row1: number[] = new Array(MAX_CLIP_RECTS * 4).fill(0);
        stack.writeUniforms(rects, row0, row1);

        // row0 is (a, c, tx, _), row1 is (b, d, ty, _).
        expect(row0[0]).toBeCloseTo(0, 6);
        expect(row0[1]).toBeCloseTo(1, 6);
        expect(row0[2]).toBeCloseTo(-50, 6);
        expect(row1[0]).toBeCloseTo(-1, 6);
        expect(row1[1]).toBeCloseTo(0, 6);
        expect(row1[2]).toBeCloseTo(50, 6);
    });

    test('the renderer propagates a scrollRect down the tree', () => {
        const renderer = makeRenderer();
        const parent = renderer.createObject();
        const rotatedChild = renderer.createObject();
        const leaf = renderer.createObject();
        renderer.attachToStage(parent);
        parent.addChild(rotatedChild);
        rotatedChild.addChild(leaf);

        parent.setContentSize(100, 100);
        parent.scrollRect = new Rect(0, 0, 100, 100);

        rotatedChild.setContentSize(200, 200);
        rotatedChild.setPosition(50, 50);
        rotatedChild.angle = 90;
        rotatedChild.scrollRect = new Rect(-60, -60, 120, 120);

        leaf.setContentSize(10, 10);
        renderer.update();

        expect(leaf.clips.count).toBe(2);
        expect(leaf.hitTestClip(50, 0)).toBe(true);
        expect(leaf.hitTestClip(105, 50)).toBe(false); // accepted by the child, rejected by the parent
        expect(leaf.hitTestClip(150, 0)).toBe(false);
    });

    test('an object with no clips accepts every point', () => {
        const renderer = makeRenderer();
        const obj = renderer.createObject();
        renderer.attachToStage(obj);
        renderer.update();
        expect(obj.hitTestClip(1234, -567)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// hit testing
// ---------------------------------------------------------------------------

describe('hit testing', () => {
    test('the box test runs in the object’s own local space', () => {
        const renderer = makeRenderer();
        const image = renderer.createImage();
        renderer.attachToStage(image);
        image.setContentSize(40, 20);

        expect(image.hitTest(0, 0)).toBe(true);
        expect(image.hitTest(39.9, 19.9)).toBe(true);
        expect(image.hitTest(40, 10)).toBe(false);
        expect(image.hitTest(10, 20)).toBe(false);
        expect(image.hitTest(-1, 10)).toBe(false);
    });

    test('hitTestShape narrows the box further', () => {
        const renderer = makeRenderer();
        const image = renderer.createImage();
        renderer.attachToStage(image);
        image.setContentSize(40, 40);
        image.hitTestShape = (x, y) => x < 20 && y < 20;

        expect(image.hitTest(10, 10)).toBe(true);
        expect(image.hitTest(30, 30)).toBe(false);
        expect(image.hitTest(25, 25)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// renderer and viewport
// ---------------------------------------------------------------------------

/** Reports the numbers a device-pixel-ratio canvas engine would report. */
class ScaledNullEngine extends NullEngine {
    public override getHardwareScalingLevel(): number {
        return 0.5;
    }

    public override getRenderWidth(): number {
        return 1600;
    }

    public override getRenderHeight(): number {
        return 1200;
    }
}

/** A fractional-density engine, matching common browser DPR values. */
class FractionalScaledNullEngine extends NullEngine {
    public override getHardwareScalingLevel(): number {
        return 4 / 7;
    }
}

class MutableScaledNullEngine extends NullEngine {
    public level = 1;

    public override getHardwareScalingLevel(): number {
        return this.level;
    }
}

describe('renderer viewport', () => {
    test('the viewport is reported in UI units, not device pixels', () => {
        const engine = new ScaledNullEngine({
            renderWidth: 1600,
            renderHeight: 1200,
            textureSize: 256,
            deterministicLockstep: false,
            lockstepMaxSteps: 1,
        });
        const renderer = createBabylonRenderer({ engine });

        // 1600 render pixels at a 0.5 hardware scaling level is 800 UI units.
        expect(renderer.viewportWidth).toBe(800);
        expect(renderer.viewportHeight).toBe(600);
        expect(renderer.viewportWidth).not.toBe(engine.getRenderWidth());

        renderer.setViewport(1, 1);
        renderer.resizeToEngine();
        expect(renderer.viewportWidth).toBe(800);
    });

    test('onViewportResize fires for every registered callback', () => {
        const renderer = createBabylonRenderer({ width: 800, height: 600 });
        const seen: Array<[number, number]> = [];
        let second = 0;

        renderer.onViewportResize((w, h) => seen.push([w, h]));
        renderer.onViewportResize(() => { second++; });

        // Registration alone does not fire; `viewportWidth` is the sync read.
        expect(seen.length).toBe(0);

        renderer.setViewport(1024, 768);
        expect(seen).toEqual([[1024, 768]]);
        expect(second).toBe(1);
        expect(renderer.viewportWidth).toBe(1024);

        renderer.setViewport(1024, 768);
        expect(seen.length).toBe(1);

        renderer.setViewport(640, 480);
        expect(seen).toEqual([[1024, 768], [640, 480]]);
        expect(second).toBe(2);
    });

    test('the orthographic box follows the viewport', () => {
        const renderer = createBabylonRenderer({ width: 320, height: 240 });
        expect(renderer.camera.mode).toBe(Camera.ORTHOGRAPHIC_CAMERA);
        expect(renderer.camera.orthoLeft).toBe(0);
        expect(renderer.camera.orthoRight).toBe(320);
        expect(renderer.camera.orthoTop).toBe(0);
        expect(renderer.camera.orthoBottom).toBe(-240);

        renderer.setViewport(100, 50);
        expect(renderer.camera.orthoRight).toBe(100);
        expect(renderer.camera.orthoBottom).toBe(-50);
    });

    test('the host scene keeps its own active camera and gains the overlay after it', () => {
        const { scene } = makeScene();
        const hostCamera = new Camera('host', new Vector3(0, 5, -10), scene);
        expect(scene.activeCamera).toBe(hostCamera);

        const renderer = createBabylonRenderer({ scene });
        expect(scene.activeCamera).toBe(hostCamera);
        expect(renderer.camera).not.toBe(hostCamera);
        // Identity, not deep equality: a Babylon camera graph is circular, so
        // `toEqual` would compare engine internals instead of the list itself.
        expect(scene.activeCameras?.length).toBe(2);
        expect(scene.activeCameras?.[0]).toBe(hostCamera);
        expect(scene.activeCameras?.[1]).toBe(renderer.camera);
        // The UI is on its own layer, so the host camera cannot draw it.
        expect(renderer.camera.layerMask).toBe(renderer.uiLayerMask);
        expect(renderer.uiLayerMask & hostCamera.layerMask).toBe(0);
    });

    test('a scene with no camera of its own gets the UI camera as active', () => {
        const { scene } = makeScene();
        const renderer = createBabylonRenderer({ scene });
        expect(scene.activeCamera).toBe(renderer.camera);
    });

    test('attachToStage parents the node under the UI root', () => {
        const renderer = makeRenderer();
        const root = renderer.createObject();
        renderer.attachToStage(root);
        expect(root.babNode.parent).toBe(renderer.uiRootNode);

        const child = renderer.createObject();
        root.addChild(child);
        expect(child.babNode.parent).toBe(root.babNode);

        root.removeChild(child);
        expect(child.babNode.parent).toBe(renderer.holdingNode);
    });

    test('an object never attached stays out of the render traversal', () => {
        const renderer = makeRenderer();
        const orphan = renderer.createObject();
        orphan.setContentSize(10, 10);
        orphan.setPosition(5, 5);
        orphan.drawOrder = -1;
        renderer.update();
        expect(orphan.drawOrder).toBe(-1);
        expect(orphan.babNode.parent).toBe(renderer.holdingNode);
    });

    test('the draw order follows the display list', () => {
        const renderer = makeRenderer();
        const root = renderer.createObject();
        renderer.attachToStage(root);
        const a = renderer.createObject();
        const b = renderer.createObject();
        const c = renderer.createObject();
        root.addChild(a);
        root.addChild(b);
        root.addChild(c);
        renderer.update();

        expect(a.drawOrder).toBeLessThan(b.drawOrder);
        expect(b.drawOrder).toBeLessThan(c.drawOrder);

        root.setChildIndex(c, 0);
        renderer.update();
        expect(c.drawOrder).toBeLessThan(a.drawOrder);
    });

    test('alpha accumulates down the tree for the tint', () => {
        const renderer = makeRenderer();
        const root = renderer.createObject();
        const mid = renderer.createObject();
        const leaf = renderer.createObject();
        renderer.attachToStage(root);
        root.addChild(mid);
        mid.addChild(leaf);

        root.alpha = 0.5;
        mid.alpha = 0.5;
        leaf.alpha = 0.5;
        renderer.update();

        expect(leaf.worldAlpha).toBeCloseTo(0.125, 6);
    });

    test('the backend is constructible and driveable under NullEngine', () => {
        const renderer = createBabylonRenderer({ width: 200, height: 100 });
        const root = renderer.createObject();
        renderer.attachToStage(root);

        const image = renderer.createImage();
        root.addChild(image);
        image.setSprite(spriteHandle(renderer, 32, 32), null, false);
        image.setContentSize(32, 32);

        const text = renderer.createText();
        root.addChild(text);
        text.text = 'hi';
        text.autoSize = AutoSizeType.Both;
        text.setContentSize(20, 20);

        const graph = renderer.createGraph();
        root.addChild(graph);
        graph.drawRect(2, new Color(255, 0, 0, 255), new Color(0, 255, 0, 255), 0, 0, 20, 10);

        renderer.update();
        expect(image.babNode.getTotalVertices()).toBe(4);
        expect(image.babNode.getIndices()?.length).toBe(6);
        expect(graph.babNode.getTotalVertices()).toBeGreaterThan(0);

        // Driving a full frame through NullEngine must not throw.
        expect(() => renderer.render()).not.toThrow();
    });

    test('an object from another backend is rejected loudly', () => {
        const renderer = makeRenderer();
        const root = renderer.createObject();
        renderer.attachToStage(root);
        const foreign = { parent: null, numChildren: 0 } as never;
        expect(() => root.addChild(foreign)).toThrow(/from another backend/);
    });
});

// ---------------------------------------------------------------------------
// graph
// ---------------------------------------------------------------------------

describe('graph triangulation', () => {
    test('a filled rectangle is two triangles', () => {
        const renderer = makeRenderer();
        const graph = renderer.createGraph();
        renderer.attachToStage(graph);
        graph.drawRect(0, NO_STROKE, WHITE, 0, 0, 10, 10);
        renderer.update();
        expect(graph.babNode.getTotalVertices()).toBe(4);
        expect(graph.babNode.getIndices()?.length).toBe(6);
    });

    test('a small ellipse is round enough to read as a circle', () => {
        // The bag window's pagination dots are 15px ellipses. A segment count
        // that scales with the radius gave them eight sides, which is not a
        // circle at that size but an octagon.
        const renderer = makeRenderer();
        const graph = renderer.createGraph();
        renderer.attachToStage(graph);
        graph.drawEllipse(0, NO_STROKE, WHITE, 0, 0, 15, 15);
        renderer.update();

        const positions = Array.from(graph.babNode.getVerticesData(VertexBuffer.PositionKind) ?? []).map(Number);
        const points: Array<[number, number]> = [];
        for (let i = 0; i < positions.length; i += 3)
            points.push([positions[i], positions[i + 1]]);
        expect(points.length, 'a ring of vertices').toBeGreaterThan(2);

        // Every vertex sits on the circle, so what betrays a coarse polygon is
        // the flat side *between* two of them: measure how far each chord's
        // midpoint falls inside it.
        const r = 7.5;
        let worst = 0;
        for (let i = 0; i + 1 < points.length; i++) {
            const mx = (points[i][0] + points[i + 1][0]) / 2 - r;
            const my = (points[i][1] + points[i + 1][1]) / 2 - r;
            worst = Math.max(worst, r - Math.hypot(mx, my));
        }

        // Eight sides leave 0.57px; the outline is asked to stay under a tenth
        // of a pixel, so half a pixel is a generous reading of "round".
        expect(worst, 'the flattest chord').toBeLessThan(0.5);
    });

    test('a huge ellipse does not explode the vertex count', () => {
        const renderer = makeRenderer();
        const graph = renderer.createGraph();
        renderer.attachToStage(graph);
        graph.drawEllipse(0, NO_STROKE, WHITE, 0, 0, 4000, 4000);
        renderer.update();

        // The count is clamped, so an ellipse the size of the screen is still
        // one draw call's worth of vertices rather than thousands.
        expect(graph.babNode.getTotalVertices()).toBeLessThanOrEqual(256);
    });

    test('a concave polygon triangulates with n - 2 triangles', () => {
        const renderer = makeRenderer();
        const graph = renderer.createGraph();
        renderer.attachToStage(graph);
        // An arrow-head: clearly concave.
        graph.drawPolygon(0, NO_STROKE, WHITE, [0, 0, 20, 0, 20, 20, 10, 8, 0, 20]);
        renderer.update();
        expect(graph.babNode.getIndices()!.length / 3).toBe(3);
    });

    test('a stroke adds one quad per segment', () => {
        const renderer = makeRenderer();
        const graph = renderer.createGraph();
        renderer.attachToStage(graph);
        graph.drawRect(4, new Color(0, 0, 0, 255), NO_STROKE, 0, 0, 10, 10);
        renderer.update();
        expect(graph.babNode.getTotalVertices()).toBe(16);
        expect(graph.babNode.getIndices()?.length).toBe(24);
    });

    test('clear drops everything', () => {
        const renderer = makeRenderer();
        const graph = renderer.createGraph();
        renderer.attachToStage(graph);
        graph.drawRect(0, NO_STROKE, WHITE, 0, 0, 10, 10);
        renderer.update();
        expect(graph.babNode.getTotalVertices()).toBe(4);

        graph.clear();
        renderer.update();
        expect(graph.babNode.getTotalVertices()).toBe(0);
    });

    test('vertex colours carry each shape its own fill', () => {
        const renderer = makeRenderer();
        const graph = renderer.createGraph();
        renderer.attachToStage(graph);
        graph.drawRect(0, NO_STROKE, new Color(255, 0, 0, 255), 0, 0, 10, 10);
        graph.drawRect(0, NO_STROKE, new Color(0, 0, 255, 255), 20, 0, 10, 10);
        renderer.update();

        const colors = Array.from(graph.babNode.getVerticesData(VertexBuffer.ColorKind)!);
        expect(colors.slice(0, 4)).toEqual([1, 0, 0, 1]);
        expect(colors.slice(16, 20)).toEqual([0, 0, 1, 1]);
    });

    test('a transparent stroke draws nothing', () => {
        const renderer = makeRenderer();
        const graph = renderer.createGraph();
        renderer.attachToStage(graph);
        graph.drawRect(4, NO_STROKE, WHITE, 0, 0, 10, 10);
        renderer.update();
        expect(graph.babNode.getTotalVertices()).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// factory surface
// ---------------------------------------------------------------------------

describe('IRenderFactory surface', () => {
    test('exposes the four stage members the core expects', () => {
        const renderer = createBabylonRenderer({ width: 128, height: 64 });
        expect(typeof renderer.attachToStage).toBe('function');
        expect(typeof renderer.onViewportResize).toBe('function');
        expect(renderer.viewportWidth).toBe(128);
        expect(renderer.viewportHeight).toBe(64);
    });

    test('createObject/createImage/createText/createGraph return usable objects', () => {
        const renderer = makeRenderer();
        const objects = [
            renderer.createObject(),
            renderer.createImage(),
            renderer.createText(),
            renderer.createGraph(),
        ];
        for (const obj of objects) {
            expect(obj.parent).toBeNull();
            expect(obj.numChildren).toBe(0);
            expect(obj.visible).toBe(true);
            expect(obj.alpha).toBe(1);
            expect(typeof obj.localToGlobal(1, 2).x).toBe('number');
        }
        expect(new BabImageObject(renderer, 'x')).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// UI camera
// ---------------------------------------------------------------------------

describe('UI camera', () => {
    test('is positioned, not left at the origin', () => {
        // A base `Camera` does not implement `_getViewMatrix`, so it leaves the
        // view matrix as the identity and the camera's position never reaches
        // the shader. The orthographic projection expects view-space z inside
        // `[minZ, maxZ]`, so with an identity view every UI vertex falls outside
        // the frustum and the whole display list is clipped away — silently, and
        // with every other thing about the meshes still looking correct.
        const renderer = createBabylonRenderer({ width: 1280, height: 800 });
        renderer.camera.getViewMatrix(true);

        expect(renderer.camera.getViewMatrix().m[14], 'pushed back along -z').toBeCloseTo(1000, 3);
    });

    test('projects the UI box inside the frustum', () => {
        // The end-to-end property the previous test is a proxy for: take points
        // on the UI plane, push them through the camera, and check they land in
        // the clip volume. Anything outside `[-1, 1]` in z is culled.
        const renderer = createBabylonRenderer({ width: 1280, height: 800 });
        const camera = renderer.camera;
        camera.getViewMatrix(true);
        const viewProjection = camera.getViewMatrix().multiply(camera.getProjectionMatrix(true));

        // The root carries `scaling = (1, -1, 1)`, so UI (x, y) is world (x, -y).
        const corners = [
            new Vector3(0, 0, 0),
            new Vector3(1280, 0, 0),
            new Vector3(0, -800, 0),
            new Vector3(1280, -800, 0),
        ];

        for (const corner of corners) {
            const label = `world (${corner.x}, ${corner.y})`;
            const ndc = Vector3.TransformCoordinates(corner, viewProjection);
            expect(Number.isFinite(ndc.x), `${label}: finite`).toBe(true);
            expect(ndc.x, `${label}: ndc.x lower`).toBeGreaterThanOrEqual(-1.0001);
            expect(ndc.x, `${label}: ndc.x upper`).toBeLessThanOrEqual(1.0001);
            expect(ndc.y, `${label}: ndc.y lower`).toBeGreaterThanOrEqual(-1.0001);
            expect(ndc.y, `${label}: ndc.y upper`).toBeLessThanOrEqual(1.0001);
            // The depth range is what the identity view matrix used to break.
            expect(ndc.z, `${label}: ndc.z lower`).toBeGreaterThanOrEqual(-1);
            expect(ndc.z, `${label}: ndc.z upper`).toBeLessThanOrEqual(1);
        }
    });
});

// ---------------------------------------------------------------------------
// atlas loading
// ---------------------------------------------------------------------------

describe('atlas loading', () => {
    test('an image waits for the atlas and re-derives its UVs', () => {
        // A `Texture` exists before its image does, and `getSize()` reports a
        // placeholder until then. UVs built from that placeholder divide the
        // pixel coordinates by one and land far outside [0, 1], which samples
        // the wrong region — and the geometry is built once and cached, so
        // nothing would ever correct them.
        const renderer = makeRenderer();
        const image = renderer.createImage();
        renderer.attachToStage(image);

        const atlas = new FakeAtlas();
        image.setSprite(atlas, new Rect(64, 32, 32, 16), false);
        image.setContentSize(32, 16);
        image.commitGeometry();

        // Nothing is drawn while the dimensions are still placeholders.
        expect(image.babNode.getTotalVertices(), 'nothing drawn yet').toBe(0);

        // The real atlas turns out to be 512x512.
        atlas.width = 512;
        atlas.height = 512;
        atlas.ready = true;
        image.commitGeometry();

        const uv = uvsOf(image);
        expect(uv.length, 'the quad appears once the atlas does').toBeGreaterThan(0);
        expect(uv[0], 'u0').toBeCloseTo(64 / 512, 6);
        expect(uv[1], 'v0').toBeCloseTo(32 / 512, 6);
        expect(uv[4], 'u1').toBeCloseTo(96 / 512, 6);
    });

    test('an explicit handle keeps the size the caller gave it', () => {
        // A caller that hands in `{ texture, width, height }` has already sliced
        // the region; the texture loading must not overwrite that.
        const renderer = makeRenderer();
        const image = renderer.createImage();
        renderer.attachToStage(image);

        const atlas = new FakeAtlas();
        atlas.width = 512;
        atlas.height = 512;
        image.setSprite({ texture: atlas, width: 256, height: 256 }, new Rect(0, 0, 32, 16), false);
        image.setContentSize(32, 16);
        image.commitGeometry();

        const before = uvsOf(image);
        atlas.onLoadObservable.notifyObservers(atlas as unknown as BaseTexture);
        image.commitGeometry();

        expect(uvsOf(image)).toEqual(before);
    });
});

// ---------------------------------------------------------------------------
// per-object materials
// ---------------------------------------------------------------------------

describe('per-object materials', () => {
    test('two objects never share a material', () => {
        // `uTexture` is a per-object uniform, and a material can only hold one
        // value for it: Babylon caches the sampler on the material, so every
        // mesh drawing with a shared one samples whichever texture was set
        // last. That makes objects render with each other's images — most
        // visibly text, where every label ends up showing the same glyphs.
        const renderer = makeRenderer();
        const first = renderer.createImage();
        const second = renderer.createImage();

        const images = [first, second];
        for (let i = 0; i < images.length; i++) {
            const image = images[i];
            image.setSprite(spriteHandle(renderer), new Rect(0, i * 16, 32, 16), false);
            image.setContentSize(32, 16);
            renderer.attachToStage(image);
            image.commitGeometry();
        }

        expect(first.babNode.material, 'the first object has a material').toBeTruthy();
        expect(second.babNode.material, 'the second object has a material').toBeTruthy();
        expect(first.babNode.material).not.toBe(second.babNode.material);
    });
});

describe('draw order', () => {
    test('display-list order reaches the mesh as alphaIndex', () => {
        // The UI material does not write depth — everything is blended — so
        // `alphaIndex` is the only thing deciding what covers what. Left at its
        // default of zero, Babylon falls back to creation order, and a button's
        // background ends up drawn over the title it carries.
        const renderer = makeRenderer();
        const root = renderer.createObject();
        renderer.attachToStage(root);

        const make = (): BabImageObject => {
            const image = renderer.createImage();
            image.setSprite(spriteHandle(renderer), new Rect(0, 0, 8, 8), false);
            image.setContentSize(8, 8);
            return image;
        };

        const behind = make();
        const front = make();
        root.addChild(behind);
        root.addChild(front);

        renderer.update();

        expect(front.babNode.alphaIndex, 'the later sibling draws later')
            .toBeGreaterThan(behind.babNode.alphaIndex);
        expect(behind.drawOrder).toBeLessThan(front.drawOrder);
    });
});

// ---------------------------------------------------------------------------
// external content
// ---------------------------------------------------------------------------

/** A stand-in for the browser's `Image`, driven by the test. */
class FakeImage {
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    public naturalWidth = 32;
    public naturalHeight = 16;
    public src = '';

    public static created: string[] = [];
    public static fail = false;

    public constructor() {
        FakeImage.created.push('');
    }

    /** Fires the load handlers the way a real element would, asynchronously. */
    public static settle(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }
}

describe('external content loading', () => {
    let original: unknown;

    beforeEach(() => {
        original = (globalThis as Record<string, unknown>)['Image'];
        FakeImage.created = [];
        FakeImage.fail = false;

        (globalThis as Record<string, unknown>)['Image'] = class {
            public onload: (() => void) | null = null;
            public onerror: (() => void) | null = null;
            public naturalWidth = 32;
            public naturalHeight = 16;
            public set src(value: string) {
                FakeImage.created.push(value);
                setTimeout(() => (FakeImage.fail ? this.onerror?.() : this.onload?.()), 0);
            }
        };
    });

    afterEach(() => {
        (globalThis as Record<string, unknown>)['Image'] = original;
    });

    test('reports the source size the layout needs', async () => {
        // `GLoader` sizes and aligns its content from these numbers, and a
        // Babylon `Texture` cannot report them until the pixels have arrived.
        const renderer = createBabylonRenderer({ width: 100, height: 100 });
        let result: { err: Error | null; content: { width: number; height: number } | null } | null = null;

        renderer.packageAssets.loadExternal('/icons/i0.png', (err, content) => {
            result = { err, content: content as { width: number; height: number } | null };
        });
        await FakeImage.settle();

        expect(result).not.toBeNull();
        expect(result!.err).toBeNull();
        expect(result!.content).toMatchObject({ width: 32, height: 16 });
    });

    test('a URL is fetched once and reused', async () => {
        const renderer = createBabylonRenderer({ width: 100, height: 100 });

        renderer.packageAssets.loadExternal('/icons/i1.png', () => {});
        await FakeImage.settle();
        renderer.packageAssets.loadExternal('/icons/i1.png', () => {});

        expect(FakeImage.created).toEqual(['/icons/i1.png']);
    });

    test('a failed load reports an error so the error sign can show', async () => {
        const renderer = createBabylonRenderer({ width: 100, height: 100 });
        FakeImage.fail = true;

        let err: Error | null = null;
        renderer.packageAssets.loadExternal('/icons/missing.png', (e) => { err = e; });
        await FakeImage.settle();

        expect(err).toBeTruthy();
        expect((err as unknown as Error).message).toContain('/icons/missing.png');
    });
});

/**
 * A `document` just rich enough for the text overlay.
 *
 * The overlay is the only thing in the backend that touches the DOM, and it does
 * so through a structurally declared shape — so a plain object stands in for it,
 * which is what lets the enable/disable hand-off be tested headlessly.
 */
function installFakeDocument(): { restore(): void } {
    const original = (globalThis as { document?: unknown }).document;

    const makeElement = (): Record<string, unknown> => {
        const element: Record<string, unknown> = {
            value: '',
            style: {} as Record<string, string>,
            addEventListener() { /* nothing to deliver */ },
            removeEventListener() { /* nothing was delivered */ },
            focus() { /* nothing to focus */ },
            remove() { /* nothing to detach from */ },
            setSelectionRange() { /* nothing to select */ },
        };
        return element;
    };

    (globalThis as { document?: unknown }).document = {
        body: { append() { /* no page to append to */ } },
        createElement: makeElement,
        addEventListener() { /* no clicking outside in a test */ },
        removeEventListener() { /* nothing was added */ },
    };

    return {
        restore: () => {
            (globalThis as { document?: unknown }).document = original;
        },
    };
}
