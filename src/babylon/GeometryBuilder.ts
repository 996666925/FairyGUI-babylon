import { Rect } from '../core/utils/Geometry.js';

/**
 * Where a sub-rect of a sprite ends up, in pixels.
 *
 * `src*` is in the sprite's *displayed* pixel space (the size the editor shows,
 * before any 90° atlas rotation); `dst*` is in the render object's content space
 * (origin at the content box's top-left, y down).
 */
export interface SpriteRegion {
    srcX: number;
    srcY: number;
    srcW: number;
    srcH: number;
    dstX: number;
    dstY: number;
    dstW: number;
    dstH: number;
}

/** Scratch returned by {@link SpriteMapping.uv} to avoid per-vertex allocation. */
export interface UV {
    u: number;
    v: number;
}

/**
 * Maps a sprite's *displayed* normalised coordinates `(s, t)` — `s` rightwards,
 * `t` downwards — to atlas UVs.
 *
 * The mapping is affine, so a sub-rect of the sprite maps to a parallelogram in
 * UV space and linear interpolation between its four UV corners is exact. That
 * property is what lets nine-slice and tiling share one UV path regardless of the
 * atlas rotation.
 *
 * ### The `rotated` convention
 *
 * When the editor stored a region rotated it writes the region's **atlas
 * footprint** into `rect` and sets `rotated`. The displayed image is therefore
 * `rect.height` wide by `rect.width` tall, and the corners map as:
 *
 * | displayed | atlas |
 * |-----------|-------|
 * | top-left | `(u0, v1)` |
 * | top-right | `(u0, v0)` |
 * | bottom-right | `(u1, v0)` |
 * | bottom-left | `(u1, v1)` |
 *
 * i.e. `u` runs with `t` and `v` runs backwards with `s`. None of the shipped
 * fixture atlases contains a rotated region (286 sprites checked, zero rotated),
 * so this direction is derived rather than observed — see the backend report.
 */
export class SpriteMapping {
    public u0 = 0;
    public v0 = 0;
    public u1 = 1;
    public v1 = 1;
    public rotated = false;
    /** Displayed width of the sprite, in pixels. */
    public width = 0;
    /** Displayed height of the sprite, in pixels. */
    public height = 0;

    /**
     * @param rect atlas sub-rect, or `null` for the whole texture.
     * @param texWidth texture width in pixels (ignored when `rect` is null).
     * @param texHeight texture height in pixels (ignored when `rect` is null).
     * @param rotated whether the editor stored the region rotated 90°.
     */
    public set(rect: Rect | null, texWidth: number, texHeight: number, rotated: boolean): this {
        const w = texWidth > 0 ? texWidth : 1;
        const h = texHeight > 0 ? texHeight : 1;
        const rx = rect ? rect.x : 0;
        const ry = rect ? rect.y : 0;
        const rw = rect ? rect.width : w;
        const rh = rect ? rect.height : h;

        this.u0 = rx / w;
        this.v0 = ry / h;
        this.u1 = (rx + rw) / w;
        this.v1 = (ry + rh) / h;
        this.rotated = rotated && !!rect;
        this.width = this.rotated ? rh : rw;
        this.height = this.rotated ? rw : rh;
        return this;
    }

    /** Samples the sprite at displayed normalised `(s, t)`. */
    public uv(s: number, t: number, out: UV): UV {
        const du = this.u1 - this.u0;
        const dv = this.v1 - this.v0;
        if (this.rotated) {
            out.u = this.u0 + t * du;
            out.v = this.v0 + (1 - s) * dv;
        } else {
            out.u = this.u0 + s * du;
            out.v = this.v0 + t * dv;
        }
        return out;
    }

    /** `true` when the mapping covers nothing (a texture with no pixels). */
    public isEmpty(): boolean {
        return this.u1 <= this.u0 || this.v1 <= this.v0;
    }
}

