# 控件

屏幕上的一切都派生自 `GObject`。本文先讲共享的基类 API，再给出控件目录，然后详述签名之外还需要展开说明的控件：列表、树、组、窗口与叠加层栈。

文本控件单独成篇，见[文本](./text.md)；事件、输入与拖放见[输入与事件](./input-and-events.md)。

## `GObject` —— 基类

### 身份与数据

| 成员 | 含义 |
| --- | --- |
| `id` | 运行时分配的唯一 id。只读。 |
| `name` | 编辑器里起的名字；`getChild(name)` 用它查找。 |
| `packageItem` | 构建它的 `PackageItem`（如果有）。 |
| `data` | 给你放自定义数据的自由槽位。 |
| `resourceURL` | 它来自的 `ui://` URL（如果有）。 |
| `node` | 背后对应的后端渲染节点。 |

### 变换与尺寸

| 成员 | 说明 |
| --- | --- |
| `x`、`y`、`setPosition(x, y)` | 相对于父级内容框的位置。 |
| `width`、`height`、`setSize(w, h, ignorePivot?)` | 编辑时设定的内容框。 |
| `actualWidth`、`actualHeight` | 缩放后的尺寸。 |
| `scaleX`、`scaleY`、`setScale(sx, sy)` | |
| `rotation` | 角度，屏幕上顺时针为正。 |
| `skewX`、`skewY`、`setSkew(x, y)` | 角度。 |
| `pivotX`、`pivotY`、`setPivot(x, y, asAnchor?)` | `(0,0)` 是左上，`(1,1)` 是右下。传 `asAnchor` 时，位置指代枢轴点而非左上角。 |
| `pivotAsAnchor` | 枢轴是否充当锚点。 |
| `xMin`、`yMin` | 约束；赋值会夹紧 `x`/`y`。 |
| `pixelSnapping` | 把位置取整到整像素。 |
| `center(restraint?)` | 在父级内居中。 |
| `makeFullScreen()` | 铺满根节点，并随视口变化重新调整。 |
| `ensureSizeCorrect()` | 强制让待定的自动尺寸先算完，再读 `width`/`height`。 |

### 外观与交互

| 成员 | 说明 |
| --- | --- |
| `visible` | 隐藏组件会连同子节点一起隐藏。 |
| `alpha` | `0..1`。后端会沿树向下相乘。 |
| `grayed` | 去饱和。 |
| `blendMode` | 取自 `BlendMode`。注意[渲染](./rendering.md)里的说明。 |
| `sortingOrder` | 同级绘制顺序；越大越晚绘制。 |
| `touchable` | 为 `false` 时命中测试会跳过它。 |
| `tooltips` | 悬停时通过根节点的 tooltip 窗口显示的文本。 |
| `draggable` | 按下即开始拖拽；也可用 `startDrag()` / `stopDrag()` 显式控制。 |
| `group` | 它所属的 `GGroup`（如果有）。 |
| `onStage` | 是否已挂在某个 `GRoot` 下。 |

### 坐标、命中测试、关联

| 成员 | 说明 |
| --- | --- |
| `localToGlobal(x?, y?, result?)` | 转到 UI 根空间。 |
| `globalToLocal(x?, y?, result?)` | 从 UI 根空间转回。 |
| `hitTest(globalPt, forTouch?)` | 返回 UI 根坐标点下的 `GObject`，没有则 `null`。 |
| `relations`、`addRelation(target, type, usePercent?)`、`removeRelation(target, type)` | 编辑器里的关联，代码里也能操作。`type` 是 `RelationType`。 |
| `gearXY`、`gearSize`、`gearLook`、`getGear(index)` | 齿轮访问器；见[动画](./animation.md)。 |
| `addDisplayLock()` / `releaseDisplayLock(token)` | 连续设置多个属性时抑制中间布局计算。 |
| `getProp(id)` / `setProp(id, value)` | 按 `ObjectPropID` 访问属性 —— 控制器和翻译据此多态地访问控件特有属性。 |
| `removeFromParent()`、`findParent()`、`dispose()` | |

