import { Color } from '../core/utils/Color.js';
import type { IGraphObject } from '../core/render/IRenderObject.js';
import { BabRenderObject } from './BabRenderObject.js';
import type { BabylonRenderer } from './BabylonRenderer.js';
import {
    ellipsePath,
    GeometryBuilder,
    roundRectPath,
    strokePolyline,
    triangulatePolygon,
} from './GeometryBuilder.js';

/**
 * One accumulated drawing command.
 *
 * `GGraph` redraws wholesale (`clear()` then a sequence of `draw*`), so the
 * shapes are kept as a small command list and replayed into triangles whenever
 * anything changes. That keeps the mesh a single draw call while still giving
 * every shape its own fill and stroke colour, carried by the per-vertex colour
 * attribute.
 */
interface Shape {
    /** Flat `[x0, y0, x1, y1, …]`, in content space. */
    points: number[];
    fill: Color | null;
    stroke: Color | null;
    lineSize: number;
    /** Whether the outline closes back to its first point. Only affects the stroke. */
    closed: boolean;
}

/**
 * Vector drawing surface for `GGraph`.
 *
 * Everything is triangulated on the CPU: fills go through ear clipping (so
 * concave polygons work), strokes become one quad per segment, and round corners
 * and ellipses are flattened into rings. No sprite masks or shader tricks are
 * involved, which is what makes the result survive rotation and skew.
 */
export class BabGraphObject extends BabRenderObject implements IGraphObject {
    private readonly _shapes: Shape[] = [];
    /** Scratch indices for triangulation, remapped to builder vertex ids. */
    private readonly _indices: number[] = [];

    public constructor(renderer: BabylonRenderer, name: string) {
        super(renderer, name);
        this.color = new Color(255, 255, 255, 255);
    }

    public clear(): void {
        this._shapes.length = 0;
        this.invalidateGeometry();
    }

    public drawRect(
        lineSize: number, lineColor: Color, fillColor: Color,
        x: number, y: number, w: number, h: number,
    ): void {
        // On-screen clockwise from the top-left.
        this._push({
            points: [x, y, x + w, y, x + w, y + h, x, y + h],
            fill: fillColor,
            stroke: lineColor,
            lineSize,
            closed: true,
        });
    }

    public drawRoundRect(
        lineSize: number, lineColor: Color, fillColor: Color,
        x: number, y: number, w: number, h: number,
        corners: Array<number | null>,
    ): void {
        this._push({
            points: roundRectPath(x, y, w, h, corners),
            fill: fillColor,
            stroke: lineColor,
            lineSize,
            closed: true,
        });
    }

    public drawEllipse(
        lineSize: number, lineColor: Color, fillColor: Color,
        x: number, y: number, w: number, h: number,
    ): void {
        this._push({
            points: ellipsePath(x + w / 2, y + h / 2, w / 2, h / 2, ellipseSegments(w, h)),
            fill: fillColor,
            stroke: lineColor,
            lineSize,
            closed: true,
        });
    }

    public drawPolygon(
        lineSize: number, lineColor: Color, fillColor: Color,
        points: number[], fillAlpha?: number,
    ): void {
        this._push({
            points: points.slice(),
            fill: withAlpha(fillColor, fillAlpha),
            stroke: lineColor,
            lineSize,
            closed: true,
        });
    }

    public drawPath(
        lineSize: number, lineColor: Color, fillColor: Color,
        points: number[], fillAlpha?: number,
    ): void {
        // A path is an open outline: it fills as if closed (matching every other
        // runtime's `Graphics.drawPath`) but strokes without a closing segment.
        this._push({
            points: points.slice(),
            fill: withAlpha(fillColor, fillAlpha),
            stroke: lineColor,
            lineSize,
            closed: false,
        });
    }

    private _push(shape: Shape): void {
        this._shapes.push(shape);
        this.invalidateGeometry();
    }

    // ---- geometry --------------------------------------------------------

    protected override buildGeometry(builder: GeometryBuilder): void {
        for (const shape of this._shapes)
            this.emitShape(builder, shape);
    }

    private emitShape(builder: GeometryBuilder, shape: Shape): void {
        const points = shape.points;
        const n = points.length / 2;
        if (n < 2)
            return;

        if (shape.fill && shape.fill.a > 0 && n >= 3) {
            setVertexColor(builder, shape.fill);
            const first = builder.vertexCount;
            for (let i = 0; i < n; i++)
                builder.addVertex(points[i * 2], points[i * 2 + 1], 0.5, 0.5);

            this._indices.length = 0;
            triangulatePolygon(points, this._indices);
            for (let i = 0; i < this._indices.length; i++)
                builder.indices.push(first + this._indices[i]);
        }

        if (shape.stroke && shape.stroke.a > 0 && shape.lineSize > 0) {
            setVertexColor(builder, shape.stroke);
            strokePolyline(builder, points, shape.closed, shape.lineSize);
        }
    }
}

function setVertexColor(builder: GeometryBuilder, color: Color): void {
    builder.setVertexColor(color.r / 255, color.g / 255, color.b / 255, color.a / 255);
}

function withAlpha(color: Color, fillAlpha: number | undefined): Color {
    if (color == null || fillAlpha === undefined)
        return color;
    return new Color(color.r, color.g, color.b, Math.round(color.a * Math.max(0, Math.min(1, fillAlpha))));
}

/** How far the outline of a curve may sit from the curve itself, in UI pixels. */
const CURVE_TOLERANCE = 0.1;
/** Bounds on the segment count, so a dot stays cheap and a huge ellipse stays sane. */
const CURVE_MIN_SEGMENTS = 12;
const CURVE_MAX_SEGMENTS = 200;

/**
 * Segment count for an ellipse.
 *
 * Driven by how far the flat sides are allowed to stray from the circle, not by
 * the radius: `n` segments bulge out by `r·(1 - cos(π/n))`, so solving that for
 * {@link CURVE_TOLERANCE} gives `π / acos(1 - tolerance / r)`.
 *
 * A count proportional to the radius cannot do this — the number that suits a
 * 200px ellipse is one segment per 7px, which turns a 15px pagination dot into
 * an octagon.
 */
function ellipseSegments(w: number, h: number): number {
    const r = Math.max(Math.abs(w), Math.abs(h)) / 2;
    if (r <= 0)
        return CURVE_MIN_SEGMENTS;

    const bulge = Math.max(-1, Math.min(1, 1 - CURVE_TOLERANCE / r));
    const steps = Math.PI / Math.acos(bulge);
    return Math.max(CURVE_MIN_SEGMENTS, Math.min(CURVE_MAX_SEGMENTS, Math.ceil(steps)));
}
