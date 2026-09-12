# 渲染

Babylon 后端是屏幕空间的正交叠加层。本文讲它的行为、每个选项的作用，以及如何针对同一
接口层写一个不同的后端。

## 创建渲染器

```ts
import { installBabylonRenderer } from 'fairygui-babylon';

const renderer = installBabylonRenderer({
    scene,                  // 宿主场景；省略时会新建一个
    width: 1280,            // 初始视口，单位 UI 单位
    height: 720,
});
```

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `scene` | 在 `engine` 上新建 | 宿主场景。 |
| `engine` | `NullEngine` | 仅在省略 `scene` 时使用。 |
| `width` / `height` | 引擎渲染尺寸 ÷ 硬件缩放 | 初始视口，**UI 单位**。 |
| `createCanvas` | `OffscreenCanvas` 或游离 `<canvas>` | 文本光栅化用的画布工厂。传 `null` 则不使用光栅化器 —— 文本会布局但不绘制。 |
| `textMetrics` | canvas 2D `measureText` | 覆写字形度量提供者。 |
| `uiLayerMask` | `UI_LAYER_MASK` | UI 使用的 layer 位。 |
| `cameraZ` | `1000` | 正交相机在 UI 平面后方的距离。 |

`installBabylonRenderer` 还会把渲染器设为全局工厂并安装它的包资源。手动完成这些步骤
见[快速上手](./getting-started.md)。

## 场景隔离

UI 不能打扰宿主场景，也不能被它打扰。这依赖三件事：

1. **专属相机。** 渲染器自建一台正交相机，并把它追加到 `scene.activeCameras` 中宿主
   相机**之后**。它从不修改 `scene.activeCamera`。由于 `scene.activeCameras` 默认为空，
   宿主的相机必须被显式装进这个列表 —— 只挂在 `activeCamera` 上并不能让它继续渲染。
2. **专属 layer 位。** `UI_LAYER_MASK` 是 `0x10000000`，即第 28 位。Babylon 相机和网格
   的默认 layer 掩码是 `0x0FFFFFFF`（第 0–27 位），所以 UI 位和宿主网格永不交集：UI
   相机只看 UI，宿主相机看除 UI 外的一切。
3. **不清空颜色缓冲。** 该相机不做 clear，所以下方的 3D 场景得以保留，UI 叠加在其上。

`camera.minZ` / `maxZ` 由 `cameraZ` 决定。Babylon 9 里正交投影是 `Camera` 上的一种
模式而非子类；它仍必须是一台 **target** 相机，因为基类 `Camera` 没有实现
`_getViewMatrix`，会让所有 UI 顶点落在正交盒之外。

## 坐标系与 y 翻转

契约见[架构](./architecture.md)。具体来说，只有两处知道翻转这件事：

- `uiRootNode.scaling = (1, -1, 1)`，把 FairyGUI 的 y 向下空间变成 Babylon 的 y 向上
  世界。它的局部空间**就是** `localToGlobal` 汇报的 UI 根空间。一个世界单位等于一个
  UI 单位。
- 着色器，用于它接收到的裁剪矩形。

这个负行列式会镜像子树里的每个三角形，所以网格在构建时使用**反向绕序并关闭背面剔除**。

`uiRootNode` 和 `holdingNode`（脱离的对象停放其下的禁用节点）都是公开的，便于宿主查看
或重新挂接 UI。

## 视口与缩放

视口以 **UI 单位**表示，它同时驱动正交盒和根节点的尺寸。

```ts
renderer.setViewport(1280, 720);   // UI 单位
renderer.resizeToEngine();         // 读引擎尺寸并除掉硬件缩放
renderer.viewportWidth;            // 当前值，UI 单位
renderer.viewportHeight;
renderer.pixelRatio;               // 每个 UI 单位对应的设备像素数
```

