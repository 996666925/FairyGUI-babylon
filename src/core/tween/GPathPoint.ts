export enum CurveType {
    CRSpline,
    Bezier,
    CubicBezier,
    Straight,
}

/**
 * One control point of a `GPath`. `curveType` describes the curve that leads
 * *from* this point to the next one, which is why the control points of a
 * Bezier segment live on the point it starts at.
 */
export class GPathPoint {
    public x: number;
    public y: number;

    public control1_x: number;
    public control1_y: number;

    public control2_x: number;
    public control2_y: number;

    public curveType: number;

    public constructor() {
        this.x = 0;
        this.y = 0;
        this.control1_x = 0;
        this.control1_y = 0;
        this.control2_x = 0;
        this.control2_y = 0;
        this.curveType = 0;
    }

    public static newPoint(x = 0, y = 0, curveType = 0): GPathPoint {
        const pt: GPathPoint = new GPathPoint();
        pt.x = x;
        pt.y = y;
        pt.control1_x = 0;
        pt.control1_y = 0;
        pt.control2_x = 0;
        pt.control2_y = 0;
        pt.curveType = curveType;

        return pt;
    }

    public static newBezierPoint(x = 0, y = 0, control1_x = 0, control1_y = 0): GPathPoint {
        const pt: GPathPoint = new GPathPoint();
        pt.x = x;
        pt.y = y;
        pt.control1_x = control1_x;
        pt.control1_y = control1_y;
        pt.control2_x = 0;
        pt.control2_y = 0;
        pt.curveType = CurveType.Bezier;

        return pt;
    }

    public static newCubicBezierPoint(x = 0, y = 0,
        control1_x = 0, control1_y = 0,
        control2_x = 0, control2_y = 0): GPathPoint {
        const pt: GPathPoint = new GPathPoint();
        pt.x = x;
        pt.y = y;
        pt.control1_x = control1_x;
        pt.control1_y = control1_y;
        pt.control2_x = control2_x;
        pt.control2_y = control2_y;
        pt.curveType = CurveType.CubicBezier;

        return pt;
    }

    public clone(): GPathPoint {
        const ret: GPathPoint = new GPathPoint();
        ret.x = this.x;
        ret.y = this.y;
        ret.control1_x = this.control1_x;
        ret.control1_y = this.control1_y;
        ret.control2_x = this.control2_x;
        ret.control2_y = this.control2_y;
        ret.curveType = this.curveType;

        return ret;
    }
}
