# 文本

运行时有三种文本控件，都派生自 `GTextField`：

| 控件 | 用途 |
| --- | --- |
| `GTextField` | 普通文本。 |
| `GRichTextField` | 带 UBB/HTML 标记与可点击链接的文本。 |
| `GTextInput` | 可编辑输入框，浏览器里用一个真实 DOM 输入框覆盖实现。 |

## `GTextField`

```ts
const label = new GTextField();
label.text = '得分：100';
label.font = 'Arial';
label.fontSize = 24;
label.color = new Color(255, 255, 255, 255);
label.align = AlignType.Center;          // Left、Center、Right
label.verticalAlign = VertAlignType.Middle;  // Top、Middle、Bottom
label.leading = 4;                       // 行距
label.letterSpacing = 1;
label.underline = true;
label.bold = true;
label.italic = false;
label.singleLine = true;
label.stroke = 2;
label.strokeColor = new Color(0, 0, 0, 255);
label.shadowOffset = new Point(2, 2);
label.shadowColor = new Color(0, 0, 0, 255);
label.autoSize = AutoSizeType.Both;      // None、Both、Height、Shrink
```

| 成员 | 说明 |
| --- | --- |
| `text` / `font` / `fontSize` / `color` | 基础样式。 |
| `align` / `verticalAlign` | 框内对齐。 |
| `leading` / `letterSpacing` | 行距与字距。 |
| `underline` / `bold` / `italic` | 样式开关。 |
| `singleLine` | 不换行。 |
| `stroke` / `strokeColor` | 描边；`stroke` 为 `0` 时关闭。 |
| `shadowOffset` / `shadowColor` | 阴影；偏移为 `(0, 0)` 时关闭。 |
| `ubb` / `ubbEnabled` | 是否解析 UBB 标记。 |
| `autoSize` | 自动尺寸模式，见下。 |
| `textFormat` | 一次读写上面的一组样式（`TextFormat` 接口）。 |
| `textWidth` | 排版后文本的实际宽度，不一定等于 `width`。 |
| `templateVars` / `setVar(name, value)` / `flushVars()` | 文本模板变量。 |
| `ensureSizeCorrect()` | 让待定的自动尺寸先算完。 |

### `AutoSizeType`

| 值 | 行为 |
| --- | --- |
| `None` | 尺寸固定，不随文本变化。 |
| `Both` | 宽高都按文本自适应。 |
| `Height` | 宽度固定、高度自适应。 |
| `Shrink` | 缩小字号以塞进固定框。 |

自动尺寸是**延迟生效**的：`width`/`height` 会触发 `ensureSizeCorrect()`，因此读到的
就是文本的尺寸。构建过程中（`_underConstruct`）会跳过，等第一次读取时再算。

### 模板变量

```ts
label.templateVars = { name: 'Zoe', score: '99' };
label.text = '你好，{name}！得分 {score}';
label.setVar('score', '100');
label.flushVars();       // 重新代入
```

## 富文本与链接

`GRichTextField` 打开后端的富文本表面，并把标记留在文本里（而不是剥掉），因此加粗、
变色、`<a href>` 链接等由后端排版：

```ts
const rich = new GRichTextField();
rich.ubb = true;
rich.linkUnderline = true;
rich.linkColor = '#3366ff';
rich.text = '点击 [url=ui://MainMenu/Help]这里[/url] 查看帮助';

rich.on(EventType.LINK, (href: string, evt: Event) => {
    console.log(href);       // "ui://MainMenu/Help"
});
```

链接在**抬起**时判定：控件把抬起点从 UI 根空间转到本地，向文本表面询问该处的链接，
命中才发出 `EventType.LINK`，参数是 `(href, event)`。因为标记由后端排版，只有它知道
字形落在哪里 —— 为此 `ITextObject.hitTestLink(x, y)` 属于渲染接口层的一部分。

### UBB 标签

`UBBParser` 识别这些标签，把它们改写成富文本表面能看懂的标记：

| 标签 | 产出 |
| --- | --- |
| `[b]…[/b]` | `<b>` |
| `[i]…[/i]` | `<i>` |
| `[u]…[/u]` | `<u>` |
| `[color=#rrggbb]…[/color]` | `<font color=…>` |
| `[size=20]…[/size]` | `<size=…>` |
| `[url=href]…[/url]` | `<a href=…>` |
| `[img]url[/img]` | 图片标记 |

`\[` 转义为字面量 `[`。未知标签原样保留。解析器是单遍扫描、不带嵌套状态的，由接收端
做标记配对。

```ts
import { UBBParser } from 'fairygui-babylon';

UBBParser.inst.parse('[b]hi[/b]');          // -> '<b>hi</b>'
UBBParser.inst.parse('[b]hi[/b]', true);    // -> 'hi'（remove 模式，剥掉标记）
UBBParser.inst.lastColor;                   // 最近一个 [color] 的属性
UBBParser.inst.lastSize;                    // 最近一个 [size] 的属性
```