尺寸没变时 `setViewport` 会提前返回。通过 `onViewportResize` 注册的回调会全部保留
（不会互相覆盖），并且**不会**在注册时立即调用 —— 要同步读取当前尺寸请用
`viewportWidth`/`viewportHeight`。`GRoot` 在创建时注册了这样一个回调，所以它能自动
跟随窗口变化，无需额外处理。

`pixelRatio` 存在的原因是：视口单位是 CSS 像素，而后备缓冲不是。文本会按 `pixelRatio`
光栅化，让纹素落在设备像素上，从而在高分屏上保持清晰。

## 一帧

`renderer.update()` 完成所有逐帧工作，从每个已挂接的舞台根节点开始遍历：

1. 重算 UI 根节点的世界矩阵及其逆矩阵（作为 `uRootInverse` 上传给材质）。
2. 按树序对每个对象：构建它的 UI 空间矩阵、累乘 alpha、分配单调递增的绘制顺序，并复制
   父级的裁剪栈再加自己的 `scrollRect`。
3. 调用对象的 `commitGeometry()`，仅在变脏时上传几何或文本栅格。

它注册在 `scene.onBeforeRenderObservable` 上，所以 `scene.render()` 会调用它。
`renderer.render()` 是一个便捷方法，先 `update()` 再 `scene.render()`。

`invalidateDrawOrder()` 标记顺序失效；`drawOrderDirty` 读取该标记。

## 纹理

`BabylonPackageAssets` 把每个图集文件映射为一个 Babylon `Texture`：

- **惰性且同步。** `Texture` 构造函数立即返回，图片到达后再填入资源，所以 `GImage` 能在
  构建时就拿到句柄，美术资源随之出现。不需要重新失效的流程。
- **`invertY = false`。** sprite 映射从区域上边缘推导 `v0`，让 `v` 沿图片向下增长，与原始
  图片行序一致。Babylon 的默认值会让每张 sprite 上下颠倒。
- **地址模式 clamp。** 图集把互不相干的 sprite 紧挨着打包，采样越过区域边界会取到邻居。
  平铺和九宫格都留在自己的矩形内，所以 clamp 没有代价。
- **不用 mipmap**，因为 UI 大致按 1:1 绘制。

`GLoader` 的外部图片走 `loadExternal`，它用 `Image` 元素而不是 `Texture`，因为
`GLoader` 既需要源尺寸，也需要真正的失败回调。`dispose()` 会注销解析器并释放它创建的
所有纹理。

## 几何

所有几何都由 `GeometryBuilder.ts` 在 CPU 上三角化。这些辅助函数单独导出，对写另一个后端
很有用：

| 分组 | 函数 |
| --- | --- |
| 九宫格 | `nineSliceBorders`、`nineSliceRegions` |
| 平铺 | `tileRegions` |
| 填充 | `fillPolygon`（水平、垂直、径向） |
| 多边形 | `triangulatePolygon`、`signedArea`、`strokePolyline` |
| 路径 | `roundRectPath`、`ellipsePath` |
| 裁剪 | `clipToUnitSquare`、`clipHalfPlane` |
| 图集映射 | `SpriteMapping`、`SpriteRegion`、`SliceBorders`、`UV` |

`SpriteMapping` 把图集子矩形（含旋转与裁剪）转成 UV 和一个四边形；裁剪在顶点着色器里
完成，而不是靠重新三角化。

## 裁剪

两种机制：

- **滚动矩形。** `IRenderObject.scrollRect` 把对象的子树裁剪到它自身局部空间中的一个
  矩形。它们可以嵌套：`ClipStack` 把外层矩形沿树传递，着色器为每个顶点求最多
  `MAX_CLIP_RECTS` 个矩形的交集。滚动面板里再套滚动面板就是靠这个正确裁剪的。
- **遮罩。** `GComponent.setMask(obj, inverted)` 用另一个对象的轮廓裁剪子节点。
  `GImage.isShapeMask` / `GGraph.isShapeMask` 标记用于此种用途的对象。

