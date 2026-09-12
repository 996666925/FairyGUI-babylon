import { Point } from '../utils/Geometry.js';
import { ToolSet } from '../utils/ToolSet.js';
import { CurveType, GPathPoint } from './GPathPoint.js';

/**
 * A piecewise path built from `GPathPoint`s, sampled by `getPointAt` with `t`
 * normalised over the *length* of the path (not over the curve parameter).
 */
export class GPath {
    private _segments: Array<Segment>;
    private _points: Array<Point>;
    private _fullLength: number;

    public constructor() {
        this._segments = new Array<Segment>();
        this._points = new Array<Point>();
        this._fullLength = 0;
    }

    public get length(): number {
        return this._fullLength;
    }

    public create(pt1: Array<GPathPoint> | GPathPoint, pt2?: GPathPoint, pt3?: GPathPoint, pt4?: GPathPoint): void {
        let points: Array<GPathPoint>;
        if (Array.isArray(pt1))
            points = pt1;
        else {
            points = new Array<GPathPoint>();
            points.push(pt1);
            points.push(pt2 as GPathPoint);
            if (pt3)
                points.push(pt3);
            if (pt4)
                points.push(pt4);
        }

        this._segments.length = 0;
        this._points.length = 0;
        this._fullLength = 0;

        const cnt: number = points.length;
        if (cnt == 0)
            return;

        const splinePoints: Array<Point> = s_points;
        splinePoints.length = 0;

        let prev: GPathPoint = points[0];
        if (prev.curveType == CurveType.CRSpline)
            splinePoints.push(new Point(prev.x, prev.y));

        for (let i: number = 1; i < cnt; i++) {
            const current: GPathPoint = points[i];

            if (prev.curveType != CurveType.CRSpline) {
                const seg: Segment = createSegment();
                seg.type = prev.curveType;
                seg.ptStart = this._points.length;
                if (prev.curveType == CurveType.Straight) {
                    seg.ptCount = 2;
                    this._points.push(new Point(prev.x, prev.y));
                    this._points.push(new Point(current.x, current.y));
                }
                else if (prev.curveType == CurveType.Bezier) {
                    seg.ptCount = 3;
                    this._points.push(new Point(prev.x, prev.y));
                    this._points.push(new Point(current.x, current.y));
                    this._points.push(new Point(prev.control1_x, prev.control1_y));
                }
                else if (prev.curveType == CurveType.CubicBezier) {
                    seg.ptCount = 4;
                    this._points.push(new Point(prev.x, prev.y));
                    this._points.push(new Point(current.x, current.y));
                    this._points.push(new Point(prev.control1_x, prev.control1_y));
                    this._points.push(new Point(prev.control2_x, prev.control2_y));
                }
                seg.length = ToolSet.distance(prev.x, prev.y, current.x, current.y);
                this._fullLength += seg.length;
                this._segments.push(seg);
            }

            if (current.curveType != CurveType.CRSpline) {
                if (splinePoints.length > 0) {
                    splinePoints.push(new Point(current.x, current.y));
                    this.createSplineSegment();
                }
            }
            else
                splinePoints.push(new Point(current.x, current.y));

            prev = current;
        }

        if (splinePoints.length > 1)
            this.createSplineSegment();
    }

    private createSplineSegment(): void {
        const splinePoints: Array<Point> = s_points;
        let cnt: number = splinePoints.length;
        splinePoints.splice(0, 0, splinePoints[0]);
        splinePoints.push(splinePoints[cnt]);
        splinePoints.push(splinePoints[cnt]);
        cnt += 3;

        const seg: Segment = createSegment();
        seg.type = CurveType.CRSpline;
        seg.ptStart = this._points.length;
        seg.ptCount = cnt;

        this._points = this._points.concat(splinePoints);

        seg.length = 0;
        for (let i: number = 1; i < cnt; i++) {
            seg.length += ToolSet.distance(splinePoints[i - 1].x, splinePoints[i - 1].y,
                splinePoints[i].x, splinePoints[i].y);
        }
        this._fullLength += seg.length;
        this._segments.push(seg);
        splinePoints.length = 0;
    }

