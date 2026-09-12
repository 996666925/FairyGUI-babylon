export class ToolSet {
    public static startsWith(source: string, str: string, ignoreCase?: boolean): boolean {
        if (!source)
            return false;
        else if (source.length < str.length)
            return false;

        source = source.substring(0, str.length);
        if (!ignoreCase)
            return source === str;
        else
            return source.toLowerCase() === str.toLowerCase();
    }

    public static encodeHTML(str: string): string {
        if (!str)
            return '';
        else
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/'/g, '&apos;').replace(/"/g, '&quot;');
    }

    public static clamp(value: number, min: number, max: number): number {
        if (value < min)
            value = min;
        else if (value > max)
            value = max;
        return value;
    }

    public static clamp01(value: number): number {
        if (value > 1)
            value = 1;
        else if (value < 0)
            value = 0;
        return value;
    }

    public static lerp(start: number, end: number, percent: number): number {
        return start + percent * (end - start);
    }

    /** Wraps `t` into `[0, length)`. */
    public static repeat(t: number, length: number): number {
        return t - Math.floor(t / length) * length;
    }

    public static distance(x1: number, y1: number, x2: number, y2: number): number {
        return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
    }

    /** Strips the directory and the extension from a path. */
    public static mainFileName(fileName: string): string {
        let pos = fileName.lastIndexOf('/');
        if (pos !== -1)
            fileName = fileName.substring(pos + 1);
        pos = fileName.lastIndexOf('.');
        return pos === -1 ? fileName : fileName.substring(0, pos);
    }
}