## 文本光栅化

`BabTextObject` 把排好版的字形光栅化到 canvas 纹理。排版那一半在 `TextLayout.ts`：

| 导出 | 用途 |
| --- | --- |
| `layoutText`、`tokenizeParagraph`、`normalizeNewlines`、`stripMarkup` | 识别标记的断行。 |
| `lineOffsetX`、`lineOffsetY` | 框内对齐。 |
| `CanvasTextMetrics` | 来自 canvas 2D `measureText` 的真实度量。 |
| `EstimatedTextMetrics` | 无 canvas 时的兜底度量。 |
| `BitmapTextMetrics` | 来自包位图字体字形表的度量。 |
| `defaultCanvasFactory` | `OffscreenCanvas`，或游离 `<canvas>`。 |

富文本也在这里排版，这正是 `ITextObject.hitTestLink(x, y)` 属于接口层一部分的原因：只有
后端知道字形实际落在哪里。

`GTextInput` 的 DOM 覆盖层在 `TextInput.ts` —— 见[文本](./text.md)。

## 着色器与材质

`UIShader.ts` 导出 `registerUIShaders`、`createUIMaterial`、`createWhiteTexture`、
`alphaModeFor`，以及属性和 uniform 名称。

材质是**每个对象一份**，这是刻意的。`uTexture` 是逐对象 uniform，而 Babylon 会把采样器
缓存在材质上，共享材质会让每个网格都采样最后赋值的那个纹理。着色器程序本身仍由 Babylon
的 effect 缓存共享，所以代价只是每个对象一个小记账对象，而不是一次编译。

## 已知缺口

- **`Normal` 之外的混合模式。** `BlendMode` 会被记录在对象上并传到 `alphaModeFor`，
  但 `Normal` 之外的模式尚未映射到 GPU 混合状态。
- **编辑器里的滤镜**尚未支持。
- **`GLoader3D`** 不自带骨骼运行时；内容来自 `setLoader3DContentFactory`。见[扩展](./extending.md)。

## 写一个不同的后端

后端就是任何实现了 `IRenderFactory`、能产出四种节点接口实现的对象。最小实现：

```ts
import { setRenderFactory } from 'fairygui-babylon';
import type {
    IRenderFactory, IRenderObject, IImageObject, ITextObject, IGraphObject,
} from 'fairygui-babylon';

class MyFactory implements IRenderFactory {
    createObject(): IRenderObject { /* 纯变换节点 */ }
    createImage(): IImageObject { /* 图片 + 图集子矩形 */ }
    createText(): ITextObject { /* 排版 + 度量 + 绘制 */ }
    createGraph(): IGraphObject { /* 矢量图形 */ }

    attachToStage(node: IRenderObject): void {
        // 把根渲染节点挂到你这个后端绘制的地方。
    }

    get viewportWidth(): number { /* … */ }
    get viewportHeight(): number { /* … */ }
    onViewportResize(cb: (w: number, h: number) => void): void { /* … */ }
}

setRenderFactory(new MyFactory());
```

核心依赖的规则：

- **在每个接口上都说 FairyGUI 坐标。** 如果你的引擎不同，在内部转换；永远不要向外返回
  原生空间的数值。
- **遵守枢轴契约：** 局部 `(0, 0)` 是内容框的左上角，且已减去 pivot。搞错这一点的表现是：
  只有当对象没有枢轴时，拖拽才跟着指针走。
- **`attachToStage` 只会被调用一次**，由 `GRoot` 调用，让某个节点成为一切的根。
- **从窄接口方法返回 `IImageObject` 等具体类型**；核心会以结构化方式把文本对象当作
  `ITextInputObject` 检查，所以一个同时实现了 `openKeyboard` 的文本对象会自动获得可编辑
  输入框的行为。

`tests/helpers/mockRender.ts` 是一份完整、带注释的参考实现 —— 既可用作模板，也是"核心
到底调用了什么"的定义。