    public clear(): void {
        this._segments.length = 0;
        this._points.length = 0;
    }

    public getPointAt(t: number, result?: Point): Point {
        if (!result)
            result = new Point();
        else
            result.x = result.y = 0;

        t = ToolSet.clamp01(t);
        const cnt: number = this._segments.length;
        if (cnt == 0) {
            return result;
        }

        let seg: Segment;
        if (t == 1) {
            seg = this._segments[cnt - 1];

            if (seg.type == CurveType.Straight) {
                result.x = ToolSet.lerp(this._points[seg.ptStart].x, this._points[seg.ptStart + 1].x, t);
                result.y = ToolSet.lerp(this._points[seg.ptStart].y, this._points[seg.ptStart + 1].y, t);

                return result;
            }
            else if (seg.type == CurveType.Bezier || seg.type == CurveType.CubicBezier)
                return this.onBezierCurve(seg.ptStart, seg.ptCount, t, result);
            else
                return this.onCRSplineCurve(seg.ptStart, seg.ptCount, t, result);
        }

        let len: number = t * this._fullLength;
        for (let i: number = 0; i < cnt; i++) {
            seg = this._segments[i];

            len -= seg.length;
            if (len < 0) {
                t = 1 + len / seg.length;

                if (seg.type == CurveType.Straight) {
                    result.x = ToolSet.lerp(this._points[seg.ptStart].x, this._points[seg.ptStart + 1].x, t);
                    result.y = ToolSet.lerp(this._points[seg.ptStart].y, this._points[seg.ptStart + 1].y, t);
                }
                else if (seg.type == CurveType.Bezier || seg.type == CurveType.CubicBezier)
                    result = this.onBezierCurve(seg.ptStart, seg.ptCount, t, result);
                else
                    result = this.onCRSplineCurve(seg.ptStart, seg.ptCount, t, result);

                break;
            }
        }

        return result;
    }

    public get segmentCount(): number {
        return this._segments.length;
    }

    public getAnchorsInSegment(segmentIndex: number, points?: Array<Point>): Array<Point> {
        if (points == null)
            points = new Array<Point>();

        const seg: Segment = this._segments[segmentIndex];
        for (let i: number = 0; i < seg.ptCount; i++)
            points.push(new Point(this._points[seg.ptStart + i].x, this._points[seg.ptStart + i].y));

        return points;
    }

    public getPointsInSegment(segmentIndex: number, t0: number, t1: number, points?: Array<Point>, ts?: Array<number>, pointDensity?: number): Array<Point> {
        if (points == null)
            points = new Array<Point>();
        if (!pointDensity || isNaN(pointDensity))
            pointDensity = 0.1;

        if (ts)
            ts.push(t0);
        const seg: Segment = this._segments[segmentIndex];
        if (seg.type == CurveType.Straight) {
            points.push(new Point(ToolSet.lerp(this._points[seg.ptStart].x, this._points[seg.ptStart + 1].x, t0),
                ToolSet.lerp(this._points[seg.ptStart].y, this._points[seg.ptStart + 1].y, t0)));
            points.push(new Point(ToolSet.lerp(this._points[seg.ptStart].x, this._points[seg.ptStart + 1].x, t1),
                ToolSet.lerp(this._points[seg.ptStart].y, this._points[seg.ptStart + 1].y, t1)));
        }
        else {
            let func: Function;
            if (seg.type == CurveType.Bezier || seg.type == CurveType.CubicBezier)
                func = this.onBezierCurve;
            else
                func = this.onCRSplineCurve;

            points.push(func.call(this, seg.ptStart, seg.ptCount, t0, new Point()));
            const SmoothAmount: number = Math.min(seg.length * pointDensity, 50);
            for (let j: number = 0; j <= SmoothAmount; j++) {
                const t: number = j / SmoothAmount;
                if (t > t0 && t < t1) {
                    points.push(func.call(this, seg.ptStart, seg.ptCount, t, new Point()));
                    if (ts != null)
                        ts.push(t);
                }
            }
            points.push(func.call(this, seg.ptStart, seg.ptCount, t1, new Point()));
        }

        if (ts != null)
            ts.push(t1);

        return points;
    }

