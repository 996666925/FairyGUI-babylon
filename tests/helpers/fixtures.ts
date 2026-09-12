import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const UI_DIR = new URL('../fixtures/ui/', import.meta.url);

export function fixturePath(name: string): string {
    return fileURLToPath(new URL(name, UI_DIR));
}

/** Reads a fixture into an `ArrayBuffer` that owns exactly its own bytes. */
export function readFixture(name: string): ArrayBuffer {
    const buf = readFileSync(fixturePath(name));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Reads just the IHDR dimensions of a PNG. */
export function readPngSize(name: string): { width: number; height: number } {
    const buf = readFileSync(fixturePath(name));
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < sig.length; i++) {
        if (buf[i] !== sig[i])
            throw new Error(`${name} is not a PNG`);
    }
    if (buf.toString('ascii', 12, 16) !== 'IHDR')
        throw new Error(`${name} has no leading IHDR chunk`);
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
