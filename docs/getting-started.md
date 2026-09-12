# 快速上手

本文从一个空工程开始，带你做出一个由 FairyGUI 发布包构建的 UI：渲染在
Babylon.js 场景之上，能接收指针输入，并跟随窗口尺寸变化。

## 环境要求

- **Babylon.js 9** —— `@babylonjs/core@^9` 是 peer 依赖。运行时引用它但不打包
  它，所以你的应用只保留一份引擎。
- 文本需要浏览器或类 DOM 环境；其余部分在 Node 里也能跑（见下方[无头模式](#无头模式)）。
- 构建与测试工具链需要 Node `^20.19.0 || >=22.12.0`。

## 安装

```bash
npm install fairygui-babylon @babylonjs/core
```

## 一个文件里的完整流程

```ts
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { installBabylonRenderer, UIPackage, GRoot } from 'fairygui-babylon';

const canvas = document.querySelector('canvas')!;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);

// 1. 安装后端。一次调用同时接好渲染节点和纹理/内容解析器。
const renderer = installBabylonRenderer({
    scene,
    width: canvas.clientWidth,
    height: canvas.clientHeight,
});

// 2. 创建 UI 根节点。它是单例，尺寸跟随渲染器的视口。
const root = GRoot.create();

// 3. 加载一个包，并构建其中一个组件。
const pkg = await UIPackage.load('ui/MainMenu');
const main = pkg.createObject('Main')!;
root.addChild(main);

// 4. 驱动 UI 时钟。`dt` 单位是秒。
scene.onBeforeRenderObservable.add(() => {
    root.update(engine.getDeltaTime() / 1000);
});

// 5. 喂入指针输入，坐标是 UI 单位（见下文）。
root.inputProcessor.touchBegin(0, 100, 100);
root.inputProcessor.touchEnd(0, 100, 100);

// 6. 跟随窗口。
window.addEventListener('resize', () => {
    engine.resize();
    renderer.setViewport(canvas.clientWidth, canvas.clientHeight);
});

engine.runRenderLoop(() => scene.render());
```

下面逐条解释每一步，以及每个决定背后的原因。

## 1. 安装渲染器

`installBabylonRenderer(options)` 做三件事：

1. 在你的场景上创建 `BabylonRenderer`（如果既没传 `scene` 也没传 `engine`，就用
   `NullEngine`）。
2. 调用 `setRenderFactory(renderer)`，把它设为进程级后端 —— 之后构建的每个
   `GObject` 都会用它。
3. 调用 `renderer.packageAssets.install()`，注册包的图集纹理解析器，以及
   `GLoader` 外部图片的内容加载器。

除非有特别理由，否则就用它。更底层的入口是：

```ts
import { createBabylonRenderer } from 'fairygui-babylon';
import { setRenderFactory } from 'fairygui-babylon';

const renderer = createBabylonRenderer({ scene, width, height });
setRenderFactory(renderer);
renderer.packageAssets.install();   // 不装就不显示包里的美术资源
```

这两个钩子都是**全局**的。这是有意为之：`GObject` 在自己的构造函数里就创建渲染
节点，那时它还没挂到任何根节点上，因此没有地方可以注入后端。原因见
[架构](./architecture.md)。

### 后端对你的场景做了什么

UI 是**屏幕空间的正交叠加层**。渲染器自建一台相机，并把它们放进
`scene.activeCameras` 中**你的相机之后**；它从不替换 `scene.activeCamera`，也不
清空颜色缓冲。UI 网格和 UI 相机使用专属的 layer 位（[`UI_LAYER_MASK`](./rendering.md)），
所以你的相机不画 UI，UI 相机也不画你的网格。你现有的相机配置完全不受影响。

## 2. 创建根节点

```ts
const root = GRoot.create();
```

`GRoot` 是单例 —— `GRoot.create()` 若已有实例就返回它，并把它重新绑定到当前的
渲染后端。确定存在时可用 `GRoot.inst` 取。根节点：

- 尺寸等于后端视口，并通过 resize 回调跟随视口变化；
- 持有 `InputProcessor`，指针输入都走 `root.inputProcessor`；
- 持有模态层、弹窗栈和 tooltip 窗口；
- 是时钟：`root.update(dt)` 推进调度器、缓动和每个控件的逐帧更新。

## 3. 加载包并构建组件

包用**不带扩展名**的基础路径寻址：

```ts
const pkg = await UIPackage.load('ui/MainMenu');   // 拉取 ui/MainMenu.fui
const main = pkg.createObject('Main');             // 按导出名构建
```

解析器基于同一个基础路径定位图集，所以 `ui/MainMenu` 会找到
`ui/MainMenu_atlas0.png`。如果你已经拿到字节，用同步形式：

```ts
const pkg = UIPackage.parse(arrayBuffer, 'ui/MainMenu');
```

`createObject` 返回 `GObject | null` —— 名字没有被该包导出时返回 `null`。也可以
用 `ui://` URL 创建：

```ts
const obj = UIPackage.createObjectFromURL('ui://MainMenu/Main');
```

纹理会**在一个同步解析器背后惰性、异步加载**：图片对象在构建的那一刻就拿到纹理
句柄，像素到达后由 Babylon 填进去。因此美术资源是边加载边出现，不需要刷新流程。

图集与裁剪、依赖、分支、本地化等完整内容见[包与资源](./packages.md)。

## 4. 驱动时钟

每一帧有两次互相独立的更新：

| 调用 | 作用 | 谁来调 |
| --- | --- | --- |
| `renderer.update()` | 重算 UI 世界矩阵、累计 alpha、裁剪栈、绘制顺序，并上传变脏的几何和文本。 | 渲染器自己注册在 `scene.onBeforeRenderObservable` 上，`scene.render()` 会触发它。 |
| `root.update(dt)` | 推进调度器（延迟回调）、缓动管理器，以及每个子节点的 `onUpdate`。 | **你来调。** 没有任何代码替你调。 |

如果你自己掌控渲染循环，要么像上面那样加一个 observer，要么两个都自己调：

```ts
engine.runRenderLoop(() => {
    root.update(engine.getDeltaTime() / 1000);
    scene.render();          // 或者：renderer.render() —— 先 update() 再 scene.render()
});
```

传入 `dt` 而不是读墙上时钟，是让动画在测试中可复现的关键；见[测试与构建](./testing.md)。

## 5. 喂入指针输入

后端只负责画，不负责监听。把指针事件转发给根节点的输入处理器，坐标是 **UI 单位**
—— 原点左上、y 向下。若你的 canvas 铺满窗口，这就是指针位置减去 canvas 的矩形，
不需要任何缩放：

```ts
const input = root.inputProcessor;

input.touchBegin(pointerId, x, y, button);  // button：0 左键，1 右键，2 中键
input.touchMove(pointerId, x, y);           // 按住期间
input.mouseMove(x, y);                      // 悬停，无按键
input.touchEnd(pointerId, x, y);
input.touchCancel(pointerId, x, y);         // 系统取消 / 失焦
input.mouseWheel(delta, x, y);              // 正数 = 向下
```

一套**完整**的宿主接入 —— 包括如何阻止事件传给宿主相机、如何在指针离开 canvas 后
仍保持拖拽归属 —— 见[输入与事件](./input-and-events.md)，以及
`demo/src/UiHost.ts`。

## 6. 跟随窗口

用你布局 UI 时所用的同一套单位来调整视口：

```ts
renderer.setViewport(cssWidth, cssHeight);
```

根节点通过 `onViewportResize` 收到通知并自行调整尺寸，不需要额外调用根节点的
resize。在高分屏上，视口请保持 **CSS 像素**：运行时会按设备像素比光栅化
文本（`renderer.pixelRatio`），因此一个 UI 单位始终等于一个 CSS 像素，指针坐标
可以原样映射。

如果你的 canvas 是按设备像素设置的，`renderer.resizeToEngine()` 会从引擎读取
尺寸并除掉硬件缩放系数。

## 7. 销毁

```ts
root.dispose();
renderer.packageAssets.dispose();   // 注销解析器并释放纹理
renderer.dispose();                 // 销毁相机和 UI 根节点
```

如果创建渲染器时没有传宿主 `scene` 或 `engine`，`dispose()` 会连同它自己创建的
场景和引擎一起销毁。

## 无头模式

既没有 `scene` 也没有 `engine` 时，后端跑在 Babylon 的 `NullEngine` 上：

```ts
const renderer = createBabylonRenderer();          // 默认 1024x768
setRenderFactory(renderer);
const root = GRoot.create();
root.update(1 / 60);                               // 不需要 GPU
```

这也是测试套件走的路径。除非你提供 `createCanvas` / `textMetrics`，文本对象只会
布局、不绘制；见[渲染](./rendering.md)。

## 常见坑

- **从包的入口导入，不要用深层路径。** `fairygui-babylon` 会引入自注册的齿轮和
  控制器动作表、安装控件工厂、绑定 `ScrollPane`/`Transition`。缺少这些绑定时构建
  组件会抛出说明性错误，而不是悄悄出错。
- **所有坐标都是 UI 单位**：原点左上、y 向下、角度为顺时针度数。永远不要把
  Babylon 空间的坐标交给运行时。
- **`root.update(dt)` 是必须的。** 没有任何代码读墙上时钟，不调用它，过渡、缓动和
  延迟回调就永远不会跑。
- **只保留一份 `@babylonjs/core`。** Babylon 通过给 `ThinEngine.prototype` 打补丁
  来安装引擎能力；两份副本会让补丁落在你的引擎并不继承的原型上。如果你把库的源码
  做了别名，记得在打包器里去重。
- **文本需要光栅化器。** 没有 `OffscreenCanvas` 或 `document` 时，请传入
  `createCanvas` 工厂，否则文本会用估算度量布局并且不绘制。
