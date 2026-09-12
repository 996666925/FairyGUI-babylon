import { Color } from './Color.js';

/**
 * Reader for the FairyGUI published-package binary format.
 *
 * The format is **big-endian**: no reference runtime ever assigns
 * `littleEndian`, so `DataView`'s default (big-endian) applies to every
 * multi-byte read. Verified against real `.fui` files — the header starts with
 * the ASCII bytes `FGUI`, which `readUint()` yields as `0x46475549` only when
 * read big-endian.
 */
export class ByteBuffer {
    /** Filled from index segments 4 and 5; `readS` indexes into it. */
    public stringTable: string[] = [];
    public version = 0;
    public littleEndian = false;

    protected _view: DataView;
    protected _bytes: Uint8Array;
    protected _pos = 0;
    protected _length: number;

    public constructor(buffer: ArrayBuffer, offset = 0, length = -1) {
        if (length === -1)
            length = buffer.byteLength - offset;

        this._bytes = new Uint8Array(buffer, offset, length);
        this._view = new DataView(buffer, offset, length);
        this._length = length;
    }

    public get data(): Uint8Array {
        return this._bytes;
    }

    public get position(): number {
        return this._pos;
    }

    public set position(value: number) {
        if (value > this._length)
            throw new Error('Out of bounds');
        this._pos = value;
    }

    public get length(): number {
        return this._length;
    }

    public skip(count: number): void {
        this._pos += count;
    }

    private validate(forward: number): void {
        if (this._pos + forward > this._length)
            throw new Error('Out of bounds');
    }

    public readByte(): number {
        this.validate(1);
        return this._view.getInt8(this._pos++);
    }

    public readUbyte(): number {
        return this._bytes[this._pos++];
    }

    public readBool(): boolean {
        return this.readByte() === 1;
    }

    public readShort(): number {
        this.validate(2);
        const ret = this._view.getInt16(this._pos, this.littleEndian);
        this._pos += 2;
        return ret;
    }

    public readUshort(): number {
        this.validate(2);
        const ret = this._view.getUint16(this._pos, this.littleEndian);
        this._pos += 2;
        return ret;
    }

    public readInt(): number {
        this.validate(4);
        const ret = this._view.getInt32(this._pos, this.littleEndian);
        this._pos += 4;
        return ret;
    }

    public readUint(): number {
        this.validate(4);
        const ret = this._view.getUint32(this._pos, this.littleEndian);
        this._pos += 4;
        return ret;
    }

    public readFloat(): number {
        this.validate(4);
        const ret = this._view.getFloat32(this._pos, this.littleEndian);
        this._pos += 4;
        return ret;
    }

    /**
     * Reads a length-prefixed UTF-8 string.
     *
     * The decoder is the one used by every FairyGUI runtime: NUL bytes are
     * dropped, and continuation bytes are masked with `0x7F` / `0x3F` rather
     * than the `0x3F` / `0x1F` of strict UTF-8. Those are equivalent for
     * well-formed input (continuation bytes are `0x80..0xBF`), but the exact
     * forms are kept so malformed data decodes identically to the reference.
     */
    public readString(len?: number): string {
        if (len === undefined)
            len = this.readUshort();
        this.validate(len);

        let v = '';
        const max = this._pos + len;
        const u = this._bytes;
        let pos = this._pos;
        while (pos < max) {
            const c = u[pos++];
            if (c < 0x80) {
                if (c !== 0)
                    v += String.fromCharCode(c);
            } else if (c < 0xe0) {
                v += String.fromCharCode(((c & 0x3f) << 6) | (u[pos++] & 0x7f));
            } else if (c < 0xf0) {
                const c2 = u[pos++];
                v += String.fromCharCode(((c & 0x1f) << 12) | ((c2 & 0x7f) << 6) | (u[pos++] & 0x7f));
            } else {
                const c2 = u[pos++];
                const c3 = u[pos++];
                v += String.fromCharCode(((c & 0x0f) << 18) | ((c2 & 0x7f) << 12) | ((c3 << 6) & 0x7f) | (u[pos++] & 0x7f));
            }
        }
        this._pos += len;

        return v;
    }

    /** Reads a string-table reference. `65534` is null, `65533` is `""`. */
    public readS(): string | null {
        const index = this.readUshort();
        if (index === 65534) // null
            return null;
        else if (index === 65533)
            return '';
        else
            return this.stringTable[index] ?? null;
    }

    /**
     * Reads four colour bytes.
     *
     * @param hasAlpha when falsy the stored alpha byte is discarded and the
     *   colour comes back opaque — the reference's behaviour for colours the
     *   editor stores as opaque.
     */
    public readColor(hasAlpha = false): Color {
        const r = this.readUbyte();
        const g = this.readUbyte();
        const b = this.readUbyte();
        const a = this.readUbyte();
        return new Color(r, g, b, hasAlpha ? a : 255);
    }

    /**
     * Overwrites the string-table entry the cursor points at.
     *
     * Reads the index the way `readS` does, then writes the new value in place.
     * This mutates the *shared* string table, which is the point: localisation
     * rewrites the package's own strings so every later read of that entry sees
     * the translated text.
     */
    public writeS(value: string): void {
        const index = this.readUshort();
        if (index !== 65534 && index !== 65533)
            this.stringTable[index] = value;
    }

    /** Reads `cnt` string-table references, any of which may be `null`. */
    public readSArray(cnt: number): Array<string | null> {
        const ret = new Array<string | null>(cnt);
        for (let i = 0; i < cnt; i++)
            ret[i] = this.readS();
        return ret;
    }

    /** Reads a length-prefixed sub-buffer that shares this buffer's view. */
    public readBuffer(): ByteBuffer {
        const count = this.readUint();
        this.validate(count);
        // `_bytes` is a view, so its `buffer` is the backing store; the offset
        // makes the sub-buffer start where this one currently sits.
        const ba = new ByteBuffer(this._bytes.buffer as ArrayBuffer, this._bytes.byteOffset + this._pos, count);
        ba.stringTable = this.stringTable;
        ba.version = this.version;
        this._pos += count;
        return ba;
    }

    /**
     * Jumps to a block in the package's index table.
     *
     * The index table lives at `indexTablePos` and holds a segment count, a
     * flag choosing 16- vs 32-bit offsets, then one relative offset per
     * segment. A zero offset means "segment absent" and leaves the cursor put.
     *
     * @returns whether the segment exists.
     */
    public seek(indexTablePos: number, blockIndex: number): boolean {
        const tmp = this._pos;
        this._pos = indexTablePos;
        const segCount = this.readByte();
        if (blockIndex < segCount) {
            const useShort = this.readByte() === 1;
            let newPos: number;
            if (useShort) {
                this._pos += 2 * blockIndex;
                newPos = this.readUshort();
            } else {
                this._pos += 4 * blockIndex;
                newPos = this.readUint();
            }

            if (newPos > 0) {
                this._pos = indexTablePos + newPos;
                return true;
            }
            this._pos = tmp;
            return false;
        }
        this._pos = tmp;
        return false;
    }
}