`GObject.text` 和 `GObject.icon` 在基类上存在，是为了多态访问；真正拥有它们的控件会
覆写访问器。在普通 `GObject` 上设置它们没有任何效果。

`GObject` 还提供一组 `as*` 访问器，用于在拿到 `GObject` 后安全地向下转型：
`asCom`、`asButton`、`asLabel`、`asProgress`、`asTextField`、`asRichTextField`、
`asTextInput`、`asLoader`、`asList`、`asTree`、`asGraph`、`asGroup`、`asSlider`、
`asComboBox`、`asImage`、`asMovieClip`。它们只是类型层面的断言，不会做运行时校验。

### 延迟任务与事件

```ts
obj.callLater(() => obj.visible = false, 0.5);   // 单位秒；由 root.update 驱动

obj.on(EventType.CLICK, () => { /* … */ });
obj.off(EventType.CLICK, listener);
obj.emit('custom');                              // 不冒泡，同步
obj.dispatchEvent(evt);                          // evt.bubbles 为真时冒泡
```

`emit` 与 `dispatchEvent` 的区别、以及完整的 `EventType` 列表，见
[输入与事件](./input-and-events.md)。

## `GComponent` —— 容器

```ts
const comp = new GComponent();
comp.addChild(child);
```

| 成员 | 说明 |
| --- | --- |
| `addChild(child)` / `addChildAt(child, index)` | 添加已有父级的对象会把它移动过来。 |
| `removeChild(child, dispose?)` / `removeChildAt(index, dispose?)` | `dispose` 默认 `false` —— 只脱离，不销毁。 |
| `removeChildren(beginIndex?, endIndex?, dispose?)` | |
| `getChildAt(index)` / `getChild(name)` | |
| `getChildByPath(path)` | `name/name/name`，可用 `../` 向上爬。 |
| `getVisibleChild(name)` | 该名字下第一个真正可见的子节点。 |
| `getChildInGroup(name, group)` | |
| `getChildById(id)` | |
| `getChildIndex(child)`、`setChildIndex(child, index)`、`setChildIndexBefore(child, index)` | |
| `swapChildren(a, b)`、`swapChildrenAt(i, j)` | |
| `numChildren`、`isAncestorOf(child)` | |
| `controllers` / `getController(name)` / `getControllerAt(index)` / `addController(c)` / `removeController(c)` | |
| `applyController(c)` / `applyAllControllers()` | 重跑某个控制器的动作与齿轮。 |
| `getTransition(name)` / `getTransitionAt(index)` | |
| `scrollPane` | 组件被编辑为滚动视图时非空。 |
| `opaque` | 命中测试能否停在该组件自身的框上。 |
| `margin` | 编辑器的边距，被关联和 `makeFullScreen` 使用。 |
| `childrenRenderOrder`、`apexIndex` | `Ascent`、`Descent` 或 `Arch`；`Arch` 时由 `apexIndex` 指定顶点。 |
| `mask` / `setMask(obj, inverted)` | 用另一个对象的轮廓裁剪子节点。 |
| `baseUserData` | 组件编辑时设的用户数据字符串。 |
| `viewWidth` | 可见宽度；滚动视图下是视口宽而非内容宽。 |
| `setBoundsChangedFlag()`、`ensureBoundsCorrect()`、`setBounds(...)` | 手动控制自动边界计算。 |

## 控件目录