/**
 * Accumulates triangles for one render object's mesh.
 *
 * Vertices are written by the caller in **content space** (origin top-left of the
 * content box), and the builder applies the two corrections the coordinate
 * contract forces:
 *
 * 1. **Winding.** The UI root's `scaling = (1, -1, 1)` gives it a negative
 *    determinant, which mirrors every triangle it contains. Babylon's default
 *    side orientation treats counter-clockwise-when-projected as front-facing, so
 *    a quad emitted in the natural on-screen clockwise order would be culled.
 *    `addQuad` therefore emits `(0, 2, 1), (0, 3, 2)` rather than `(0, 1, 2),
 *    (0, 2, 3)`, restoring the winding the flip destroys. (The material also
 *    disables back-face culling so a future change to the root cannot silently
 *    blank the UI — belt and braces, since none of this is lit.)
 * 2. **Pivot.** Babylon's node origin is the pivot (`GObject` calls `setPosition`
 *    with the pivot's location), so the content box is emitted translated by
 *    `-pivot`. {@link setPivotOffset} supplies it.
 *
 * Skew is baked here too: a shear commutes with nothing, so applying it to the
 * vertices is the only way to keep a Babylon `TransformNode`'s TRS exactly equal
 * to the matrix this backend reports from `localToGlobal`.
 */
export class GeometryBuilder {
    public readonly positions: number[] = [];
    public readonly uvs: number[] = [];
    public readonly colors: number[] = [];
    public readonly indices: number[] = [];

    private _pivotX = 0;
    private _pivotY = 0;
    private _shearX = 0;
    private _shearY = 0;
    /** RGBA written for every vertex added while it is current. */
    private _colorR = 1;
    private _colorG = 1;
    private _colorB = 1;
    private _colorA = 1;

    public get vertexCount(): number {
        return this.positions.length / 3;
    }

    public get triangleCount(): number {
        return this.indices.length / 3;
    }

    public isEmpty(): boolean {
        return this.indices.length === 0;
    }

    public reset(): void {
        this.positions.length = 0;
        this.uvs.length = 0;
        this.colors.length = 0;
        this.indices.length = 0;
    }

    public setPivotOffset(x: number, y: number): void {
        this._pivotX = x;
        this._pivotY = y;
    }

    /** Shears in degrees; see `IRenderObject.skewX` / `skewY`. */
    public setShear(skewX: number, skewY: number): void {
        this._shearX = Math.tan(skewX * (Math.PI / 180));
        this._shearY = Math.tan(skewY * (Math.PI / 180));
    }

    /** Colour applied to vertices added from here on, components in `[0, 1]`. */
    public setVertexColor(r: number, g: number, b: number, a: number): void {
        this._colorR = r;
        this._colorG = g;
        this._colorB = b;
        this._colorA = a;
    }

    /** Adds a vertex at content-space `(x, y)` with UV `(u, v)`. */
    public addVertex(x: number, y: number, u: number, v: number): number {
        // Pivot offset first, then the shear: `v_node = K · (p - pivot)`, which
        // is exactly `T(-pivot)` followed by `K` and therefore exactly what
        // `BabRenderObject.localToParentMatrix` composes to.
        const dx = x - this._pivotX;
        const dy = y - this._pivotY;
        const sx = dx + this._shearX * dy;
        const sy = dy + this._shearY * dx;
        this.positions.push(sx, sy, 0);
        this.uvs.push(u, v);
        this.colors.push(this._colorR, this._colorG, this._colorB, this._colorA);
        return this.vertexCount - 1;
    }

    /**
     * Adds a quad from four corners given in on-screen clockwise order (top-left,
     * top-right, bottom-right, bottom-left) and their matching UVs.
     */
    public addQuad(
        x0: number, y0: number, x1: number, y1: number,
        x2: number, y2: number, x3: number, y3: number,
        u0: number, v0: number, u1: number, v1: number,
        u2: number, v2: number, u3: number, v3: number,
    ): void {
        const base = this.addVertex(x0, y0, u0, v0);
        void this.addVertex(x1, y1, u1, v1);
        void this.addVertex(x2, y2, u2, v2);
        void this.addVertex(x3, y3, u3, v3);
        // (0, 2, 1) / (0, 3, 2): counter-clockwise once the root flips y.
        this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }

