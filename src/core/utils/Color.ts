/**
 * An 8-bit-per-channel RGBA colour, matching what the package format stores
 * (`readColor` reads four bytes) and what FairyGUI's `color` properties expect.
 */
export class Color {
    public r = 0;
    public g = 0;
    public b = 0;
    public a = 255;

    public constructor(r = 0, g = 0, b = 0, a = 255) {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
    }

    /**
     * Parses the integer forms FairyGUI accepts. Values above `0xFFFFFF` are
     * read as ARGB; anything at or below is read as RGB with opaque alpha. This
     * mirrors the editor's convention of writing `0xRRGGBB` for opaque colours
     * and `0xAARRGGBB` only when the alpha byte matters.
     */
    public static fromInt(value: number): Color {
        if ((value & 0xff000000) !== 0)
            return new Color((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff, (value >> 24) & 0xff);
        else
            return new Color((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff, 255);
    }

    /** Parses `#RGB`, `#RRGGBB`, `#RRGGBBAA` or `0xAARRGGBB`, per `UIConfig` docs. */
    public static parse(value: string | number | null | undefined): Color | null {
        if (value == null)
            return null;
        if (typeof value === 'number')
            return Color.fromInt(value);

        let str = value.trim();
        if (str.charAt(0) === '#')
            str = str.substring(1);
        else if (str.substring(0, 2).toLowerCase() === '0x')
            str = str.substring(2);

        if (str.length === 3)
            str = str.charAt(0) + str.charAt(0) + str.charAt(1) + str.charAt(1) + str.charAt(2) + str.charAt(2);

        const int = parseInt(str, 16);
        if (isNaN(int))
            return null;
        // Six digits is RGB; eight is RGBA, not ARGB.
        if (str.length === 8)
            return new Color((int >> 24) & 0xff, (int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff);
        return Color.fromInt(int);
    }

    /** Packs back into `0xAARRGGBB`. */
    public toInt(): number {
        return ((this.a << 24) | (this.r << 16) | (this.g << 8) | this.b) >>> 0;
    }

    /** Packs into the `#RRGGBBAA` form `Color.parse` round-trips. */
    public toHex(): string {
        return '#' + (this.r << 24 | this.g << 16 | this.b << 8 | this.a).toString(16).padStart(8, '0');
    }

    public copy(source: Color): Color {
        this.r = source.r;
        this.g = source.g;
        this.b = source.b;
        this.a = source.a;
        return this;
    }

    public clone(): Color {
        return new Color(this.r, this.g, this.b, this.a);
    }

    public equals(other: Color): boolean {
        return !!other && this.r === other.r && this.g === other.g && this.b === other.b && this.a === other.a;
    }

    /** Rec. 601 luma, used by `grayed` text and images. */
    public toGrayed(): Color {
        const v = this.r * 0.299 + this.g * 0.587 + this.b * 0.114;
        return new Color(v, v, v, this.a);
    }

    public toString(): string {
        return this.toHex();
    }
}
