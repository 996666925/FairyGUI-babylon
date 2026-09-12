# 架构

整个库由两半组成，它们在一个很窄的接口上对接。

```
   包字节流                        你的应用
        │                              │
        ▼                              ▼
┌───────────────────────┐     ┌────────────────────────┐
│ src/core/             │     │ src/babylon/           │
│ 与引擎无关的运行时     │◄────┤ Babylon.js 后端        │
│                       │ 接口│                        │
└───────────────────────┘     └────────────────────────┘
   显示列表、控件、                渲染节点、纹理、
   齿轮、缓动、输入                着色器、几何、文本
```

`src/core/` 从不导入 `src/babylon/`，也从不引用 Babylon 类型。核心需要渲染器提供的
一切，都由 `src/core/render/IRenderObject.ts` 里的接口表达。正因如此，整个运行时
可以无头测试，也可以在不改核心的前提下换一个引擎后端。

## 渲染接口层

四种渲染节点，加一个工厂：

| 接口 | 承载 | 由谁创建 |
| --- | --- | --- |
| `IRenderObject` | 纯变换节点 —— 自身不绘制 | `IRenderFactory.createObject()` |
| `IImageObject` | 图片、图集子矩形、九宫格、平铺、填充 | `createImage()` |
| `ITextObject` | 文本表面，带度量 | `createText()` |
| `IGraphObject` | `GGraph` 的矢量图形 | `createGraph()` |

`IRenderFactory` 还承载视口（`viewportWidth` / `viewportHeight`、
`onViewportResize`）和 `attachToStage(node)` —— `GRoot` 调用一次，成为后端所绘
一切的根。

后端以全局方式安装自己：

```ts
setRenderFactory(renderer);   // core/render/IRenderObject.ts
```

用全局而不是注入，是因为 `GObject` 的构造函数会在对象挂到任何根节点之前就创建
渲染节点 —— 这也是 FairyGUI 自己的 `UIObjectFactory` 是全局的原因。没有安装任何
后端时，`getRenderFactory()` 会抛出错误并点明缺少的那次调用。

### 扩展渲染接口

`GObject.createDisplayObject()` 是需要特定节点类型的控件的覆写点：

```ts
protected createDisplayObject(): void {
    this._node = getRenderFactory().createImage();
}
```

它从 `GObject` 的构造函数里运行，所以覆写里不能碰子类字段 —— 那些字段此时还在
初始化。可参考 `GImage` 或 `GTextField` 的实例。

## 坐标契约

核心自始至终使用 **FairyGUI 原生空间**：

- 原点在 UI 根的左上角；
- **y 轴向下递增**；
- 角度是**度数，屏幕上顺时针为正**；
- 一个单位就是一个 UI 单位（在 demo 的配置里等于一个 CSS 像素）。

Babylon 是 y 向上、逆时针。转换是后端的职责，而且只是后端的职责。转换只存在于两处：
UI 根节点的 `scaling = (1, -1, 1)`，以及着色器。永远不要把 Babylon 空间的数值泄漏
进 `src/core/`，也不要写"顺手帮忙"预先翻转 y 的核心代码。

参考实现 Cocos 运行时是通过 `cc.Node` 的 anchor 隐式表达这个契约的，节点的
`anchorY` 等于 `1 - pivotY`。本移植不重现这个反转：渲染节点的 pivot 与核心使用同一
个 y 向下空间，所以 `pivotY` 就是它字面的意思。

## 显示列表与渲染树

`GObject` 是所有可见对象的基类，持有渲染节点（`node`）、变换、尺寸、可见性、alpha
和事件分发。`GComponent` 在此之上增加容器节点和 `GObject` 子节点列表。

两棵树彼此对应：

```
GComponent（显示列表）              IRenderObject（渲染树）
├── GImage                         ├── BabImageObject
├── GButton                        ├── BabRenderObject（容器）
│   └── GTextField                 │   └── BabTextObject
└── GList                          └── BabRenderObject
```

每个渲染节点的 `userData` 指回它的 `GObject`。输入处理会遍历渲染树，需要据此找回
所属的显示对象。

有几种"尺寸"容易混淆，值得分清：

| 属性 | 含义 |
| --- | --- |
| `width` / `height` | 编辑时设定的内容框。对带滚动面板的 `GComponent` 设置 `width` 改的是视口，不是内容。 |
| `actualWidth` / `actualHeight` | 缩放之后的框。 |
| `node.contentWidth` / `contentHeight` | 后端最后一次被告知的布局尺寸。 |

## 一帧

两次独立的更新，详见[快速上手](./getting-started.md)：

- `renderer.update()` —— 从每个舞台根节点遍历渲染树，重算 UI 空间矩阵、累计 alpha、
  裁剪栈和绘制顺序，然后让每个对象提交变脏的几何或文本。它注册在
  `scene.onBeforeRenderObservable` 上。
- `root.update(dt)` —— `scheduler.update(dt)`、`TweenManager.update(dt)`，然后对每
  个子节点调用 `onUpdate(dt)`。必须由宿主调用。

## 模块装配，以及它为什么长这样

ESM 会急切地求值类体，所以如果 `B` 所在模块还没求值完，`A extends B` 会直接失败。
参考实现依赖 TypeScript 的 namespace，在那里循环引用是无害的。因此本移植中若干处用
了间接层而不是导入：

