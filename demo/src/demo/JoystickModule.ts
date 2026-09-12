import {
    EaseType,
    EventDispatcher,
    EventType,
    GRoot,
    GTween,
    Point,
    type Event,
    type GButton,
    type GComponent,
    type GObject,
    type GTweener,
} from 'fairygui-babylon';

export class JoystickModule extends EventDispatcher {
    private _InitX: number;
    private _InitY: number;
    private _startStageX!: number;
    private _startStageY!: number;
    private _lastStageX!: number;
    private _lastStageY!: number;
    private _button: GButton;
    private _touchArea: GObject;
    private _thumb: GObject;
    private _center: GObject;
    private touchId: number;
    private _tweener: GTweener | null = null;
    private _curPos: Point;

    public static JoystickMoving: string = 'JoystickMoving';
    public static JoystickUp: string = 'JoystickUp';

    public radius: number;

    public constructor(mainView: GComponent) {
        super();

        this._button = mainView.getChild('joystick')!.asButton;
        this._button.changeStateOnClick = false;
        this._thumb = this._button.getChild('thumb')!;
        this._touchArea = mainView.getChild('joystick_touch')!;
        this._center = mainView.getChild('joystick_center')!;

        this._InitX = this._center.x + this._center.width / 2;
        this._InitY = this._center.y + this._center.height / 2;
        this.touchId = -1;
        this.radius = 150;

        this._curPos = new Point();

        this._touchArea.on(EventType.TOUCH_BEGIN, this.onTouchDown, this);
    }

    public Trigger(evt: Event): void {
        this.onTouchDown(evt);
    }

    private onTouchDown(evt: Event): void {
        if (this.touchId == -1) {//First touch
            this.touchId = evt.touchId;

            if (this._tweener != null) {
                this._tweener.kill();
                this._tweener = null;
            }

            // The reference converted the stage pointer with
            // `GRoot.inst.globalToLocal(stage.mouseX, stage.mouseY, out)`; the
            // root's input processor already answers in UI-root space.
            GRoot.inst.getTouchPosition(evt.touchId, this._curPos);
            let bx: number = this._curPos.x;
            let by: number = this._curPos.y;
            this._button.selected = true;

            if (bx < 0)
                bx = 0;
            else if (bx > this._touchArea.width)
                bx = this._touchArea.width;

            if (by > GRoot.inst.height)
                by = GRoot.inst.height;
            else if (by < this._touchArea.y)
                by = this._touchArea.y;

            this._lastStageX = bx;
            this._lastStageY = by;
            this._startStageX = bx;
            this._startStageY = by;

            this._center.visible = true;
            this._center.x = bx - this._center.width / 2;
            this._center.y = by - this._center.height / 2;
            this._button.x = bx - this._button.width / 2;
            this._button.y = by - this._button.height / 2;

            const deltaX: number = bx - this._InitX;
            const deltaY: number = by - this._InitY;
            const degrees: number = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
            this._thumb.rotation = degrees + 90;

            GRoot.inst.on(EventType.TOUCH_MOVE, this.OnTouchMove, this);
            GRoot.inst.on(EventType.TOUCH_END, this.OnTouchUp, this);
        }
    }

    private OnTouchUp(evt: Event): void {
        if (this.touchId != -1 && evt.touchId == this.touchId) {
            this.touchId = -1;
            this._thumb.rotation = this._thumb.rotation + 180;
            this._center.visible = false;
            this._tweener = GTween.to2(this._button.x, this._button.y, this._InitX - this._button.width / 2, this._InitY - this._button.height / 2, 0.3)
                .setTarget(this._button, this._button.setPosition)
                .setEase(EaseType.CircOut)
                .onComplete(this.onTweenComplete, this);

            GRoot.inst.off(EventType.TOUCH_MOVE, this.OnTouchMove, this);
            GRoot.inst.off(EventType.TOUCH_END, this.OnTouchUp, this);

            this.emit(JoystickModule.JoystickUp);
        }
    }

    private onTweenComplete(): void {
        this._tweener = null;
        this._button.selected = false;
        this._thumb.rotation = 0;
        this._center.visible = true;
        this._center.x = this._InitX - this._center.width / 2;
        this._center.y = this._InitY - this._center.height / 2;
    }

    private OnTouchMove(evt: Event): void {
        if (this.touchId != -1 && evt.touchId == this.touchId) {
            GRoot.inst.getTouchPosition(evt.touchId, this._curPos);
            const bx: number = this._curPos.x;
            const by: number = this._curPos.y;
            const moveX: number = bx - this._lastStageX;
            const moveY: number = by - this._lastStageY;
            this._lastStageX = bx;
            this._lastStageY = by;
            let buttonX: number = this._button.x + moveX;
            let buttonY: number = this._button.y + moveY;

            let offsetX: number = buttonX + this._button.width / 2 - this._startStageX;
            let offsetY: number = buttonY + this._button.height / 2 - this._startStageY;

            const rad: number = Math.atan2(offsetY, offsetX);
            const degree: number = rad * 180 / Math.PI;
            this._thumb.rotation = degree + 90;

            const maxX: number = this.radius * Math.cos(rad);
            const maxY: number = this.radius * Math.sin(rad);
            if (Math.abs(offsetX) > Math.abs(maxX))
                offsetX = maxX;
            if (Math.abs(offsetY) > Math.abs(maxY))
                offsetY = maxY;

            buttonX = this._startStageX + offsetX;
            buttonY = this._startStageY + offsetY;
            if (buttonX < 0)
                buttonX = 0;
            if (buttonY > GRoot.inst.height)
                buttonY = GRoot.inst.height;

            this._button.x = buttonX - this._button.width / 2;
            this._button.y = buttonY - this._button.height / 2;

            this.emit(JoystickModule.JoystickMoving, degree);
        }
    }
}
