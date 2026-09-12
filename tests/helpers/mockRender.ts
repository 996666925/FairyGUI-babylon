import { BlendMode, FillMethod, FillOrigin, FlipType } from '../../src/core/FieldTypes.js';
import type { BitmapFont } from '../../src/core/display/BitmapFont.js';
import { Color } from '../../src/core/utils/Color.js';
import { Point, Rect } from '../../src/core/utils/Geometry.js';
import type {
    IGraphObject,
    IImageObject,
    IRenderFactory,
    IRenderObject,
    ITextObject,
    SpriteTrim,
} from '../../src/core/render/IRenderObject.js';

/**
 * A headless render backend.
 *
 * Nothing here draws: every object keeps plain state and appends its method
 * names to `calls`, so a test can assert on either the resulting properties or
 * the order in which the core touched them. Coordinates follow the interface's
 * rule — y down, degrees clockwise — and are never transformed.
 */
export class MockRenderObject implements IRenderObject {
    /** Method names, in call order. */
    public calls: string[] = [];
    public disposed = false;

    public userData: unknown = null;

    protected _children: IRenderObject[] = [];
    protected _parent: MockRenderObject | null = null;

    protected _x = 0;
    protected _y = 0;
    protected _scaleX = 1;
    protected _scaleY = 1;
    protected _pivotX = 0;
    protected _pivotY = 0;
    protected _width = 0;
    protected _height = 0;

    public angle = 0;
    public skewX = 0;
    public skewY = 0;
    public alpha = 1;
    public visible = true;
    public grayed = false;
    public blendMode: BlendMode = BlendMode.Normal;
    public sortingOrder = 0;
    public pixelSnapping = false;
    public scrollRect: Rect | null = null;
    public mask: IRenderObject | null = null;
    public maskInverted = false;

    protected log(method: string): void {
        this.calls.push(method);
    }

    public get parent(): IRenderObject | null {
        return this._parent;
    }

    public get numChildren(): number {
        return this._children.length;
    }

    public getChildAt(index: number): IRenderObject | null {
        return this._children[index] ?? null;
    }

    public addChild(child: IRenderObject): void {
        this.addChildAt(child, this._children.length);
    }

    public addChildAt(child: IRenderObject, index: number): void {
        const mock = child as MockRenderObject;
        if (mock._parent === this)
            this.setChildIndex(child, index);
        else {
            mock._parent?._removeChild(mock);
            mock._parent = this;
            this._children.splice(index, 0, child);
        }
        this.log('addChildAt');
    }

    public removeChild(child: IRenderObject): void {
        if (this._removeChild(child as MockRenderObject))
            this.log('removeChild');
    }

    private _removeChild(child: MockRenderObject): boolean {
        const index = this._children.indexOf(child);
        if (index === -1)
            return false;
        this._children.splice(index, 1);
        child._parent = null;
        return true;
    }

    public removeChildren(beginIndex = 0, endIndex = -1): void {
        if (endIndex < 0 || endIndex >= this._children.length)
            endIndex = this._children.length - 1;
        for (let i = beginIndex; i <= endIndex; i++) {
            const child = this._children[i] as MockRenderObject;
            if (child)
                child._parent = null;
        }
        this._children.splice(beginIndex, endIndex - beginIndex + 1);
        this.log('removeChildren');
    }

    public setChildIndex(child: IRenderObject, index: number): void {
        const old = this._children.indexOf(child);
        if (old === -1)
            return;
        this._children.splice(old, 1);
        this._children.splice(Math.min(index, this._children.length), 0, child);
        this.log('setChildIndex');
    }

    public getChildIndex(child: IRenderObject): number {
        return this._children.indexOf(child);
    }

    public setPosition(x: number, y: number): void {
        this._x = x;
        this._y = y;
        this.log('setPosition');
    }

    public get positionX(): number {
        return this._x;
    }

    public get positionY(): number {
        return this._y;
    }

    public setScale(sx: number, sy: number): void {
        this._scaleX = sx;
        this._scaleY = sy;
        this.log('setScale');
    }

    public get scaleX(): number {
        return this._scaleX;
    }

    public get scaleY(): number {
        return this._scaleY;
    }

    public setPivot(x: number, y: number): void {
        this._pivotX = x;
        this._pivotY = y;
        this.log('setPivot');
    }

    public get pivotX(): number {
        return this._pivotX;
    }

    public get pivotY(): number {
        return this._pivotY;
    }

    public setContentSize(w: number, h: number): void {
        this._width = w;
        this._height = h;
        this.log('setContentSize');
    }

    public get contentWidth(): number {
        return this._width;
    }

    public get contentHeight(): number {
        return this._height;
    }

    /**
     * Sums the positions up the chain, less this object's own pivot offset.
     *
     * Rotation and scale are ignored — enough to keep `GObject`'s coordinate
     * helpers sane in a test, and honest about being a mock. The pivot is not:
     * local `(0, 0)` is the content box's top-left on the real backend, which
     * is what every `GObject` coordinate helper assumes, and a mock that maps it
     * to the node position instead would let a pivot mistake through — a drag
     * that followed the pointer only for objects with no pivot, say.
     */
    public localToGlobal(x: number, y: number, result?: Point): Point {
        const out = result ?? new Point();
        let px = x - this._pivotX * this._width;
        let py = y - this._pivotY * this._height;
        let node: IRenderObject | null = this;
        while (node) {
            px += node.positionX;
            py += node.positionY;
            node = node.parent;
        }
        out.setTo(px, py);
        this.log('localToGlobal');
        return out;
    }

