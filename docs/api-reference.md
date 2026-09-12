# API 索引

本页按模块列出包导出的公开符号，并指向更详细的说明。示例从包入口导入：

```ts
import { GComponent, UIPackage, installBabylonRenderer } from 'fairygui-babylon';
```

> 从 `fairygui-babylon` 导入会执行入口的装配（控件工厂、齿轮与控制器动作注册表、
> `ScrollPane`/`Transition` 绑定）。深层导入会跳过这些，构建组件时会抛错。

## 后端安装

| 导出 | 说明 |
| --- | --- |
| `installBabylonRenderer(options?)` | 创建渲染器、设为全局工厂、安装包资源。推荐入口。 |
| `createBabylonRenderer(options?)` | 只创建渲染器，不产生全局副作用。 |
| `BabylonRenderer` | 后端类；`scene`、`engine`、`camera`、`uiRootNode`、`holdingNode`、`packageAssets`、`setViewport`、`resizeToEngine`、`pixelRatio`、`update`、`render`、`dispose`。 |
| `BabylonPackageAssets` | 图集纹理与外部内容加载器；`install()`、`dispose()`、`textureFor(url)`。 |
| `UI_LAYER_MASK` | UI 使用的 layer 位，`0x10000000`。 |
| `BabylonRendererOptions`（类型） | 见[渲染](./rendering.md)。 |

## 渲染接口层

| 导出 | 说明 |
| --- | --- |
| `setRenderFactory(factory)` / `getRenderFactory()` | 安装/读取全局后端。 |
| `IRenderObject` / `IImageObject` / `ITextObject` / `IGraphObject` / `IRenderFactory`（类型） | 接口定义。 |
| `SpriteTrim`（类型） | 图集裁剪信息。 |

## 核心显示对象与控件

| 导出 | 说明 |
| --- | --- |
| `GObject` | 显示对象基类。见[控件](./widgets.md)。 |
| `GComponent` | 容器。 |
| `GGroup` | 布局非子级对象。 |
| `GImage` | 图片。 |
| `GGraph` / `GraphType` | 矢量绘制。 |
| `GLoader` | URL / 包对象加载器；另导出 `setUIContentLoader`、`getUIContentLoader` 及类型 `UIContentLoader`、`UILoadedContent`、`UIContentLoadCallback`。 |
| `GLoader3D` | 骨骼/3D 内容宿主；另导出 `setLoader3DContentFactory` 及类型 `ILoader3DContent`、`ILoader3DContentFactory`。 |
| `GMovieClip` / `MovieClip` | 序列帧；类型 `FrameResolver`、`ResolvedFrame`。 |
| `GTextField` / `TextFormat`（类型） | 普通文本。见[文本](./text.md)。 |
| `GRichTextField` | 富文本与链接。 |
| `GTextInput` / `ITextInputObject`（类型） | 可编辑输入框。 |
| `GButton` | 按钮/开关。 |
| `GLabel` | 图标 + 文本行。 |
| `GProgressBar` | 进度条。 |
| `GSlider` | 滑块。 |
| `GScrollBar` | 滚动条。 |
| `GComboBox` | 下拉框。 |
| `GList` | 列表、选择、虚拟化。 |
| `GTree` / `GTreeNode` | 树。 |
| `GObjectPool` | 对象池。 |
| `GRoot` | UI 根节点；窗口、弹窗、tooltip、输入处理器、时钟。 |
| `Window` | 窗口；`IUISource`（类型）。 |
| `PopupMenu` | 基于列表的弹窗菜单。 |
| `DragDropManager` | 全局拖放。 |
| `Controller` | 控制器页面与动作。 |
| `Transition` | 编辑器时间轴。 |
| `ScrollPane` | 滚动面板。 |
| `UIObjectFactory` | 控件工厂与用户扩展注册。 |
| `UIConfig` / `registerFont` / `getFontByName` | 全局默认值与字体注册表。 |
| `UBBParser` | UBB 标记扫描器。 |

## 包与资源

| 导出 | 说明 |
| --- | --- |
| `UIPackage` | 包解析、注册与对象创建。见[包与资源](./packages.md)。 |
| `setAssetResolver` / `AssetResolver`（类型） | 资源解析钩子。 |
| `setObjectFactory` | 替换 `ObjectType` 工厂。 |
| `spriteTrim(sprite)` / `AtlasSprite`（类型） / `PackageDependency`（类型） | 图集辅助。 |
| `PackageItem` / `Frame`（类型） | 单个发布项。 |
| `TranslationHelper` / `translateComponent` | 本地化。 |

## 事件与输入