| 控件 | `ObjectType` | 用途 | 要点 |
| --- | --- | --- | --- |
| `GImage` | `Image` | 包里的图片。 | `color`、`flip`、九宫格、平铺、`fillMethod`/`fillOrigin`/`fillAmount`。 |
| `GGraph` | `Graph` | 矢量绘制。 | `drawRect`、`drawEllipse`、`drawRegularPolygon`、`drawPolygon`、`clearGraphics`。 |
| `GLoader` | `Loader` | 一个 URL 或 `ui://` 资源。 | `url`、`fill`（`LoaderFillType`）、`autoSize`、`shrinkOnly`、错误占位图。 |
| `GLoader3D` | `Loader3D` | 骨骼/3D 内容宿主。 | `url`、`animationName`、`skinName`、`loop`、`playing`、`frame`；内容由工厂提供。 |
| `GMovieClip` | `MovieClip` | 序列帧动画。 | `playing`、`frame`、`timeScale`、`setPlaySettings`、`rewind`、`syncStatus`。 |
| `GTextField` | `Text` | 普通文本。 | 见[文本](./text.md)。 |
| `GRichTextField` | `RichText` | 带链接的标记文本。 | `linkUnderline`、`linkColor`。 |
| `GTextInput` | `InputText` | 可编辑输入框。 | `editable`、`maxLength`、`password`、`promptText`、`requestFocus`。 |
| `GButton` | `Button` | 按钮与开关。 | `icon`、`title`、`selected`、`mode`（`ButtonMode`）、`relatedController`、`changeStateOnClick`、`linkedPopup`。 |
| `GLabel` | `Label` | 图标 + 文本行。 | `icon`、`title`、`text`、`titleColor`、`titleFontSize`、`editable`。 |
| `GProgressBar` | `ProgressBar` | 进度显示。 | `min`、`max`、`value`、`titleType`、`tweenValue(value, duration)`。 |
| `GSlider` | `Slider` | 数值滑块。 | `min`、`max`、`value`、`wholeNumbers`、`titleType`。 |
| `GScrollBar` | `ScrollBar` | 滚动面板的滚动条。 | 通常由 `ScrollPane` 使用；`setScrollPane`、`setDisplayPerc`、`setScrollPerc`。 |
| `GComboBox` | `ComboBox` | 下拉框。 | `items`、`icons`、`values`、`selectedIndex`、`value`、`visibleItemCount`、`popupDirection`。 |
| `GList` | `List` | 布局、选择、虚拟化。 | 见下文。 |
| `GTree` | `Tree` | 层级列表。 | 见下文。 |
| `GGroup` | `Group` | 布局其成员，但不是它们的父级。 | 见下文。 |

## `GImage`

```ts
image.color = new Color(255, 128, 128, 255);
image.fillMethod = FillMethod.Radial360;   // None、Horizontal、Vertical、Radial90/180/360
image.fillOrigin = FillOrigin.Top;         // Top、Bottom、Left、Right
image.fillClockwise = true;
image.fillAmount = 0.6;                    // 0..1
image.flip = FlipType.Horizontal;          // None、Horizontal、Vertical、Both
```

九宫格和平铺在编辑器里设定并从包项读取，没有运行时 API 可改。

## `GGraph`

```ts
const g = new GGraph();
g.drawRect(1, new Color(0, 0, 0), new Color(255, 255, 255, 255), 4);
g.drawRoundRect(1, lineColor, fillColor, 8, [10, 10, 0, 0]);  // 每个角的半径
g.drawEllipse(1, lineColor, fillColor);
g.drawPolygon(1, lineColor, fillColor, [0, 0, 100, 0, 50, 80]);
g.clearGraphics();
```

`drawRect(lineSize, lineColor, fillColor, corner?)` 接收的是圆角半径而不是坐标：图形
铺满对象自身的尺寸。`distances` 为编辑器里制作的圆角矩形提供每个角的半径。

## `GLoader` 与 `GLoader3D`

`GLoader` 显示包对象或外部图片：

```ts
loader.url = 'ui://MainMenu/Logo';      // 包项
loader.url = '/images/avatar.png';      // 外部图片
loader.fill = LoaderFillType.ScaleNoBorder;
loader.autoSize = true;                 // 采用内容尺寸
```

外部图片走[内容加载器钩子](./packages.md)。加载失败且 `showErrorSign` 开启时，会改为
绘制 `UIConfig.loaderErrorSign`。

