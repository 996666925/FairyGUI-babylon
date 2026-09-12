# fairygui-babylon

面向 [Babylon.js](https://www.babylonjs.com) 的 [FairyGUI](https://fairygui.com)
运行时，从零实现官方发布的包格式。

在 FairyGUI 编辑器里排版 UI，发布成包，再在这里加载。运行时解析包、构建显示列表，并由
Babylon.js 后端绘制成屏幕空间的叠加层，使用独立的正交相机，不影响你的 3D 场景。

```ts
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { installBabylonRenderer, UIPackage, GRoot } from 'fairygui-babylon';

const engine = new Engine(canvas, true);          // canvas 由你的页面提供
const scene = new Scene(engine);

// 一次调用即可接好渲染后端和纹理/内容解析器。
const renderer = installBabylonRenderer({ scene, width: 1280, height: 720 });

const pkg = await UIPackage.load('ui/MainMenu');   // ui/MainMenu.fui + ui/MainMenu_atlas0.png
const main = pkg.createObject('Main')!;

const root = GRoot.create();
root.addChild(main);

// 由你的渲染循环驱动，dt 单位是秒。
scene.onBeforeRenderObservable.add(() => {
    root.update(engine.getDeltaTime() / 1000);
});

window.addEventListener('resize', () => {
    engine.resize();
    renderer.setViewport(canvas.clientWidth, canvas.clientHeight);
});

engine.runRenderLoop(() => scene.render());
```

## 特点

- **与引擎无关的核心。** `src/core/` 不导入 Babylon，也不引用任何 Babylon 类型，只通过
  一组很窄的渲染接口连接后端，所以整个核心可以无头运行和测试。
- **完整的 Babylon 后端。** 正交叠加层、逐对象 z 序、九宫格与平铺、径向和线性填充、
  嵌套裁剪、带描边和阴影的 canvas 文本、矢量图形、基于 alpha 的命中测试，以及一个真实
  的文本输入框。
- **忠实移植官方行为。** 算法、字段名和可观察行为都与官方运行时保持一致。移植约定见
  [PORTING.md](./PORTING.md)。

## 安装

```bash
npm install fairygui-babylon @babylonjs/core
```

`@babylonjs/core` 是 **peer 依赖**：运行时引用它但不打包它，你的应用只保留一份引擎。

## 文档

完整文档在 [`docs/`](./docs/README.md)。

**入门**

- [快速上手](./docs/getting-started.md) —— 把 UI 显示到屏幕上，并接好输入与缩放。
- [架构](./docs/architecture.md) —— 核心与后端的分工、渲染接口层、坐标契约、模块装配。
- [包与资源](./docs/packages.md) —— 加载包、图集与裁剪、依赖与分支、本地化。
- [控件](./docs/widgets.md) —— `GObject`/`GComponent` 基类 API、控件目录、列表、树、窗口与弹窗。

**参考**

- [渲染](./docs/rendering.md) —— Babylon 后端细节，以及如何写另一个后端。
- [输入与事件](./docs/input-and-events.md) —— 指针输入、事件模型、拖放。
- [文本](./docs/text.md) —— 文本、富文本、UBB、位图字体、可编辑输入框。
- [动画](./docs/animation.md) —— 控制器、齿轮、过渡、缓动、序列帧。
- [扩展](./docs/extending.md) —— 自定义组件、加载器、字体、内容工厂与命中区域。
- [测试与构建](./docs/testing.md) —— rstest、无头后端、真实包测试数据、构建配置。
- [API 索引](./docs/api-reference.md) —— 包导出符号总览。

## 已实现与已知缺口

已实现显示列表、齿轮、关联、控制器、过渡、滚动面板、虚拟列表、缓动、富文本、本地化，
以及上面列出的后端能力。

已知缺口：

- `GLoader3D` 不自带骨骼运行时；Spine 与 DragonBones 由宿主通过
  `setLoader3DContentFactory` 提供。
- `Normal` 之外的混合模式会被记录，但尚未映射到 GPU 混合状态。
- 编辑器里的滤镜尚未支持。

## 目录结构

```
src/core/     与引擎无关的运行时
src/babylon/  Babylon.js 渲染后端
tests/        rstest 套件；tests/fixtures 是真实发布的包
demo/         示例应用，也是覆盖面最广的集成测试
docs/         详细文档
```

`src/core/` 不导入 `src/babylon/`，也不引用 Babylon 类型，只通过
`src/core/render/IRenderObject.ts` 里的接口连接后端。这就是整个核心能无头运行和测试的
原因。

## 开发

```bash
npm run build       # rslib -> dist/
npm run dev         # rslib watch
npm test            # rstest
npm run test:watch  # rstest watch
npm run typecheck   # tsc，检查 src 与 tests 两个项目
```

测试在无 GPU 的 Node 里运行，用 Babylon 的 `NullEngine` 顶替 WebGL。`tests/fixtures/ui/`
存放编辑器发布的十六个真实包，解析器和每个控件都跑在这些数据上。

## 移植

本库是参考官方运行时从零实现的。动手移植模块前先读 [PORTING.md](./PORTING.md)。