| 导出 | 说明 |
| --- | --- |
| `Event` / `EventType` | 事件对象与类型常量。见[输入与事件](./input-and-events.md)。 |
| `EventDispatcher` / `Listener`（类型） | 监听器管理。 |
| `InputProcessor` | 指针输入入口与触摸监视。 |
| `PixelHitTest` / `PixelHitTestData` / `ChildHitArea` / `IHitTest`（类型） | 命中测试。 |

## 齿轮与控制器动作

| 导出 | 说明 |
| --- | --- |
| `GearBase` / `GearTweenConfig` / `GearIndex` / `registerGear` | 齿轮基类与注册。见[动画](./animation.md)。 |
| `GearDisplay` / `GearDisplay2` / `GearXY` / `GearSize` / `GearLook` / `GearColor` / `GearAnimation` / `GearText` / `GearIcon` / `GearFontSize` | 十个内置齿轮。 |
| `ControllerAction` / `createAction` / `registerAction` | 动作基类与注册。 |
| `PlayTransitionAction` / `ChangePageAction` | 两个内置动作。 |

## 缓动

| 导出 | 说明 |
| --- | --- |
| `GTween` | 静态入口：`to`、`to2`、`to3`、`to4`、`toColor`、`delayedCall`、`shake`、`isTweening`、`kill`、`getTween`。 |
| `GTweener` | 链式配置与回调。 |
| `TweenManager` | 由 `root.update` 驱动的时钟。 |
| `TweenValue` | 多通道数值。 |
| `EaseType` | 缓动函数枚举。 |
| `GPath` / `GPathPoint` | 路径动画。 |

## 工具与类型

| 导出 | 说明 |
| --- | --- |
| `ByteBuffer` | 包解析用的二进制读写（含字符串表）。 |
| `ToolSet` | 杂项工具。 |
| `Point` / `Rect` | 几何类型。 |
| `Color` | 颜色，通道为 `0–255`。 |
| `Margin` | 边距。 |
| `Scheduler` / `scheduler` | 延迟回调；`update(dt)`。 |
| `globalState` | 全局状态（如 `contentScaleLevel`）。 |
| `registerExtension` / `getExtension` / `resolveExtension` | `ui://` → 用户类注册表。 |
| `setStage` / `getStage` | 当前根节点的存取。 |
| `BitmapFont` / `BitmapFontData` / `BitmapFontGlyph` / `BitmapGlyphSource`（类型） | 位图字体。 |

`src/core/FieldTypes.ts` 的全部枚举通过 `export *` 导出，包括：
`ButtonMode`、`AutoSizeType`、`AlignType`、`VertAlignType`、`LoaderFillType`、
`ListLayoutType`、`ListSelectionMode`、`OverflowType`、`PackageItemType`、`ObjectType`、
`ProgressTitleType`、`ScrollBarDisplayType`、`ScrollType`、`FlipType`、
`ChildrenRenderOrder`、`GroupLayoutType`、`PopupDirection`、`RelationType`、
`FillMethod`、`FillOrigin`、`ObjectPropID`、`BlendMode`。

## Babylon 后端内部件

`src/babylon/index.ts` 另外导出这些，供需要深入到后端内部时使用：

| 导出 | 说明 |
| --- | --- |
| `openNativeInput` / `closeNativeInput` / `hasNativeInput` | `GTextInput` 的 DOM 覆盖层；类型 `NativeInputOptions`、`CanvasOffsetLike`。 |
| `BabRenderObject` / `isBabRenderObject` | 变换节点与类型判断。 |
| `BabImageObject` / `resolveTextureHandle` / `BabTextureHandle`（类型） | 图片节点与纹理句柄。 |
| `BabTextObject` / `BabGraphObject` | 文本与矢量节点。 |
| `Mat2D` | UI 空间使用的 2D 仿射矩阵。 |
| `MAX_CLIP_RECTS` / `ClipStack` / `ClipEntry`（类型） | 嵌套裁剪。 |
| `GeometryBuilder` / `SpriteMapping` / `nineSliceBorders` / `nineSliceRegions` / `tileRegions` / `fillPolygon` / `triangulatePolygon` / `clipToUnitSquare` / `clipHalfPlane` / `roundRectPath` / `ellipsePath` / `signedArea` / `strokePolyline` 及类型 `SpriteRegion`、`SliceBorders`、`UV` | 三角化与图集映射。 |
| `layoutText` / `stripMarkup` / `tokenizeParagraph` / `normalizeNewlines` / `lineOffsetX` / `lineOffsetY` / `BitmapTextMetrics` / `CanvasTextMetrics` / `EstimatedTextMetrics` / `defaultCanvasFactory` 及一系列类型 | 文本排版与度量。 |
| `registerUIShaders` / `createUIMaterial` / `createWhiteTexture` / `alphaModeFor` / `UI_ATTRIBUTES` / `UI_UNIFORMS` | 着色器与材质。 |