    /** Adds a triangle by position and UV, winding corrected as in `addQuad`. */
    public addTriangle(
        x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
        u0: number, v0: number, u1: number, v1: number, u2: number, v2: number,
    ): void {
        const base = this.addVertex(x0, y0, u0, v0);
        void this.addVertex(x1, y1, u1, v1);
        void this.addVertex(x2, y2, u2, v2);
        this.indices.push(base, base + 2, base + 1);
    }
}

/**
 * Signed area of triangle `(ax, ay) (bx, by) (cx, cy)`.
 *
 * Negative means clockwise as drawn in UI space (y down). The UI root's y-flip
 * inverts the sign again, so a clockwise-in-UI triangle ends up counter-clockwise
 * — and therefore front-facing — in Babylon's world.
 */
export function signedArea(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
    return ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) * 0.5;
}

/** Splits a nine-slice border rect into the pixel widths of its four borders. */
export interface SliceBorders {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * Derives the border widths for a nine-slice grid.
 *
 * When the destination is narrower than the two horizontal borders combined the
 * borders shrink proportionally (the corners lose their fixed size) rather than
 * overlapping — the clamp Cocos and Unity apply, and the reason a nine-slice
 * image stays sane at tiny sizes. Above that threshold the borders keep their
 * source size exactly.
 */
export function nineSliceBorders(dstW: number, dstH: number, srcW: number, srcH: number, grid: Rect): SliceBorders {
    let left = Math.max(0, Math.min(grid.x, srcW));
    let right = Math.max(0, Math.min(srcW - grid.xMax, srcW));
    let top = Math.max(0, Math.min(grid.y, srcH));
    let bottom = Math.max(0, Math.min(srcH - grid.yMax, srcH));

    const hSum = left + right;
    if (hSum > dstW && hSum > 0) {
        const k = dstW / hSum;
        left *= k;
        right *= k;
    }
    const vSum = top + bottom;
    if (vSum > dstH && vSum > 0) {
        const k = dstH / vSum;
        top *= k;
        bottom *= k;
    }
    return { left, top, right, bottom };
}

/** The three source and three destination bands a 3×3 split produces. */
interface Bands {
    srcX: [number, number, number];
    srcY: [number, number, number];
    dstX: [number, number, number];
    dstY: [number, number, number];
}

/**
 * Shared layout for nine-slice and grid-tiling: cuts the source into three bands
 * per axis (border / centre / border), clamped to the sprite, and the destination
 * into the matching three bands.
 */
function splitBands(dstW: number, dstH: number, srcW: number, srcH: number, grid: Rect): Bands {
    const b = nineSliceBorders(dstW, dstH, srcW, srcH, grid);

    const srcL = Math.max(0, Math.min(grid.x, srcW));
    const srcT = Math.max(0, Math.min(grid.y, srcH));
    const srcR = Math.max(0, srcW - Math.max(grid.xMax, 0));
    const srcB = Math.max(0, srcH - Math.max(grid.yMax, 0));
    const srcC = Math.max(0, srcW - srcL - srcR);
    const srcM = Math.max(0, srcH - srcT - srcB);

    const dstL = b.left;
    const dstT = b.top;
    const dstR = b.right;
    const dstB = b.bottom;
    const dstC = Math.max(0, dstW - dstL - dstR);
    const dstM = Math.max(0, dstH - dstT - dstB);

    return {
        srcX: [srcL, srcC, srcR],
        srcY: [srcT, srcM, srcB],
        dstX: [dstL, dstC, dstR],
        dstY: [dstT, dstM, dstB],
    };
}

function pushRegion(
    out: SpriteRegion[],
    srcX: number, srcY: number, srcW: number, srcH: number,
    dstX: number, dstY: number, dstW: number, dstH: number,
): void {
    if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0)
        return;
    out.push({ srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH });
}

/**
 * Splits an image into the nine regions of `scale9Grid`.
 *
 * Corners keep their source pixel size; edges stretch along one axis; the centre
 * stretches along both. Returns the regions in row-major order, skipping any that
 * collapse to zero size (a grid whose centre band is empty, say).
 */