| 问题 | 机制 |
| --- | --- |
| `GComponent` 要构建控件，又不能导入所有控件类 | `src/core/ObjectFactory.ts` 持有 `newObject()`；`UIObjectFactory` 安装 `ObjectType → 类` 的映射表。 |
| `GComponent` 需要 `ScrollPane` 和 `Transition`，而它们自己又导入 `GComponent` | `src/core/Builtins.ts` 持有构造函数，由入口点安装。 |
| `GearBase` 要创建自己的子类 | 各齿轮按索引自注册到 `GearBase.ts` 里的表（`registerGear`）。 |
| `ControllerAction` 要创建自己的子类 | 各动作按类型 id 自注册（`registerAction`）。 |
| 与 `GObject` 相邻的代码需要拿到活的根节点，又不想导入 `GRoot` | 只用 `import type`，实例从 `src/core/Stage.ts` 取。 |
| 包解析器要把 `ui://` URL 映射到用户类，又不想引入整棵控件树 | `src/core/ExtensionRegistry.ts`，它不含任何导入。 |

**核心入口点（`src/index.ts`）负责以副作用方式导入每一个自注册模块。** 如果你新增了
一个，必须在那里接上，否则对应功能会在运行时缺失，而且不报编译错误。

这也是深层导入（`fairygui-babylon/src/core/GComponent.js`）是陷阱的原因：它会跳过这些装配，
你构建的第一个组件会抛出说明性错误，而不是悄悄出问题。

## 目录结构

```
src/core/                    与引擎无关的运行时
├── GObject.ts               显示对象基类
├── GComponent.ts            容器、控制器、过渡、滚动面板
├── GButton.ts … GTree.ts    各控件
├── UIPackage.ts             包解析与对象创建
├── PackageItem.ts           单个发布项的元数据
├── Controller.ts            控制器页面与动作
├── Transition.ts            被缓动属性的时间轴
├── ScrollPane.ts            滚动、页眉/页脚、分页
├── Window.ts                模态、可拖拽、带边框
├── UIConfig.ts              全局默认值与字体注册表
├── ObjectFactory.ts         ObjectType → 控件的间接层
├── UIObjectFactory.ts       安装该表与用户扩展
├── Builtins.ts              延迟绑定的 ScrollPane/Transition
├── ExtensionRegistry.ts     ui:// → 用户组件类
├── Stage.ts / Scheduler.ts  活的根节点、延迟回调
├── FieldTypes.ts            跨越接口层的枚举
├── event/                   Event、EventDispatcher、InputProcessor、HitTest
├── gears/                   十个齿轮，自注册
├── action/                  PlayTransition、ChangePage
├── tween/                   GTween、GTweener、GPath、TweenManager
├── display/BitmapFont.ts    从包字体解码出的字形表
├── render/IRenderObject.ts  接口层本身
└── utils/                   ByteBuffer、Color、Geometry、ToolSet

src/babylon/                 Babylon.js 后端
├── BabylonRenderer.ts       相机、layer、视口、工厂、逐帧遍历
├── BabRenderObject.ts       变换节点
├── BabImageObject.ts        图片/图集/填充/九宫格/平铺
├── BabTextObject.ts         canvas 光栅化与 DOM 输入覆盖层
├── BabGraphObject.ts        矢量图形
├── GeometryBuilder.ts       三角化、九宫格、平铺、填充
├── ClipRects.ts             嵌套 scrollRect 裁剪
├── TextLayout.ts            标记分词、断行、度量
├── UIShader.ts              UI 着色器、材质、白纹理
├── PackageAssets.ts         图集纹理 + 外部内容加载器
├── TextInput.ts             DOM <input>/<textarea> 覆盖层
├── Mat2D.ts                 UI 空间使用的 2D 仿射矩阵
└── index.ts                 后端的公开接口
```

## 一张图片的数据流

1. 编辑器发布 `Main.fui` 和 `Main_atlas0.png`。
2. `UIPackage.parse` 读取项表和 sprite 表，为每张图片记录：所属图集项、子矩形、
   是否旋转、裁剪偏移。
3. `pkg.createObject('Main')` 遍历组件负载，对每个子项调用 `newObject()`，构建出
   `GImage`。
4. `GImage.constructFromResource` 调用 `UIPackage.getItemAsset()`，后者向已安装的
   **资源解析器**（`BabylonPackageAssets.resolve`）要纹理。
5. `BabylonPackageAssets.textureFor(url)` 立即返回一个 Babylon `Texture` —— 构造函数
   不会阻塞等待图片 —— 并按图集文件缓存。
6. `IImageObject.setSprite(texture, rect, rotated, trim)` 记录下来。
7. 下一次 `renderer.update()` 时，图片提交采样该图集子矩形的几何。像素到达之前纹理是
   空的；到达之后，同一份几何直接画出美术资源。

## 延伸阅读

- [渲染](./rendering.md) —— 后端的细节，以及如何写另一个后端。
- [包与资源](./packages.md) —— 上面流程中解析与资源那一侧。
- [`PORTING.md`](../PORTING.md) —— 移植核心模块必须遵守的规则。