    public getAllPoints(points?: Array<Point>, ts?: Array<number>, pointDensity?: number): Array<Point> {
        if (points == null)
            points = new Array<Point>();
        if (!pointDensity || isNaN(pointDensity))
            pointDensity = 0.1;

        const cnt: number = this._segments.length;
        for (let i: number = 0; i < cnt; i++)
            this.getPointsInSegment(i, 0, 1, points, ts, pointDensity);

        return points;
    }

    private onCRSplineCurve(ptStart: number, ptCount: number, t: number, result: Point): Point {
        const adjustedIndex: number = Math.floor(t * (ptCount - 4)) + ptStart; //Since the equation works with 4 points, we adjust the starting point depending on t to return a point on the specific segment

        const p0x: number = this._points[adjustedIndex].x;
        const p0y: number = this._points[adjustedIndex].y;
        const p1x: number = this._points[adjustedIndex + 1].x;
        const p1y: number = this._points[adjustedIndex + 1].y;
        const p2x: number = this._points[adjustedIndex + 2].x;
        const p2y: number = this._points[adjustedIndex + 2].y;
        const p3x: number = this._points[adjustedIndex + 3].x;
        const p3y: number = this._points[adjustedIndex + 3].y;

        const adjustedT: number = (t == 1) ? 1 : ToolSet.repeat(t * (ptCount - 4), 1); // Then we adjust t to be that value on that new piece of segment... for t == 1f don't use repeat (that would return 0f);

        const t0: number = ((-adjustedT + 2) * adjustedT - 1) * adjustedT * 0.5;
        const t1: number = (((3 * adjustedT - 5) * adjustedT) * adjustedT + 2) * 0.5;
        const t2: number = ((-3 * adjustedT + 4) * adjustedT + 1) * adjustedT * 0.5;
        const t3: number = ((adjustedT - 1) * adjustedT * adjustedT) * 0.5;

        result.x = p0x * t0 + p1x * t1 + p2x * t2 + p3x * t3;
        result.y = p0y * t0 + p1y * t1 + p2y * t2 + p3y * t3;

        return result;
    }

    private onBezierCurve(ptStart: number, ptCount: number, t: number, result: Point): Point {
        const t2: number = 1 - t;
        const p0x: number = this._points[ptStart].x;
        const p0y: number = this._points[ptStart].y;
        const p1x: number = this._points[ptStart + 1].x;
        const p1y: number = this._points[ptStart + 1].y;
        const cp0x: number = this._points[ptStart + 2].x;
        const cp0y: number = this._points[ptStart + 2].y;

        if (ptCount == 4) {
            const cp1x: number = this._points[ptStart + 3].x;
            const cp1y: number = this._points[ptStart + 3].y;
            result.x = t2 * t2 * t2 * p0x + 3 * t2 * t2 * t * cp0x + 3 * t2 * t * t * cp1x + t * t * t * p1x;
            result.y = t2 * t2 * t2 * p0y + 3 * t2 * t2 * t * cp0y + 3 * t2 * t * t * cp1y + t * t * t * p1y;
        }
        else {
            result.x = t2 * t2 * p0x + 2 * t2 * t * cp0x + t * t * p1x;
            result.y = t2 * t2 * p0y + 2 * t2 * t * cp0y + t * t * p1y;
        }

        return result;
    }
}

const s_points: Array<Point> = new Array<Point>();

interface Segment {
    type: number;
    length: number;
    ptStart: number;
    ptCount: number;
}

/** The reference built these with `{}` and filled the fields afterwards. */
function createSegment(): Segment {
    return { type: 0, length: 0, ptStart: 0, ptCount: 0 };
}