`GLoader3D` 承载实现了 `ILoader3DContent` 的内容 —— 运行时不自带骨骼引擎。注册工厂来
提供内容：

```ts
setLoader3DContentFactory({
    createFromPackage: (item) => /* ILoader3DContent | null */ null,
    createFromUrl: (url) => null,
});
```

除内容本身之外的一切 —— URL 处理、填充模式、对齐、自动尺寸、
`playing`/`frame`/`animationName`/`skinName`/`loop` —— 没有工厂也能工作；加载器只是
什么都不显示。

## `GList`

`GList` 是一个 `GComponent`，负责排列子节点、跟踪选中状态，并能虚拟化大数据集。

### 布局

```ts
list.layout = ListLayoutType.SingleColumn;   // SingleRow、FlowHorizontal、FlowVertical、Pagination
list.lineGap = 4;
list.columnGap = 4;
list.align = AlignType.Left;
list.verticalAlign = VertAlignType.Top;
list.autoResizeItem = true;                   // 子项尺寸跟随列表
list.resizeToFit();                           // 或让列表收缩到子项大小
```

`lineCount` / `columnCount` 约束流式布局；`Pagination` 还允许 `ScrollPane` 驱动页面
控制器（`list.scrollPane.pageController`）。

### 子项与对象池

```ts
const item = list.addItemFromPool('ui://MainMenu/Item');
const obj = list.getFromPool('ui://MainMenu/Item');
list.returnToPool(obj);          // 或先用 removeChildToPool(obj) 脱离
list.removeChildrenToPool(0, -1);
list.itemPool                  // 背后的 GObjectPool
```

`addItem(url?)` 不入池直接添加；`addItemFromPool(url?)` 会复用该 URL 的池中对象 ——
长列表要用后者。

### 选择

```ts
list.selectionMode = ListSelectionMode.Single; // Multiple、Multiple_SingleClick、None
list.selectedIndex = 2;
const indices = list.getSelection();
list.addSelection(3, true);   // 第二个参数：滚动到可见
list.clearSelection();
list.selectionController       // 每个选中状态对应一个 Controller 页面
```

列表会发出 `EventType.CLICK_ITEM`，`evt.data` 是被点击的子项。

### 虚拟列表

面对数千行数据，应把列表虚拟化。`itemRenderer`、`itemProvider` 和 `defaultItem` 在
代码里设置，而不是在编辑器中制作：

```ts
list.defaultItem = 'ui://MainMenu/Item';
list.setVirtual();                          // 或 setVirtualAndLoop()
list.itemProvider = (index) => 'ui://MainMenu/Item';
list.itemRenderer = (index, item) => {
    item.text = `第 ${index} 行`;
};
list.numItems = 10_000;                     // 触发首次布局
```

此后列表只创建可见项加一小段缓冲，滚动时循环复用。`childIndexToItemIndex` /
`itemIndexToChildIndex` 在两者间转换，因为循环列表里子节点顺序不等于数据项顺序。

其他常用成员：`virtualItemSize`（`{ width, height }`）、`scrollToView(index, ani?, setFirst?)`、
`getSnappingPosition(x, y)`、`getFirstChildInView()`、`getMaxItemWidth()`、
`handleArrowKey(dir)`。

## `GTree`

`GTree` 继承 `GList`，上面的内容全部适用。

```ts
const node = new GTreeNode(true, 'ui://MainMenu/Folder');  // hasChild, resURL
node.text = '武器';
tree.rootNode.addChild(node);

tree.indent = 20;
tree.clickToExpand = 1;                 // 0 不展开，1 双击，2 单击
tree.treeNodeRender = (node, cell) => { cell.text = node.text; };
tree.treeNodeWillExpand = (node, expanded) => { /* … */ };
tree.expandAll();                       // 或 collapseAll(folderNode?)
```

