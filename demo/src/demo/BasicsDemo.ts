import {
    Color,
    DragDropManager,
    EventType,
    GButton,
    GComponent,
    GGraph,
    GObject,
    GProgressBar,
    GRoot,
    Point,
    PopupMenu,
    UIConfig,
    UIPackage,
    Window,
    type Controller,
    type Event,
} from 'fairygui-babylon';

import { WindowA, WindowB } from './TestWin.js';
import { onFrame } from './Ticker.js';

export class BasicDemo {
    private _view!: GComponent;
    private _backBtn!: GObject;
    private _demoContainer!: GComponent;
    private _cc!: Controller;

    private _demoObjects: Record<string, GComponent> = {};

    constructor() {
        UIConfig.verticalScrollBar = 'ui://Basics/ScrollBar_VT';
        UIConfig.horizontalScrollBar = 'ui://Basics/ScrollBar_HZ';
        UIConfig.popupMenu = 'ui://Basics/PopupMenu';
        UIConfig.buttonSound = 'ui://Basics/click';

        UIPackage.load('ui/Basics').then(() => this.onUILoaded()).catch((err: unknown) => console.error(err));
    }

    onUILoaded(): void {
        const view = UIPackage.createObject('Basics', 'Main')?.asCom;
        if (view === undefined)
            return;
        this._view = view;
        this._view.makeFullScreen();
        GRoot.inst.addChild(this._view);

        this._backBtn = this._view.getChild('btn_Back')!;
        this._backBtn.visible = false;
        this._backBtn.onClick(this.onClickBack, this);

        this._demoContainer = this._view.getChild('container')!.asCom;
        this._cc = this._view.getController('c1')!;

        const cnt: number = this._view.numChildren;
        for (let i: number = 0; i < cnt; i++) {
            const obj: GObject = this._view.getChildAt(i);
            if (obj.group != null && obj.group.name == 'btns')
                obj.onClick(this.runDemo, this);
        }

        this._demoObjects = {};
    }

    destroy(): void {
        UIConfig.verticalScrollBar = '';
        UIConfig.horizontalScrollBar = '';
        UIConfig.popupMenu = '';
        UIConfig.buttonSound = '';
        UIPackage.removePackage('Basics');
    }

    private runDemo(evt: Event): void {
        const type: string = (evt.currentTarget as GObject).name.substring(4);
        let obj: GComponent | undefined = this._demoObjects[type];
        if (obj == null) {
            obj = UIPackage.createObject('Basics', 'Demo_' + type)!.asCom;
            this._demoObjects[type] = obj;
        }

        this._demoContainer.removeChildren();
        this._demoContainer.addChild(obj);
        this._cc.selectedIndex = 1;
        this._backBtn.visible = true;

        switch (type) {
            case 'Button':
                this.playButton();
                break;

            case 'Text':
                this.playText();
                break;

            case 'Window':
                this.playWindow();
                break;

            case 'Popup':
                this.playPopup();
                break;

            case 'Drag&Drop':
                this.playDragDrop();
                break;

            case 'Depth':
                this.playDepth();
                break;

            case 'Grid':
                this.playGrid();
                break;

            case 'ProgressBar':
                this.playProgressBar();
                break;
        }
    }

    // The reference's handler took the (unused) event; dropping the parameter is
    // what `noUnusedParameters` requires and changes nothing else.
    private onClickBack(): void {
        this._cc.selectedIndex = 0;
        this._backBtn.visible = false;
    }

    //------------------------------
    private playButton(): void {
        const obj: GComponent = this._demoObjects['Button'];
        obj.getChild('n34')!.onClick(this.__clickButton, this);
    }

    private __clickButton(): void {
        console.log('click button');
    }

    //------------------------------
    private playText(): void {
        const obj: GComponent = this._demoObjects['Text'];
        obj.getChild('n12')!.on(EventType.LINK, this.__clickLink, this);

        obj.getChild('n25')!.onClick(this.__clickGetInput, this);
    }