export function nineSliceRegions(dstW: number, dstH: number, srcW: number, srcH: number, grid: Rect): SpriteRegion[] {
    const bands = splitBands(dstW, dstH, srcW, srcH, grid);
    const out: SpriteRegion[] = [];

    let srcX = 0;
    let dstX = 0;
    for (let c = 0; c < 3; c++) {
        let srcY = 0;
        let dstY = 0;
        for (let r = 0; r < 3; r++) {
            pushRegion(out, srcX, srcY, bands.srcX[c], bands.srcY[r], dstX, dstY, bands.dstX[c], bands.dstY[r]);
            srcY += bands.srcY[r];
            dstY += bands.dstY[r];
        }
        srcX += bands.srcX[c];
        dstX += bands.dstX[c];
    }
    return out;
}

/**
 * Splits an image into repeating tiles.
 *
 * `tileIndice` is the editor's 9-bit mask over the same 3×3 grid `scale9Grid`
 * describes: bit `r * 3 + c` set means that cell repeats to fill its destination
 * band instead of stretching. A zero mask repeats the whole sprite across the
 * whole destination.
 *
 * Repeat counts are rounded to the nearest whole number and the destination band
 * is divided evenly between them, so tiles stay evenly spaced and no partial tile
 * is left hanging off the edge. Source rects are never resampled — a tile always
 * samples the same pixels, which is the point of tiling.
 */
export function tileRegions(
    dstW: number, dstH: number, srcW: number, srcH: number,
    grid: Rect | null, tileIndice: number,
): SpriteRegion[] {
    const out: SpriteRegion[] = [];

    if (!grid || tileIndice === 0) {
        pushTiledBlock(out, 0, 0, srcW, srcH, 0, 0, dstW, dstH);
        return out;
    }

    const bands = splitBands(dstW, dstH, srcW, srcH, grid);
    let srcX = 0;
    let dstX = 0;
    for (let c = 0; c < 3; c++) {
        let srcY = 0;
        let dstY = 0;
        for (let r = 0; r < 3; r++) {
            const sw = bands.srcX[c];
            const sh = bands.srcY[r];
            const dw = bands.dstX[c];
            const dh = bands.dstY[r];
            if ((tileIndice & (1 << (r * 3 + c))) !== 0)
                pushTiledBlock(out, srcX, srcY, sw, sh, dstX, dstY, dw, dh);
            else
                pushRegion(out, srcX, srcY, sw, sh, dstX, dstY, dw, dh);

            srcY += sh;
            dstY += dh;
        }
        srcX += bands.srcX[c];
        dstX += bands.dstX[c];
    }
    return out;
}

/**
 * Repeats `srcW × srcH` across a `dstW × dstH` block.
 *
 * Tiles are laid out at the source's own size and the last one in each
 * direction is cut at the edge of the block, which is what the reference's
 * tiled sprite did: it was never resampled to make a whole number of copies fit.
 * Fitting them instead squeezes every tile — and a block *smaller* than one tile
 * shows a shrunken copy of the whole sprite rather than its top-left corner,
 * which is how a tiled progress bar came out with its artwork squashed.
 */
function pushTiledBlock(
    out: SpriteRegion[],
    srcX: number, srcY: number, srcW: number, srcH: number,
    dstX: number, dstY: number, dstW: number, dstH: number,
): void {
    if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0)
        return;

    // The epsilon keeps an exact fit from rounding up to one extra tile.
    const nx = Math.ceil(dstW / srcW - 1e-6);
    const ny = Math.ceil(dstH / srcH - 1e-6);
    for (let y = 0; y < ny; y++) {
        const dy = y * srcH;
        const sh = Math.min(srcH, dstH - dy);
        for (let x = 0; x < nx; x++) {
            const dx = x * srcW;
            const sw = Math.min(srcW, dstW - dx);
            pushRegion(out, srcX, srcY, sw, sh, dstX + dx, dstY + dy, sw, sh);
        }
    }
}