`selectNode(node, scrollItToView?)`、`unselectNode(node)`、
`getSelectedNode()` / `getSelectedNodes()`。展开/收起由 `GTreeNode.expanded` 驱动；
`expandToRoot()` 会展开某节点的所有祖先。

## `GGroup`

组**不是**父级。它存在于显示列表中，负责布局一组把 `group` 指向它的其他对象：

```ts
group.layout = GroupLayoutType.Horizontal;  // None、Horizontal、Vertical
group.lineGap = 8;
group.columnGap = 8;
group.excludeInvisibles = true;
group.autoSizeDisabled = false;             // 允许组按内容自适应尺寸
group.mainGridIndex = 0;                    // 哪个格子吸收余量
```

`ensureBoundsCorrect()` 重算边界；`moveChildren` / `resizeChildren` 把变化传播给成员。

## 窗口、弹窗与 tooltip

叠加层栈由 `GRoot` 持有。按下时弹窗如何关闭，见[输入与事件](./input-and-events.md)。

### `Window`

```ts
const win = new MyWindow();
win.modal = true;
win.centerOn(root);
win.show();                    // 或 win.showOn(root)
win.toggleStatus();            // 显示则隐藏，隐藏则显示
win.hide();                    // 播放关闭过渡；hideImmediately() 跳过
```

`Window` 通常由包组件构建：编辑器会标出边框、内容面板、关闭按钮和拖拽区域，分别暴露为
`frame`、`contentPane`、`closeButton`、`dragArea`。`init()` 是子类做初始化的地方；请覆写它
而不是构造函数。

其他成员：`isShowing`、`isTop`、`bringToFront()`、`bringToFontOnClick`、
`showModalWait(requestingCmd?)` / `closeModalWait(requestingCmd?)` / `modalWaiting`
（使用 `UIConfig.windowModalWaiting`）、`addUISource(source)` 用于延迟加载窗口所属包。

根节点级的窗口管理：

```ts
root.showWindow(win);
root.hideWindow(win);
root.hideWindowImmediately(win);
root.bringToFront(win);
root.closeAllWindows();
root.closeAllExceptModals();
root.getTopWindow();
root.hasModalWindow;
```

### 弹窗

```ts
root.showPopup(popup, target, PopupDirection.Auto);  // Auto、Up、Down
root.togglePopup(popup, target);
root.hidePopup(popup);       // 省略则关闭全部
root.hasAnyPopup;
root.getPopupPosition(popup, target, dir);
```

在弹窗内部按下只会关闭它上方的弹窗；在外部按下会关闭全部。`_justClosedPopups` 用于
防止同一次按下既关闭又重开某个弹窗（`togglePopup` 的场景）。

`PopupMenu` 是基于列表的现成弹窗：

```ts
const menu = new PopupMenu();
menu.addItem('剪切', () => { /* … */ });
menu.addSeperator();
menu.addItem('复制');
menu.show(target);
```

### tooltip 与模态等待

```ts
root.showTooltips('提示');            // 使用 UIConfig.tooltipsWin
root.showTooltipsWin(customObject);
root.hideTooltips();

root.showModalWait('加载中…');        // 使用 UIConfig.globalModalWait
root.closeModalWait();
root.modalWaiting;
```

未配置对应的 `UIConfig` 资源时，它们会直接什么都不做（或打印一条警告）。

### 拖放

```ts
obj.draggable = true;                 // 或 obj.startDrag(touchId?) / obj.stopDrag()
DragDropManager.inst.startDrag(source, iconUrl, data, touchId);
DragDropManager.inst.cancel();
```

细节和事件列表见[输入与事件](./input-and-events.md)。

## `GObjectPool`

`GList.itemPool` 就是一个 `GObjectPool`，你也可以直接用：

```ts
const pool = new GObjectPool();
const obj = pool.getObject('ui://MainMenu/Item');
pool.returnObject(obj);
pool.count;
pool.clear();
```

URL 无法解析时 `getObject()` 返回 `null`（而不是抛错）。