    private __clickLink(link: string): void {
        const obj: GComponent = this._demoObjects['Text'];
        obj.getChild('n12')!.text = '[img]ui://9leh0eyft9fj5f[/img][color=#FF0000]你点击了链接[/color]：' + link;
    }

    private __clickGetInput(): void {
        const obj: GComponent = this._demoObjects['Text'];
        obj.getChild('n24')!.text = obj.getChild('n22')!.text;
    }

    //------------------------------
    private _winA: Window | null = null;
    private _winB: Window | null = null;
    private playWindow(): void {
        const obj: GComponent = this._demoObjects['Window'];
        obj.getChild('n0')!.onClick(this.__clickWindowA, this);
        obj.getChild('n1')!.onClick(this.__clickWindowB, this);
    }

    private __clickWindowA(): void {
        if (this._winA == null)
            this._winA = new WindowA();
        this._winA.show();
    }

    private __clickWindowB(): void {
        if (this._winB == null)
            this._winB = new WindowB();
        this._winB.show();
    }

    //------------------------------
    private _pm: PopupMenu | null = null;
    private _popupCom: GComponent | null = null;
    private playPopup(): void {
        if (this._pm == null) {
            this._pm = new PopupMenu();
            this._pm.addItem('Item 1');
            this._pm.addItem('Item 2');
            this._pm.addItem('Item 3');
            this._pm.addItem('Item 4');

            if (this._popupCom == null) {
                this._popupCom = UIPackage.createObject('Basics', 'Component12')!.asCom;
                this._popupCom.center();
            }
        }

        const obj: GComponent = this._demoObjects['Popup'];
        const btn: GObject = obj.getChild('n0')!;
        btn.onClick(this.__clickPopup1, this);

        const btn2: GObject = obj.getChild('n1')!;
        btn2.onClick(this.__clickPopup2, this);
    }

    private __clickPopup1(evt: Event): void {
        const btn: GObject = evt.currentTarget as GObject;
        this._pm!.show(btn, true);
    }

    private __clickPopup2(): void {
        GRoot.inst.showPopup(this._popupCom!);
    }

    //------------------------------
    private playDragDrop(): void {
        const obj: GComponent = this._demoObjects['Drag&Drop'];
        const btnA: GObject = obj.getChild('a')!;
        btnA.draggable = true;

        const btnB: GButton = obj.getChild('b')!.asButton;
        btnB.draggable = true;
        btnB.on(EventType.DRAG_START, this.__onDragStart, this);

        const btnC: GButton = obj.getChild('c')!.asButton;
        btnC.icon = null;
        btnC.on(EventType.DROP, this.__onDrop, this);

        const btnD: GObject = obj.getChild('d')!;
        btnD.draggable = true;
        const bounds: GObject = obj.getChild('bounds')!;
        let rect = bounds.localToGlobalRect(0, 0, bounds.width, bounds.height);
        rect = GRoot.inst.globalToLocalRect(rect.x, rect.y, rect.width, rect.height, rect);

        //因为这时候面板还在从右往左动，所以rect不准确，需要用相对位置算出最终停下来的范围
        rect.x -= obj.parent!.x;

        btnD.dragBounds = rect;
    }

    private __onDragStart(evt: Event): void {
        const btn: GButton = evt.currentTarget as GButton;
        btn.stopDrag();//取消对原目标的拖动，换成一个替代品
        DragDropManager.inst.startDrag(btn, btn.icon ?? '', btn.icon);
    }

    /**
     * Drops the dragged icon onto the button.
     *
     * The reference's Laya listener took `(data, evt)`. Here
     * `DragDropManager.onDragEnd` emits `(target, data)` — the drop target
     * first — so the two arguments arrive in the other order.
     */
    private __onDrop(target: GObject, data: unknown): void {
        const btn: GButton = target as GButton;
        btn.icon = data as string | null;
    }