普通 `GTextField` 和 `GTextInput` 用 `remove = true` 剥掉标记；`GRichTextField` 不用，
让标记保留给后端。

## 位图字体与包内字体

包里的 `Font` 项会被解码成 `BitmapFont`（TTF 光栅化进图集，或字形本身就是图集中的
sprite）。字段通过名字引用它：

```ts
label.font = 'ui://MainMenu/MyFont';
```

这时字形的绘制来自包自己的图集。字体的 `canTint` 为假时，控件会把颜色强制为白色；
`resizable` 为假时，`fontSize` 会被吸附到设计尺寸。这些规则由核心在文本对象之外处理，
后端只需要按给定颜色画字形。

也可以把字体注册到一个全局名字下，让字段按名字引用：

```ts
import { registerFont, getFontByName } from 'fairygui-babylon';

registerFont('Title', myBitmapFont);
label.font = 'Title';       // 非 ui:// 的名字会查这个注册表
```

字段解析 `font` 的规则是：以 `ui://` 开头的名字按包项解析，取该 `PackageItem` 的
`bitmapFont`；其余名字查 `getFontByName`，且**只有当它是 `BitmapFont` 实例时才会被采用**，
否则退化为系统字体族。包内字体不走这个注册表 —— 这样注册表就不会比填它的包活得更久。

## `GTextInput`

```ts
const input = new GTextInput();
input.promptText = '请输入昵称';
input.maxLength = 12;          // 0 等同无限
input.password = false;
input.editable = true;
input.requestFocus();          // 聚焦并唤起输入

input.on(EventType.TEXT_CHANGE, () => console.log(input.text));
input.on(EventType.SUBMIT, (evt: Event) => console.log(evt.keyCode));
```

| 成员 | 说明 |
| --- | --- |
| `editable` | 是否接受输入。 |
| `maxLength` | 最大长度；`-1` 无限，赋值 `0` 也视为无限。 |
| `password` | 掩码显示。 |
| `promptText` | 空值时显示的占位文本；其中的 UBB 标记会被剥掉。 |
| `restrict` | **不支持**；为兼容而保留的读写属性。 |
| `requestFocus()` | 聚焦并唤起输入。触摸时也会自动调用。 |

输入框不会自动调整尺寸（`autoSize` 固定为 `None`）。

### DOM 覆盖层

canvas 没有光标、选区、输入法和剪贴板，所以浏览器里的实现是：在输入框上覆盖一个真实
的 `<input>` 或 `<textarea>`，把样式对齐，并把用户输入同步回显示列表。这个覆盖层在
`src/babylon/TextInput.ts`：

```ts
import { closeNativeInput, hasNativeInput } from 'fairygui-babylon';

hasNativeInput();     // 当前是否有原生输入框开着
closeNativeInput();   // 关掉它（没有也安全）
```

要点：

- **同一时刻只有一个。** 聚焦第二个输入框会先关掉第一个。
- **覆盖层自己绘制文本。** 它不透明地按字段的颜色、字号、对齐和字距绘制，光标与选区
  因此来自同一个渲染器，不会和 canvas 里排的字错位；字段在它打开期间抑制自己的光栅化。
- **位置用页面坐标。** 字段矩形是相对 canvas 的 CSS 像素，加上 canvas 自身的页面偏移
  即可精确对齐。
- **没有 DOM 时安全降级。** `openNativeInput` 返回 `false`，字段继续按普通只读文本绘制。

核心只认结构化接口 `ITextInputObject`（`editable`、`maxLength`、`password`、
`promptText`、`onTextChanged`、`onSubmit`、`openKeyboard`）。因此，**任何实现了
`openKeyboard` 的文本后端都会自动获得可编辑输入框的行为**，不需要改核心。Mock 后端
没有实现它，输入框在那里就退化为只读文本 —— 这是刻意的容错。

## 文本渲染接口

文本排版放在后端，因为度量一段字形需要后端的字体机制（canvas 2D 度量、SDF 图集，或
位图字体表）。`GTextField` 只负责 FairyGUI 层面的属性（字体、字号、对齐、自动尺寸模式、
标记），然后向文本对象询问它们量出来的结果。

`ITextObject` 上的关键项：`text`、`font`、`bitmapFont`、`fontSize`、`color`、`fontStyle`、
`align`、`verticalAlign`、`rich`、`singleLine`、`letterSpacing`、`leading`、`underline`、
`autoSize`、`wrapWidth`、`textureScale`、`stroke`/`strokeColor`、
`shadowOffsetX`/`shadowOffsetY`/`shadowColor`、`measureTextWidth()`、
`measureTextHeight()`、`onLinkClick`、`hitTestLink(x, y)`。

Babylon 后端的实现用 canvas 2D 光栅化到纹理，`textureScale` 由
[`renderer.pixelRatio`](./rendering.md) 驱动，让高分屏上的字形落在设备像素上。
没有 canvas 时改用 `EstimatedTextMetrics`，文本会布局但画不出字形 —— 这时可以传
`createCanvas` 提供一个画布工厂。
