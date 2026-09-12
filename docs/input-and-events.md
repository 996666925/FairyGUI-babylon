# 输入与事件

渲染后端只负责画，不负责监听。你的应用把指针事件转发给 UI 根节点的
`InputProcessor`，再通过显示列表接收 `Event`。

## 喂入输入处理器

所有坐标都是 **UI 单位**：原点在 UI 左上角，y 轴向下。如果你的 canvas 铺满窗口，这就是
指针位置减去 canvas 的包围矩形，不需要缩放。

```ts
const input = root.inputProcessor;

input.touchBegin(pointerId, x, y, button);   // button：0 左键，1 右键，2 中键
input.touchMove(pointerId, x, y);            // 按住期间
input.touchEnd(pointerId, x, y);
input.touchCancel(pointerId, x, y);          // 系统取消或失焦
input.mouseMove(x, y);                       // 悬停，无按键
input.mouseWheel(delta, x, y);               // 正数 = 向下
```

| 成员 | 用途 |
| --- | --- |
| `getTouchPosition(touchId?, result?)` | 某个指针的最后位置。 |
| `getTouchTarget(touchId?)` | 指针下的 `GObject`。 |
| `getAllTouches(out?)` | 活跃指针的 id。 |
| `getPressedTouchId()` | 当前按下的 id，没有则 `null`。它不等于 `getAllTouches()` 的第一项 —— 悬停会占用一个自己的槽位。 |
| `addTouchMonitor(touchId, target)` / `removeTouchMonitor(target)` | 即使指针离开，也继续把该指针的移动发给某个对象。 |
| `cancelClick(touchId)` | 让当前这次按下不再算作点击。 |
| `simulateClick(target)` | 不用真实输入，合成按下/抬起/点击。 |
| `clock` | 秒时钟；测试里替换它可让双击计时确定化。 |
| `isMobile` | 改变 roll-out 行为：抬起时视为指针已经离开。 |
| `onTouchBeginHook` | 在任何按下分发之前运行。`GRoot` 用它关闭弹窗和 tooltip。 |

### 一套完整的宿主接入

参考实现在 `demo/src/UiHost.ts`。最容易弄错的两点：

**在 document 上、捕获阶段监听。** Babylon 的相机控制在 canvas 自身上监听。在那里注册
的监听器运行在相机已经开始环绕**之后**，于是这次点击穿透到了背后的 3D 场景。在祖先节点
的捕获阶段接住事件，就能在它到达 canvas 前拦住：

```ts
document.addEventListener('pointerdown', (event) => {
    if (event.target !== canvas) return;
    const { x, y } = toUI(event);          // clientX - rect.left, clientY - rect.top
    if (root.hitTest(new Point(x, y)) !== null)
        event.stopPropagation();           // 这里有 UI 对象，别让相机收到
    input.touchBegin(event.pointerId, x, y, event.button);
}, true);
```

**在拖拽期间持有该指针。** 只在按下时声明归属，会让拖拽一离开对象就把指针交给相机。
按下时记下指针 id，并在释放前一直调用 `stopPropagation`。`GRoot.hitTest` 在纯背景上返回
`null`，因为根节点不是不透明的 —— 而这种情况恰恰应该交给相机。

`canvas.setPointerCapture` 能让事件即使移出窗口也仍指向 canvas。合成事件可能被拒绝，
所以要用 try/catch 包住并继续。

## 事件

```ts
obj.on(EventType.CLICK, () => { /* … */ });
obj.off(EventType.CLICK, listener);
```

### 事件类型

这些字符串值属于公开 API。

| 常量 | 值 | 由谁发出 |
| --- | --- | --- |
| `TOUCH_BEGIN` | `fui_touch_begin` | 按下。 |
| `TOUCH_MOVE` | `fui_touch_move` | 按住时移动。 |
| `TOUCH_END` | `fui_touch_end` | 抬起或取消。 |
| `CLICK` | `fui_click` | 在点击容差内完成的按下/抬起。 |
| `RIGHT_CLICK` / `MIDDLE_CLICK` | | 常量已定义，但运行时目前只通过 `CLICK` 上的 `evt.button` 反映按键，并不会发出这两个事件。 |
| `ROLL_OVER` / `ROLL_OUT` | | 指针进入/离开，未按键。 |
| `MOUSE_WHEEL` | | 滚轮；`evt.mouseWheelDelta`。 |
| `DISPLAY` / `UNDISPLAY` | | 挂上/脱离根节点。 |
| `GEAR_STOP` | | 某个齿轮补间结束。 |
| `LINK` | `fui_text_link` | 富文本 `<a>` 被点击；`evt.data` 是 href。 |
| `SUBMIT` | `fui_submit` | `GTextInput` 中按回车；`evt.keyCode`。 |
| `TEXT_CHANGE` | `fui_text_change` | `GTextInput` 中编辑了文本。 |
| `STATUS_CHANGED` | | 控制器切页。 |
| `XY_CHANGED` / `SIZE_CHANGED` / `SIZE_DELAY_CHANGE` | | 几何变化。 |
| `DRAG_START` / `DRAG_MOVE` / `DRAG_END` / `DROP` | | 拖放。 |
| `SCROLL` / `SCROLL_END` | | 滚动面板移动或静止。 |
| `PULL_DOWN_RELEASE` / `PULL_UP_RELEASE` | | 页眉/页脚被拉过阈值后释放。 |
| `CLICK_ITEM` | | `GList` 项被点击；`evt.data` 是该子项。 |
| `CLICK_MENU_ITEM` | | `PopupMenu` 项被点击。 |
| `POSITION_CHANGE` | | |
| `KEY_DOWN` / `KEY_UP` | | |
| `FOCUS_IN` / `FOCUS_OUT` | | `GTextInput` 获得/失去焦点。 |