    //------------------------------
    private startPos: Point = new Point();
    private playDepth(): void {
        const obj: GComponent = this._demoObjects['Depth'];
        const testContainer: GComponent = obj.getChild('n22')!.asCom;
        const fixedObj: GObject = testContainer.getChild('n0')!;
        fixedObj.sortingOrder = 100;
        fixedObj.draggable = true;

        let numChildren: number = testContainer.numChildren;
        let i: number = 0;
        while (i < numChildren) {
            const child: GObject = testContainer.getChildAt(i);
            if (child != fixedObj) {
                testContainer.removeChildAt(i);
                numChildren--;
            }
            else
                i++;
        }
        this.startPos.x = fixedObj.x;
        this.startPos.y = fixedObj.y;

        obj.getChild('btn0')!.onClick(this.__click1, this);
        obj.getChild('btn1')!.onClick(this.__click2, this);
    }

    private __click1(): void {
        const graph: GGraph = new GGraph();
        this.startPos.x += 10;
        this.startPos.y += 10;
        graph.setPosition(this.startPos.x, this.startPos.y);
        graph.setSize(150, 150);
        graph.drawRect(1, '#000000', '#FF0000');

        const obj: GComponent = this._demoObjects['Depth'];
        obj.getChild('n22')!.asCom.addChild(graph);
    }

    private __click2(): void {
        const graph: GGraph = new GGraph();
        this.startPos.x += 10;
        this.startPos.y += 10;
        graph.setPosition(this.startPos.x, this.startPos.y);
        graph.setSize(150, 150);
        graph.drawRect(1, '#000000', '#00FF00');
        graph.sortingOrder = 200;

        const obj: GComponent = this._demoObjects['Depth'];
        obj.getChild('n22')!.asCom.addChild(graph);
    }

    //------------------------------
    private playGrid(): void {
        const obj: GComponent = this._demoObjects['Grid'];
        const list1 = obj.getChild('list1')!.asList;
        list1.removeChildrenToPool();
        const testNames: Array<string> = ['苹果手机操作系统', '安卓手机操作系统', '微软手机操作系统', '微软桌面操作系统', '苹果桌面操作系统', '未知操作系统'];
        const testColors: Array<number> = [0xFFFF00, 0xFF0000, 0xFFFFFF, 0x0000FF];
        const cnt: number = testNames.length;
        for (let i: number = 0; i < cnt; i++) {
            const item: GButton = list1.addItemFromPool().asButton;
            item.getChild('t0')!.text = '' + (i + 1);
            item.getChild('t1')!.text = testNames[i];
            item.getChild('t2')!.asTextField.color = Color.fromInt(testColors[Math.floor(Math.random() * 4)]);
            item.getChild('star')!.asProgress.value = (Math.floor(Math.random() * 3) + 1) / 3 * 100;
        }

        const list2 = obj.getChild('list2')!.asList;
        list2.removeChildrenToPool();
        for (let i: number = 0; i < cnt; i++) {
            const item: GButton = list2.addItemFromPool().asButton;
            item.getChild('cb')!.asButton.selected = false;
            item.getChild('t1')!.text = testNames[i];
            item.getChild('mc')!.asMovieClip.playing = i % 2 == 0;
            item.getChild('t3')!.text = '' + Math.floor(Math.random() * 10000);
        }
    }

    //---------------------------------------------
    private _stopProgress: (() => void) | null = null;

    private playProgressBar(): void {
        const obj: GComponent = this._demoObjects['ProgressBar'];
        // The reference used `Laya.timer.frameLoop(2, …)`, which fired on every
        // second frame. `onFrame` fires on every rendered frame, so the rate is
        // time-based rather than frame-counted to land on the same speed.
        this._stopProgress = onFrame((dt: number) => this.__playProgress(dt));
        obj.on(EventType.UNDISPLAY, this.__removeTimer, this);
    }

    private __removeTimer(): void {
        this._stopProgress?.();
        this._stopProgress = null;
    }

    private __playProgress(dt: number): void {
        const obj: GComponent = this._demoObjects['ProgressBar'];
        const cnt: number = obj.numChildren;
        for (let i: number = 0; i < cnt; i++) {
            const child: GProgressBar = obj.getChildAt(i) as GProgressBar;
            if (child != null) {
                child.value += dt * 30;
                if (child.value > child.max)
                    child.value = 0;
            }
        }
    }
}