/**
 * Builds the filled polygon for a progress-style fill, in normalised sprite space
 * (`s` rightwards, `t` downwards, both nominally in `[0, 1]`).
 *
 * The result is a flat `[s0, t0, s1, t1, …]` ring, already clipped to the unit
 * square, wound clockwise on screen. Doing the fill arithmetically on the CPU
 * (rather than with a shader mask) is what lets it survive atlas rotation,
 * nine-slicing and per-vertex skew.
 *
 * @param method `FillMethod`; `0` (`None`) yields the whole unit square.
 * @param origin `FillOrigin`; only consulted by the radial methods.
 * @param clockwise sweep direction for the radial methods.
 * @param amount sweep fraction, clamped to `[0, 1]`.
 */
export function fillPolygon(
    method: number,
    origin: number,
    clockwise: boolean,
    amount: number,
    out: number[] = [],
): number[] {
    out.length = 0;
    const a = Math.max(0, Math.min(1, amount));
    if (a <= 0)
        return out; // nothing to draw: better an empty ring than a degenerate one

    // FillMethod: 0 None, 1 Horizontal, 2 Vertical, 3 Radial90, 4 Radial180, 5 Radial360
    // FillOrigin: 0 Top, 1 Bottom, 2 Left, 3 Right
    if (method === 1) {
        if (origin === 3)
            pushRect(out, 1 - a, 0, 1, 1);
        else
            pushRect(out, 0, 0, a, 1);
        return out;
    }
    if (method === 2) {
        if (origin === 1)
            pushRect(out, 0, 1 - a, 1, 1);
        else
            pushRect(out, 0, 0, 1, a);
        return out;
    }
    if (method === 3 || method === 4 || method === 5) {
        const total = method === 3 ? 90 : method === 4 ? 180 : 360;
        const sweep = total * a;
        if (sweep <= 0)
            return out;
        if (sweep >= 360)
            pushRect(out, 0, 0, 1, 1);
        else
            pushFan(out, method, origin, clockwise, sweep);
        return out;
    }

    pushRect(out, 0, 0, 1, 1);
    return out;
}

function pushRect(out: number[], x0: number, y0: number, x1: number, y1: number): void {
    // On-screen clockwise: top-left, top-right, bottom-right, bottom-left.
    out.push(x0, y0, x1, y0, x1, y1, x0, y1);
}

/**
 * Fan polygon for the radial fills.
 *
 * `Radial90` / `Radial180` pivot on an edge midpoint and sweep symmetrically
 * about the perpendicular; `Radial360` pivots on the centre and starts at the
 * edge named by `origin`. Angles live in `(s, t)` space where `+t` points down,
 * so `+90°` reads as straight down and increasing angles sweep clockwise on
 * screen. The winding of the emitted ring is normalised later by
 * `triangulatePolygon`, so the sweep direction only changes which side fills.
 */
function pushFan(out: number[], method: number, origin: number, clockwise: boolean, sweepDeg: number): void {
    let cx = 0.5;
    let cy = 0.5;
    let baseDeg: number;

    if (method === 5) {
        if (origin === 0)
            baseDeg = -90;
        else if (origin === 1)
            baseDeg = 90;
        else if (origin === 2)
            baseDeg = 180;
        else
            baseDeg = 0;
    } else {
        if (origin === 0) {
            cy = 0;
            baseDeg = 90;
        } else if (origin === 1) {
            cy = 1;
            baseDeg = -90;
        } else if (origin === 2) {
            cx = 0;
            baseDeg = 0;
        } else {
            cx = 1;
            baseDeg = 180;
        }
    }

    const half = sweepDeg / 2;
    let arcFrom: number;
    let arcTo: number;
    if (method === 5) {
        arcFrom = clockwise ? baseDeg : baseDeg - sweepDeg;
        arcTo = clockwise ? baseDeg + sweepDeg : baseDeg;
    } else {
        // Symmetric about the border normal, so direction only matters once the
        // sweep is partial.
        arcFrom = clockwise ? baseDeg - half : baseDeg + half;
        arcTo = clockwise ? baseDeg + half : baseDeg - half;
    }

    // The arc is drawn well outside the unit square and trimmed below.
    const radius = 4;
    const steps = Math.max(2, Math.ceil(sweepDeg / 6));
    out.push(cx, cy);
    for (let i = 0; i <= steps; i++) {
        const deg = arcFrom + (arcTo - arcFrom) * (i / steps);
        const rad = deg * (Math.PI / 180);
        out.push(cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius);
    }

    clipToUnitSquare(out);
}

