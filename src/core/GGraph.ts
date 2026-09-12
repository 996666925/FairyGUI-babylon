import { GObject } from './GObject.js';
import { ObjectPropID } from './FieldTypes.js';
import { Color } from './utils/Color.js';
import { getRenderFactory, type IGraphObject, type IRenderObject } from './render/IRenderObject.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { Point } from './utils/Geometry.js';

/** `GGraph` shape kinds, as stored by the editor. */
export enum GraphType {
    Empty = 0,
    Rect = 1,
    Ellipse = 2,
    Polygon = 3,
    RegularPolygon = 4,
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * What the drawing methods accept for a colour.
 *
 * FairyGUI's documented API passes CSS-style strings — `graph.drawRect(1,
 * "#000000", "#FF0000")` — so those have to work alongside a `Color`.
 */
export type ColorLike = Color | string | number;

function toColor(value: ColorLike, fallback: Color): Color {
    if (value instanceof Color)
        return value;
    return Color.parse(value) ?? fallback;
}

/**
 * A shape drawn procedurally: rectangle, ellipse, or polygon.
 *
 * Geometry is rebuilt whenever the size, pivot, or shape parameters change.
 * All offsets are computed in FairyGUI's y-down local space, where the render
 * node's origin sits at the object's pivot — so the box's top-left corner is at
 * `(-pivotX * width, -pivotY * height)`. The reference computed the same
 * offsets in Cocos' y-up space, which is why its expressions flip the sign of
 * every y term.
 *
 * Rounded rectangles honour all four stored corner radii. The Cocos reference
 * passed only `cornerRadius[0]` to `cc.Graphics.roundRect`, silently squaring
 * off three corners the editor had rounded, so this diverges deliberately.
 */
export class GGraph extends GObject {
    public _content: IGraphObject;

    private _type: GraphType = GraphType.Empty;
    private _lineSize = 1;
    private _lineColor = new Color();
    private _fillColor = new Color(255, 255, 255, 255);
    private _cornerRadius: number[] | null = null;
    private _sides = 0;
    private _startAngle = 0;
    private _polygonPoints: number[] | null = null;
    private _distances: number[] | null = null;
    private _hasContent = false;

    public constructor() {
        super();
        this._content = this._node as IGraphObject;
    }

    protected createDisplayObject(): IRenderObject {
        return getRenderFactory().createGraph();
    }

    /** Graphs are the other shape kind usable as a stencil. */
    public get isShapeMask(): boolean {
        return true;
    }

    public get type(): number {
        return this._type;
    }

    public get color(): Color {
        return this._fillColor;
    }

    public set color(value: ColorLike) {
        this._fillColor.copy(toColor(value, this._fillColor));
        if (this._type !== GraphType.Empty)
            this.updateGraph();
    }

    public get distances(): number[] | null {
        return this._distances;
    }

    public set distances(value: number[] | null) {
        this._distances = value;
        if (this._type === GraphType.Polygon)
            this.updateGraph();
    }

    public drawRect(lineSize: number, lineColor: ColorLike, fillColor: ColorLike, corner?: number[]): void {
        this._type = GraphType.Rect;
        this._lineSize = lineSize;
        this._lineColor.copy(toColor(lineColor, this._lineColor));
        this._fillColor.copy(toColor(fillColor, this._fillColor));
        this._cornerRadius = corner ?? null;
        this.updateGraph();
    }

    public drawEllipse(lineSize: number, lineColor: ColorLike, fillColor: ColorLike): void {
        this._type = GraphType.Ellipse;
        this._lineSize = lineSize;
        this._lineColor.copy(toColor(lineColor, this._lineColor));
        this._fillColor.copy(toColor(fillColor, this._fillColor));
        this.updateGraph();
    }

    public drawRegularPolygon(
        lineSize: number, lineColor: ColorLike, fillColor: ColorLike,
        sides: number, startAngle = 0, distances?: number[],
    ): void {
        this._type = GraphType.RegularPolygon;
        this._lineSize = lineSize;
        this._lineColor.copy(toColor(lineColor, this._lineColor));
        this._fillColor.copy(toColor(fillColor, this._fillColor));
        this._sides = sides;
        this._startAngle = startAngle;
        this._distances = distances ?? null;
        this.updateGraph();
    }

    public drawPolygon(lineSize: number, lineColor: ColorLike, fillColor: ColorLike, points: number[]): void {
        this._type = GraphType.Polygon;
        this._lineSize = lineSize;
        this._lineColor.copy(toColor(lineColor, this._lineColor));
        this._fillColor.copy(toColor(fillColor, this._fillColor));
        this._polygonPoints = points;
        this.updateGraph();
    }

    public clearGraphics(): void {
        this._type = GraphType.Empty;
        if (this._hasContent) {
            this._content.clear();
            this._hasContent = false;
        }
    }

    private updateGraph(): void {
        const ctx = this._content;
        if (this._hasContent) {
            this._hasContent = false;
            ctx.clear();
        }

        const w = this._width;
        const h = this._height;
        if (w === 0 || h === 0)
            return;

        // The node's origin is the pivot, so the box starts here.
        const px = -this.pivotX * this._width;
        const py = -this.pivotY * this._height;

        // Inset by half the stroke so the outline stays inside the box.
        const ls = this._lineSize / 2;

        if (this._type === GraphType.Rect) {
            if (this._cornerRadius) {
                ctx.drawRoundRect(
                    this._lineSize, this._lineColor, this._fillColor,
                    px + ls, py + ls, w - this._lineSize, h - this._lineSize,
                    this._cornerRadius,
                );
            } else {
                ctx.drawRect(
                    this._lineSize, this._lineColor, this._fillColor,
                    px + ls, py + ls, w - this._lineSize, h - this._lineSize,
                );
            }
        } else if (this._type === GraphType.Ellipse) {
            ctx.drawEllipse(
                this._lineSize, this._lineColor, this._fillColor,
                px + ls, py + ls, w - this._lineSize, h - this._lineSize,
            );
        } else if (this._type === GraphType.Polygon) {
            ctx.drawPolygon(this._lineSize, this._lineColor, this._fillColor,
                this.offsetPoints(this._polygonPoints ?? [], px, py), this._fillColor.a / 255);
        } else if (this._type === GraphType.RegularPolygon) {
            this._polygonPoints ??= [];
            const radius = Math.min(w, h) / 2 - ls;
            this._polygonPoints.length = 0;

            let angle = this._startAngle * DEG_TO_RAD;
            const deltaAngle = 2 * Math.PI / this._sides;
            for (let i = 0; i < this._sides; i++) {
                let dist = this._distances?.[i] ?? 1;
                if (isNaN(dist))
                    dist = 1;

                this._polygonPoints.push(
                    radius + radius * dist * Math.cos(angle),
                    radius + radius * dist * Math.sin(angle),
                );
                angle += deltaAngle;
            }

            ctx.drawPolygon(this._lineSize, this._lineColor, this._fillColor,
                this.offsetPoints(this._polygonPoints, px, py), this._fillColor.a / 255);
        }

        this._hasContent = true;
    }

    /**
     * Shifts authored polygon points into the node's local space.
     *
     * The editor stores polygon points in a y-down space already, so the y term
     * only needs the pivot offset — not a negation. (The reference negated it
     * because Cocos draws y-up.)
     */
    private offsetPoints(points: number[], px: number, py: number): number[] {
        const out = new Array<number>(points.length);
        for (let i = 0; i < points.length; i += 2) {
            out[i] = points[i] + px;
            out[i + 1] = points[i + 1] + py;
        }
        return out;
    }

    protected handleSizeChanged(): void {
        super.handleSizeChanged();
        if (this._type !== GraphType.Empty)
            this.updateGraph();
    }

    protected onMoved(): void {
        if (this._type !== GraphType.Empty)
            this.updateGraph();
    }

    public getProp(index: number): unknown {
        if (index === ObjectPropID.Color)
            return this.color;
        return super.getProp(index);
    }

    public setProp(index: number, value: unknown): void {
        if (index === ObjectPropID.Color)
            this.color = value instanceof Color ? value : Color.parse(value as string) ?? this.color;
        else
            super.setProp(index, value);
    }

    protected _hitTest(pt: Point, _globalPt: Point): GObject | null {
        if (!this._node.hitTest(pt.x, pt.y))
            return null;

        if (this._type === GraphType.Polygon) {
            // Even-odd crossing count against the authored points.
            const points = this._polygonPoints ?? [];
            const len = points.length / 2;
            let j = len - 1;
            let oddNodes = false;

            for (let i = 0; i < len; ++i) {
                const ix = points[i * 2];
                const iy = points[i * 2 + 1];
                const jx = points[j * 2];
                const jy = points[j * 2 + 1];

                if ((iy < pt.y && jy >= pt.y || jy < pt.y && iy >= pt.y) && (ix <= pt.x || jx <= pt.x)) {
                    if (ix + (pt.y - iy) / (jy - iy) * (jx - ix) < pt.x)
                        oddNodes = !oddNodes;
                }
                j = i;
            }

            return oddNodes ? this : null;
        }

        return this;
    }

    public setup_beforeAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_beforeAdd(buffer, beginPos);

        buffer.seek(beginPos, 5);

        this._type = buffer.readByte();
        if (this._type === GraphType.Empty)
            return;

        this._lineSize = buffer.readInt();
        this._lineColor = buffer.readColor(true);
        this._fillColor = buffer.readColor(true);

        if (buffer.readBool()) {
            this._cornerRadius = new Array<number>(4);
            for (let i = 0; i < 4; i++)
                this._cornerRadius[i] = buffer.readFloat();
        }

        if (this._type === GraphType.Polygon) {
            const cnt = buffer.readShort();
            this._polygonPoints = new Array<number>(cnt);
            for (let i = 0; i < cnt; i++)
                this._polygonPoints[i] = buffer.readFloat();
        } else if (this._type === GraphType.RegularPolygon) {
            this._sides = buffer.readShort();
            this._startAngle = buffer.readFloat();
            const cnt = buffer.readShort();
            if (cnt > 0) {
                this._distances = new Array<number>(cnt);
                for (let i = 0; i < cnt; i++)
                    this._distances[i] = buffer.readFloat();
            }
        }

        this.updateGraph();
    }
}