    public globalToLocal(x: number, y: number, result?: Point): Point {
        const out = result ?? new Point();
        let px = x;
        let py = y;
        let node: IRenderObject | null = this;
        while (node) {
            px -= node.positionX;
            py -= node.positionY;
            node = node.parent;
        }
        out.setTo(px + this._pivotX * this._width, py + this._pivotY * this._height);
        this.log('globalToLocal');
        return out;
    }

    public hitTest(x: number, y: number): boolean {
        return x >= 0 && y >= 0 && x < this._width && y < this._height;
    }

    public dispose(): void {
        this.disposed = true;
        this._parent?._removeChild(this);
        this.log('dispose');
    }
}

/** `MockRenderObject` plus the members an image backend would carry. */
export class MockImageObject extends MockRenderObject implements IImageObject {
    public scale9Grid: Rect | null = null;
    public scaleByTile = false;
    public tileGridIndice = 0;
    public flip: FlipType = FlipType.None;
    public fillMethod: FillMethod = FillMethod.None;
    public fillOrigin: FillOrigin = FillOrigin.Top;
    public fillClockwise = true;
    public fillAmount = 1;
    public color = new Color(255, 255, 255, 255);
    public hitTestShape: ((x: number, y: number) => boolean) | null = null;
    /** The last `setSprite` arguments, for assertions. */
    public sprite: { texture: unknown; rect: Rect | null; rotated: boolean; trim: SpriteTrim | null } | null = null;

    public setSprite(texture: unknown | null, rect: Rect | null, rotated: boolean, trim: SpriteTrim | null = null): void {
        this.sprite = { texture, rect, rotated, trim };
        this.log('setSprite');
    }
}

/** `MockRenderObject` plus the members a text backend would carry. */
export class MockTextObject extends MockRenderObject implements ITextObject {
    public text = '';
    public font: string | null = null;
    public bitmapFont: BitmapFont | null = null;
    public fontSize = 12;
    public color = new Color(255, 255, 255, 255);
    public fontStyle = '';
    public align = 0;
    public verticalAlign = 0;
    public rich = false;
    public singleLine = false;
    public letterSpacing = 0;
    public leading = 3;
    public underline = false;
    public autoSize = 0;
    public wrapWidth = 0;
    public textureScale = 1;
    public stroke = 0;
    public strokeColor = new Color(0, 0, 0, 255);
    public shadowOffsetX = 0;
    public shadowOffsetY = 0;
    public shadowColor = new Color(0, 0, 0, 255);
    public onLinkClick: ((href: string) => void) | null = null;

    /** No markup, so no links; a test that needs one overrides this. */
    public hitTestLink(): string | null {
        return null;
    }

    public measureTextWidth(): number {
        return this.text.length * this.fontSize * 0.5;
    }

    public measureTextHeight(): number {
        return this.singleLine ? this.fontSize : this.fontSize + this.leading;
    }
}

/** `MockRenderObject` plus the members a vector backend would carry. */
export class MockGraphObject extends MockRenderObject implements IGraphObject {
    public color = new Color(255, 255, 255, 255);
    /** Draw call names, in order, for tests that care about the shapes. */
    public draws: string[] = [];

    public clear(): void {
        this.draws.length = 0;
        this.log('clear');
    }

    public drawRect(): void {
        this.draws.push('drawRect');
        this.log('drawRect');
    }

    public drawRoundRect(): void {
        this.draws.push('drawRoundRect');
        this.log('drawRoundRect');
    }

    public drawEllipse(): void {
        this.draws.push('drawEllipse');
        this.log('drawEllipse');
    }

    public drawPolygon(): void {
        this.draws.push('drawPolygon');
        this.log('drawPolygon');
    }

    public drawPath(): void {
        this.draws.push('drawPath');
        this.log('drawPath');
    }
}

/**
 * A factory over the three mock kinds, keeping every object it ever made.
 *
 * The return types are the concrete classes rather than the `I*` interfaces —
 * covariant, and it spares tests a cast every time they reach for a
 * mock-specific member.
 */
export class MockRenderer implements IRenderFactory {
    public objects: MockRenderObject[] = [];

    /** The node handed to `attachToStage`, once something becomes the root. */
    public stageNode: IRenderObject | null = null;

    /** Viewport the mock reports; tests may change it and fire the callbacks. */
    public viewportSize = { width: 1136, height: 640 };

    private _resizeCallbacks: Array<(width: number, height: number) => void> = [];

    private track<T extends MockRenderObject>(obj: T): T {
        this.objects.push(obj);
        return obj;
    }

    public createObject(): MockRenderObject {
        return this.track(new MockRenderObject());
    }

    public createImage(): MockImageObject {
        return this.track(new MockImageObject());
    }

    public createText(): MockTextObject {
        return this.track(new MockTextObject());
    }

    public createGraph(): MockGraphObject {
        return this.track(new MockGraphObject());
    }

    public attachToStage(node: IRenderObject): void {
        this.stageNode = node;
    }

    public get viewportWidth(): number {
        return this.viewportSize.width;
    }

    public get viewportHeight(): number {
        return this.viewportSize.height;
    }

    public onViewportResize(callback: (width: number, height: number) => void): void {
        this._resizeCallbacks.push(callback);
    }

    /** Resizes the viewport and notifies everyone who asked to hear about it. */
    public resizeViewport(width: number, height: number): void {
        this.viewportSize = { width, height };
        for (const cb of this._resizeCallbacks)
            cb(width, height);
    }
}