/** Sutherland–Hodgman clip of a simple polygon against the unit square, in place. */
export function clipToUnitSquare(poly: number[]): void {
    clipHalfPlane(poly, 1, 0, 0);    // s >= 0
    clipHalfPlane(poly, -1, 0, 1);   // s <= 1
    clipHalfPlane(poly, 0, 1, 0);    // t >= 0
    clipHalfPlane(poly, 0, -1, 1);   // t <= 1
}

/**
 * Clips a polygon to the half-plane `nx·x + ny·y + c >= 0`, in place.
 *
 * `(nx, ny)` need not be normalised; only the sign of the implicit distance
 * matters. Vertices introduced on the boundary are interpolated linearly, which
 * is exact for the UV mapping this is used with.
 */
export function clipHalfPlane(poly: number[], nx: number, ny: number, c: number): void {
    const n = poly.length / 2;
    if (n === 0)
        return;

    const out: number[] = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const xi = poly[i * 2];
        const yi = poly[i * 2 + 1];
        const xj = poly[j * 2];
        const yj = poly[j * 2 + 1];
        const di = nx * xi + ny * yi + c;
        const dj = nx * xj + ny * yj + c;

        if (di >= 0)
            out.push(xi, yi);
        if ((di >= 0) !== (dj >= 0)) {
            const t = di / (di - dj);
            out.push(xi + (xj - xi) * t, yi + (yj - yi) * t);
        }
    }
    poly.length = 0;
    for (let i = 0; i < out.length; i++)
        poly.push(out[i]);
}

/**
 * Ear-clipping triangulation of a simple polygon.
 *
 * @param points flat `[x0, y0, x1, y1, …]`.
 * @param indices receives triples that index into `points`' *vertex* numbering.
 * @returns the number of triangles emitted.
 *
 * Triangles come out **clockwise in the input space**. Since the input is UI
 * space and the UI root flips y, clockwise-in-UI is front-facing in Babylon —
 * the same correction {@link GeometryBuilder.addQuad} applies. A polygon that
 * cannot be reduced (self-intersecting input) falls back to a fan of its ring
 * rather than emitting nothing.
 */
export function triangulatePolygon(points: number[], indices: number[]): number {
    const n = points.length / 2;
    if (n < 3)
        return 0;

    // An index ring lets the polygon be reversed without renumbering vertices.
    const ring: number[] = [];
    for (let i = 0; i < n; i++)
        ring.push(i);

    if (polygonArea(points, ring) > 0)
        ring.reverse();

    let triangles = 0;
    let guard = 0;
    while (ring.length > 3 && guard++ < n * n) {
        let clipped = false;
        for (let i = 0; i < ring.length; i++) {
            const i0 = ring[(i + ring.length - 1) % ring.length];
            const i1 = ring[i];
            const i2 = ring[(i + 1) % ring.length];
            if (!isEar(points, ring, i0, i1, i2))
                continue;

            indices.push(i0, i1, i2);
            triangles++;
            ring.splice(i, 1);
            clipped = true;
            break;
        }
        if (!clipped)
            break;
    }

    if (ring.length === 3) {
        indices.push(ring[0], ring[1], ring[2]);
        triangles++;
    } else if (ring.length > 3) {
        for (let i = 1; i + 1 < ring.length; i++) {
            indices.push(ring[0], ring[i], ring[i + 1]);
            triangles++;
        }
    }
    return triangles;
}

