# 测试与构建

## 命令

```bash
npm run build        # rslib 构建到 dist/
npm run dev          # rslib watch 模式，改文件自动重建
npm test             # rstest 跑整个测试套件
npm run test:watch   # rstest watch 模式
npm run typecheck    # tsc 检查两个项目（src 与 tests）
```

跑单个文件：

```bash
npx rstest tests/uipackage.test.ts
```

## 类型检查有两个项目

`tsconfig.json` 只包含 `src`，`tests/tsconfig.json` 是独立的一份。因此
`npm run typecheck` 会依次检查两者：

```bash
tsc --noEmit -p tsconfig.json && tsc --noEmit -p tests/tsconfig.json
```

`src` 的严格模式由 TypeScript 6 默认开启（配置里没有显式写）。`noUnusedLocals`、
`noUnusedParameters` 打开，`useDefineForClassFields: true` 意味着声明但未初始化的字段
会被定义成 `undefined` —— 要么给初始值，要么在构造函数里赋值，要么用 `!` 断言。

## 测试在无 GPU 的 Node 里跑

不需要 WebGL。有两种后端可选：

### 真实 Babylon，`NullEngine`

```ts
import { createBabylonRenderer, GRoot } from '../src/index.js';
import { setRenderFactory } from '../src/core/render/IRenderObject.js';

const renderer = createBabylonRenderer();   // 无 scene/engine 时用 NullEngine
setRenderFactory(renderer);
const root = GRoot.create();
root.update(1 / 60);
```

`tests/babylon.test.ts` 走的就是这条路径，它验证真实的几何与文本提交。

### 完全无头：`MockRenderer`

`tests/helpers/mockRender.ts` 提供一个不绘制任何东西的后端：每个对象只保存普通状态，
并把被调用的方法名按顺序追加到 `calls`，所以测试既能断言最终属性，也能断言核心调用它们的
顺序。

```ts
import { setRenderFactory } from '../src/core/render/IRenderObject.js';
import { MockRenderer } from './helpers/mockRender.js';

const renderer = new MockRenderer();
setRenderFactory(renderer);

const root = GRoot.create();
// … 构建 UI …

const image = renderer.objects.find((o) => o.calls.includes('setSprite')) as MockImageObject;
expect(image.sprite!.rect).toEqual(new Rect(0, 0, 32, 32));
```

`MockRenderer` 会保留它创建过的所有对象、记录交给 `attachToStage` 的节点，并让你通过
`resizeViewport(w, h)` 模拟视口变化。`MockImageObject` / `MockTextObject` /
`MockGraphObject` 分别补齐对应接口的成员。

`GRoot` 是单例，测试之间会共享。常见的清理方式是：

```ts
function emptyRoot(): GRoot {
    const root = GRoot.create();
    root.removeChildren(0, -1, true);
    return root;
}
```

### 不经过入口点时的装配

只导入单个核心模块（而不是包入口 `src/index.ts`）时，控件工厂和 `ScrollPane` /
`Transition` 不会自动安装。测试里需要手动补上：

```ts
import '../src/index.js';                                  // 副作用：控件工厂等
import { setScrollPaneClass, setTransitionClass } from '../src/core/Builtins.js';
import { ScrollPane } from '../src/core/ScrollPane.js';
import { Transition } from '../src/core/Transition.js';

setScrollPaneClass(ScrollPane);
setTransitionClass(Transition);
```

## 时间必须显式驱动

运行时从不读墙上时钟，所有时间都由 `dt` 传入。这让动画在测试里完全可复现：

```ts
root.update(0.1);              // 调度器 + 缓动 + 子节点 onUpdate
TweenManager.update(0.1);      // 只推缓动
scheduler.update(0.1);         // 只推延迟回调（单例，从包入口导入）
```

双击判定用的时钟也是可注入的：

```ts
root.inputProcessor.clock = () => 100;   // 返回秒
```

## 测试数据：真实的发布包

`tests/fixtures/ui/` 存有 16 个由真实 FairyGUI 编辑器发布的包（连同图集），这是测试的
主要数据来源：

```
Bag  Basics  Chat  Cooldown  Guide  HitTest  Joystick  ListEffect
LoopList  MainMenu  ModalWaiting  PullToRefresh  ScrollPane  Transition
TreeView  VirtualList
```

配套的 `tests/helpers/fixtures.ts`：

```ts
import { readFixture, fixturePath, readPngSize } from './helpers/fixtures.js';

const buf = readFixture('Basics.fui');       // 返回恰好拥有自己字节的 ArrayBuffer
const path = fixturePath('Basics.fui');
const { width, height } = readPngSize('Basics_atlas0.png');  // 只读 PNG 的 IHDR
```

测试套件按主题分文件：`uipackage`（解析与图集）、`widgets`、`gears`、`transition`、
`tween`、`scrollpane`、`text`、`drag`、`lifecycle`、`integration`、`babylon`。
凡涉及 `GObject` 的测试都需要一个渲染后端，所以会先 `setRenderFactory`。相比手工拼
缓冲区，优先针对这些真实包做断言。

## 构建

```bash
npm run build
```

`rslib.config.ts` 输出 ESM 加类型声明。`@babylonjs/core` 是 **external**，不打进产物：

```ts
externals: [/^@babylonjs\/core(\/.*)?$/],
```

这是刻意的 —— 消费方已经有 Babylon，打进来会让库从约 200 kB 变成约 2.4 MB，并引入第二
份引擎实例。

`package.json` 的 `exports` 指向 `dist/index.js` 和 `dist/index.d.ts`，`files` 只发布
`dist`。

## 集成测试：demo

仓库根目录之外，`demo/` 是一个 Vite 应用，把整个示例应用跑在这个运行时上。它是覆盖面
最广的手动测试：按钮、列表、树、滚动面板、窗口、弹窗、拖放、富文本与表情、一千行的
虚拟列表。详见 [`demo/README.md`](../demo/README.md)。

`demo/vite.config.ts` 把 `fairygui-babylon` 别名到 `../src/index.ts`，所以它直接从源码
编译，无需先构建根仓库；它同时去重了 `@babylonjs/core`，避免出现两份引擎实例。
