/**
 * A 2D affine transform expressed in FairyGUI's own coordinate space.
 *
 * The matrix maps `(x, y)` to `(a·x + c·y + tx, b·x + d·y + ty)` — the same
 * component order canvas 2D and ActionScript use. Every matrix in this module is
 * in *UI space*: origin top-left, **y increasing downwards**. Babylon never sees
 * one of these; the y-flip lives entirely in the root `TransformNode` and in the
 * render object's `mesh`.
 *
 * Positive rotation is **clockwise on screen**, which in a y-down space is the
 * same numeric matrix as counter-clockwise in a y-up space:
 *
 * ```
 * R(θ) = [ cos θ  -sin θ ]
 *        [ sin θ   cos θ ]
 * ```
 *
 * Because the root node's flip (`scaling = (1, -1, 1)`) composes as
 * `F·R(θ)·F = R(-θ)`, feeding Babylon the *same* numeric angle produces a
 * clockwise rotation on screen — the flip and the sign cancel exactly. No
 * negation is needed anywhere, which is why the degree value is passed through
 * unchanged.
 */
export class Mat2D {
    public a = 1;
    public b = 0;
    public c = 0;
    public d = 1;
    public tx = 0;
    public ty = 0;

    public set(a: number, b: number, c: number, d: number, tx: number, ty: number): this {
        this.a = a;
        this.b = b;
        this.c = c;
        this.d = d;
        this.tx = tx;
        this.ty = ty;
        return this;
    }

    public setIdentity(): this {
        return this.set(1, 0, 0, 1, 0, 0);
    }

    public copy(source: Mat2D): this {
        return this.set(source.a, source.b, source.c, source.d, source.tx, source.ty);
    }

    public clone(): Mat2D {
        return new Mat2D().copy(this);
    }

    /**
     * Post-multiplies: `this = this · other`.
     *
     * `other` is the *inner* (more local) transform, so a chain built by
     * multiplying from the root downwards ends up mapping local to root.
     */
    public multiply(other: Mat2D): this {
        const a = this.a * other.a + this.c * other.b;
        const b = this.b * other.a + this.d * other.b;
        const c = this.a * other.c + this.c * other.d;
        const d = this.b * other.c + this.d * other.d;
        const tx = this.a * other.tx + this.c * other.ty + this.tx;
        const ty = this.b * other.tx + this.d * other.ty + this.ty;
        return this.set(a, b, c, d, tx, ty);
    }

    /**
     * Inverts in place.
     *
     * A degenerate (zero-determinant) matrix — reachable by scaling an object to
     * `(0, 0)` — is left as the identity rather than producing `NaN`s that would
     * poison every later conversion.
     */
    public invert(): this {
        const det = this.a * this.d - this.b * this.c;
        if (det === 0 || !isFinite(det))
            return this.setIdentity();

        const inv = 1 / det;
        const a = this.d * inv;
        const b = -this.b * inv;
        const c = -this.c * inv;
        const d = this.a * inv;
        const tx = (this.c * this.ty - this.d * this.tx) * inv;
        const ty = (this.b * this.tx - this.a * this.ty) * inv;
        return this.set(a, b, c, d, tx, ty);
    }

    public transformX(x: number, y: number): number {
        return this.a * x + this.c * y + this.tx;
    }

    public transformY(x: number, y: number): number {
        return this.b * x + this.d * y + this.ty;
    }

    /** Signed area scale factor; negative when the transform mirrors. */
    public determinant(): number {
        return this.a * this.d - this.b * this.c;
    }

    public equals(other: Mat2D, epsilon = 1e-6): boolean {
        return Math.abs(this.a - other.a) <= epsilon
            && Math.abs(this.b - other.b) <= epsilon
            && Math.abs(this.c - other.c) <= epsilon
            && Math.abs(this.d - other.d) <= epsilon
            && Math.abs(this.tx - other.tx) <= epsilon
            && Math.abs(this.ty - other.ty) <= epsilon;
    }

    /**
     * Builds `T(x, y) · R(angle) · S(sx, sy) · T(-pivotX, -pivotY)`.
     *
     * This is the transform `GObject` describes: it calls `setPosition` with the
     * *pivot's* location in the parent (`handlePositionChanged` adds
     * `pivotX * width` when the pivot is not an anchor), so the node's origin is
     * the pivot and the content box hangs off it by `-pivot`.
     *
     * @param angle in degrees, clockwise on screen.
     * @param pivotX pivot offset in pixels (already multiplied by the content box).
     */
    public static fromTRS(
        x: number, y: number,
        angle: number,
        scaleX: number, scaleY: number,
        pivotX: number, pivotY: number,
    ): Mat2D {
        const rad = angle * (Math.PI / 180);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const a = scaleX * cos;
        const b = scaleX * sin;
        const c = -scaleY * sin;
        const d = scaleY * cos;
        return new Mat2D().set(a, b, c, d, x - (a * pivotX + c * pivotY), y - (b * pivotX + d * pivotY));
    }
}