/** Twice the signed area of the polygon described by `ring`; > 0 is CCW in UI space. */
function polygonArea(points: number[], ring: number[]): number {
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i] * 2;
        const b = ring[(i + 1) % ring.length] * 2;
        area += points[a] * points[b + 1] - points[b] * points[a + 1];
    }
    return area;
}

function isEar(points: number[], ring: number[], i0: number, i1: number, i2: number): boolean {
    const ax = points[i0 * 2];
    const ay = points[i0 * 2 + 1];
    const bx = points[i1 * 2];
    const by = points[i1 * 2 + 1];
    const cx = points[i2 * 2];
    const cy = points[i2 * 2 + 1];

    // In a clockwise ring a convex corner has a negative cross product.
    if ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay) >= 0)
        return false;

    for (const idx of ring) {
        if (idx === i0 || idx === i1 || idx === i2)
            continue;
        if (pointInTriangle(points[idx * 2], points[idx * 2 + 1], ax, ay, bx, by, cx, cy))
            return false;
    }
    return true;
}

function pointInTriangle(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
}

/**
 * Emits a quad for every segment of a polyline, giving a stroked band of
 * `lineSize` centred on the path.
 *
 * Joins are butt (each segment is its own quad), which leaves a small notch on
 * sharp corners; a miter join is not worth the triangle budget here.
 */
export function strokePolyline(
    builder: GeometryBuilder,
    points: number[],
    closed: boolean,
    lineSize: number,
): void {
    const n = points.length / 2;
    if (n < 2 || lineSize <= 0)
        return;

    const half = lineSize / 2;
    const count = closed ? n : n - 1;

    for (let i = 0; i < count; i++) {
        const j = (i + 1) % n;
        const x0 = points[i * 2];
        const y0 = points[i * 2 + 1];
        const x1 = points[j * 2];
        const y1 = points[j * 2 + 1];
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6)
            continue;
        const nx = (-dy / len) * half;
        const ny = (dx / len) * half;

        builder.addQuad(
            x0 + nx, y0 + ny,
            x1 + nx, y1 + ny,
            x1 - nx, y1 - ny,
            x0 - nx, y0 - ny,
            0, 0, 1, 0, 1, 1, 0, 1,
        );
    }
}

/**
 * Builds a rounded rectangle outline as an on-screen clockwise ring.
 *
 * @param corners `[topLeft, topRight, bottomLeft, bottomRight]`; `null` or `0`
 *   gives a square corner.
 * @param segments arc segments per rounded corner.
 */
export function roundRectPath(
    x: number, y: number, w: number, h: number,
    corners: Array<number | null>,
    segments = 6,
): number[] {
    const maxR = Math.min(w, h) / 2;
    const clamp = (v: number | null): number => Math.max(0, Math.min(v ?? 0, maxR));
    const tl = clamp(corners[0]);
    const tr = clamp(corners[1]);
    const bl = clamp(corners[2]);
    const br = clamp(corners[3]);

    // Centre, radius and starting angle of each corner, in clockwise travel
    // order starting from the top-left. Increasing angle is clockwise because +y
    // points down.
    const arcs: Array<[number, number, number, number]> = [
        [x + tl, y + tl, tl, 180],
        [x + w - tr, y + tr, tr, 270],
        [x + w - br, y + h - br, br, 0],
        [x + bl, y + h - bl, bl, 90],
    ];

    const out: number[] = [];
    for (const [cx, cy, r, startDeg] of arcs) {
        if (r <= 0) {
            out.push(cx, cy);
            continue;
        }
        for (let i = 0; i <= segments; i++) {
            const rad = (startDeg + (90 * i) / segments) * (Math.PI / 180);
            out.push(cx + Math.cos(rad) * r, cy + Math.sin(rad) * r);
        }
    }
    return out;
}

/** Builds an ellipse outline as an on-screen clockwise ring of `segments + 1` points. */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number, segments = 32): number[] {
    const out: number[] = [];
    for (let i = 0; i <= segments; i++) {
        const rad = (i / segments) * Math.PI * 2;
        out.push(cx + Math.cos(rad) * rx, cy + Math.sin(rad) * ry);
    }
    return out;
}