### `Event` 对象

| 字段 | 含义 |
| --- | --- |
| `type`、`bubbles` | |
| `target` | 事件被分发到的对象。 |
| `currentTarget` | 冒泡过程中当前正在运行监听器的对象。 |
| `initiator` | 由发源控件设置，当它与 `target` 不同时。 |
| `pos` | 指针位置，UI 根坐标。 |
| `touchId`、`clickCount`、`button` | |
| `keyModifiers` | 位掩码；用 `isShiftDown` / `isCtrlDown` / `isAltDown` 判断。 |
| `mouseWheelDelta`、`keyCode` | |
| `data` | 事件相关负载，例如被点击的列表项。 |
| `stopPropagation()` | |
| `preventDefault()` | |
| `captureTouch()` | 把当前 target 注册为触摸监视对象。 |

事件是池化的（`Event.borrow` / `Event.release`），不要在监听器之外保留它。

### `on`/`emit` 与 `dispatchEvent`

两条路径，对应参考实现里 `cc.Node.emit` 与 `dispatchEvent` 的分工：

```ts
obj.emit('custom', 1, 2);          // 不冒泡，同步
obj.dispatchEvent(evt);            // evt.bubbles 为真时冒泡
```

本地通知用 `emit`；需要祖先听到时用 `dispatchEvent`。例如 `EventType.CLICK` 是以
`bubbles = true` 分发的，所以父容器上的监听器能收到子节点的点击。

### 点击、双击与 roll-over

- **点击容差**是 50 px 位移；超过后这次按下不再算点击。
- **双击判定的时间窗口**是 0.45 秒，计数上限为 2。
- 若抬起时被按下的对象已不存在，点击会回退到同时在按下位置下的最近祖先。
- `rollOver` / `rollOut` 从两条链的最近共同祖先开始走，所以嵌套组件会按正确顺序触发
  正确的事件。

## 拖放

单个对象的拖拽，可在编辑器中设定，也可在代码里设置：

```ts
obj.draggable = true;          // 按下即开始拖拽
obj.startDrag(touchId?);       // 或显式开始
obj.stopDrag();
```

全局拖放，用于把一个对象拖到另一个上：

```ts
import { DragDropManager } from 'fairygui-babylon';

DragDropManager.inst.startDrag(source, 'ui://MainMenu/Icon', myPayload, touchId);
DragDropManager.inst.cancel();
DragDropManager.inst.dragging;    // 布尔值
DragDropManager.inst.dragAgent;   // 跟随指针的图标对象
```

事件为源对象上的 `DRAG_START`、`DRAG_MOVE`、`DRAG_END`，以及目标上的 `DROP`。灵敏度
阈值在 `UIConfig`：`touchDragSensitivity`、`clickDragSensitivity`、
`touchScrollSensitivity`。

demo 里的 `BagDemo` 是一个完整的拖放示例。

## 文本输入

`GTextInput` 在被触摸时获得焦点（`requestFocus()` 也是公开的），并唤起平台的文本输入。
在浏览器里就是覆盖在输入框上的真实 DOM `<input>` 或 `<textarea>`，因此输入、选择、剪贴板、
输入法和光标全都正常。它发出的事件与细节见[文本](./text.md)。

## 常见坑

- **坐标必须是 UI 单位。** 用设备像素下的 canvas 位置会看起来大致正确，然后随着像素比
  逐渐偏移。
- **`touchBegin` 要传 button**，默认 `0`。不转发 `event.button` 会让右键/中键看起来像左键。
- **悬停与按下可能是不同的指针 id。** 不传参的 `getTouchTarget()` 返回排在最前的槽位，
  而它可能属于悬停 —— 明确指代你真正关心的那个指针。
- **别忘了持有拖拽。** 拖到一半释放归属，指针就会交给 UI 后面的对象。
- **`touchCancel` 很重要。** 窗口失焦和系统手势都走它，漏掉会让一次按下卡在"已开始"状态。
