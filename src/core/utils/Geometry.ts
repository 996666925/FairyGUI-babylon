export class Point {
    public x: number;
    public y: number;

    public constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    public setTo(x: number, y: number): Point {
        this.x = x;
        this.y = y;
        return this;
    }

    public copy(source: Point): Point {
        this.x = source.x;
        this.y = source.y;
        return this;
    }

    public clone(): Point {
        return new Point(this.x, this.y);
    }
}

export class Rect {
    public x = 0;
    public y = 0;
    public width = 0;
    public height = 0;

    public constructor(x = 0, y = 0, width = 0, height = 0) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }

    public get xMax(): number {
        return this.x + this.width;
    }

    public get yMax(): number {
        return this.y + this.height;
    }

    public setTo(x: number, y: number, width: number, height: number): Rect {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        return this;
    }

    public copy(source: Rect): Rect {
        this.x = source.x;
        this.y = source.y;
        this.width = source.width;
        this.height = source.height;
        return this;
    }

    public clone(): Rect {
        return new Rect(this.x, this.y, this.width, this.height);
    }

    public contains(x: number, y: number): boolean {
        return x >= this.x && x < this.x + this.width && y >= this.y && y < this.y + this.height;
    }

    public intersects(other: Rect): boolean {
        return !(other.x > this.xMax || other.xMax < this.x || other.y > this.yMax || other.yMax < this.y);
    }
}
