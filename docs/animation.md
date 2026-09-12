# 动画

运行时有四套彼此配合的动画机制：

| 机制 | 由谁驱动 | 典型用途 |
| --- | --- | --- |
| [控制器](#控制器) | 切换页面 | 选项卡、状态机、页面切换 |
| [齿轮（gear）](#齿轮) | 控制器的页面变化 | 让某个属性跟随页面自动变化 |
| [过渡（transition）](#过渡) | `root.update(dt)` | 编辑器里编排的时间轴动画 |
| [缓动（tween）](#缓动) | `root.update(dt)` | 代码里的程序化动画 |

四者都由编辑器创作并在包里序列化，运行时按相同方式解析。

## 控制器

控制器是一组具名**页面**，任意时刻恰好选中一个。

```ts
const c = comp.getController('tab');

c.selectedIndex = 2;
c.selectedPage = 'tab3';
c.selectedPageId = 'p3';

c.onChanged(() => console.log(c.selectedIndex, c.previsousIndex));
c.offChanged(listener);

c.pageCount;
c.getPageName(0);
c.addPage('extra');
c.removePage('extra');
c.hasPage('tab1');
c.runActions();          // 重跑当前页面绑定的动作
```

| 成员 | 说明 |
| --- | --- |
| `selectedIndex` / `selectedPage` / `selectedPageId` | 选中项。`setSelectedIndex(v)` / `setSelectedPage(v)` 是等价的方法形式。 |
| `previsousIndex` / `previousPage` / `previousPageId` | 上一个选中项。索引的访问器拼写就是 `previsousIndex`（参考实现的历史拼写错误，为保持兼容原样保留）。 |
| `onChanged(cb, target?)` / `offChanged(cb, target?)` | 页面变化回调。也可监听组件上的 `EventType.STATUS_CHANGED`。 |
| `parent` | 所属 `GComponent`。 |
| `addPage(name?)` / `addPageAt(name, index)` / `removePage(name)` / `removePageAt(index)` / `clearPages()` | 运行时增删页面。 |
| `getPageIndexById` / `getPageIdByName` / `getPageNameById` / `getPageId` | 页面与 id/name 互查。 |
| `oppositePageId` | 设置与当前页相对的目标页，用于开关式交互。 |
| `dispose()` | |

当控制器挂到 `GComponent` 上时，用 `comp.getController(name)` / `getControllerAt(index)`
取，`comp.controllers` 列出全部。

### 控制器动作

页面切换时会触发**动作** —— 编辑器里配置，包里序列化。两个内置动作：

| 类 | 类型 id | 作用 |
| --- | --- | --- |
| `PlayTransitionAction` | `0` | 播放某个过渡。 |
| `ChangePageAction` | `1` | 切换另一个控制器的页面。 |

`ControllerAction` 基类带有 `fromPage` / `toPage` 过滤（空数组表示"任意"），派生类实现
`enter(controller)` / `leave(controller)`。可以注册自己的动作：

```ts
import { ControllerAction, registerAction } from 'fairygui-babylon';

class MyAction extends ControllerAction {
    protected enter(controller: Controller): void { /* … */ }
    protected leave(controller: Controller): void { /* … */ }
}

registerAction(2, MyAction);   // 2 号动作类型
```

`createAction(type)` 按 id 构造；未知 id 会抛错。

## 齿轮

齿轮是编辑器用来"让某属性跟随控制器页面"的机制，共十个。每个齿轮为每个页面存一个值，
控制器切页时应用当前页的值，并可选补间。

```ts
import { GearIndex, GearBase } from 'fairygui-babylon';

const gear = obj.getGear(GearIndex.Color);
gear.controller = comp.getController('state');
gear.tweenConfig.tween = true;
gear.tweenConfig.duration = 0.3;
gear.tweenConfig.easeType = EaseType.QuadOut;
gear.tweenConfig.delay = 0;

obj.gearXY;      // GearXY
obj.gearSize;    // GearSize
obj.gearLook;    // GearLook
```

### `GearIndex` 的槽位

| 常量 | 值 | 齿轮类 | 驱动 |
| --- | --- | --- | --- |
| `Display` | 0 | `GearDisplay` | 可见性 |
| `XY` | 1 | `GearXY` | 位置 |
| `Size` | 2 | `GearSize` | 尺寸 |
| `Look` | 3 | `GearLook` | 透明度、旋转、灰度 |
| `Color` | 4 | `GearColor` | 颜色 |
| `Animation` | 5 | `GearAnimation` | 序列帧播放状态 |
| `Text` | 6 | `GearText` | 文本 |
| `Icon` | 7 | `GearIcon` | 图标 |
| `Display2` | 8 | `GearDisplay2` | 带条件的可见性 |
| `FontSize` | 9 | `GearFontSize` | 字号 |

`GearBase.disableAllTweenEffect = true` 可全局关闭齿轮补间，适合需要确定性的测试。

自定义齿轮通过 `registerGear(index, Ctor)` 注册进 `GearBase` 的表；齿轮模块本身在入口点
以副作用方式导入，所以要新增时必须在 `src/index.ts` 接上。

## 过渡

过渡是编辑器里编排的时间轴：一串被命名的动作，作用于组件内的对象。

```ts
const t = comp.getTransition('show')!;

t.play(() => console.log('done'), 1, 0);   // (完成回调, 次数, 延迟秒)
t.playReverse();
t.stop(true);              // 第一个参数：是否跳到完成状态
t.setPaused(true);
t.changePlayTimes(3);
t.setAutoPlay(true, -1, 0); // (是否自动播放, 次数 -1 为无限, 延迟)

t.playing;
t.timeScale = 2;
```

### 标签、钩子与运行时改写

过渡里的每个动作可以有标签；也可以在运行时改写目标、时长和值：

```ts
t.setValue('x', 100);              // 覆盖某标签动作的目标值
t.setHook('label', (label) => { /* 动作到达时 */ });
t.clearHooks();
t.setTarget('label', otherObject);
t.setDuration('label', 0.5);
t.getLabelTime('label');           // 该标签在时间轴上的秒数
```

`onEnable()` / `onDisable()` 在组件挂上/脱离显示列表时调用，用于自动播放的过渡。
`updateFromRelations(targetId, dx, dy)` 用于位置由关联驱动的对象，重复播放时不会把对象拖回
原位。

过渡的时间轴由 `root.update(dt)` 推进。

## 缓动

程序化动画走 `GTween`。所有静态入口都返回一个可链式调用的 `GTweener`：

```ts
import { GTween, EaseType, GPath, GPathPoint } from 'fairygui-babylon';

GTween.to(0, 100, 0.4)
    .setEase(EaseType.QuadOut)
    .onUpdate((v) => { obj.x = v.x; })
    .onComplete(() => { /* … */ });

GTween.to2(0, 0, 100, 50, 0.5);          // 两条通道
GTween.to3(/* … */);
GTween.to4(/* … */);
GTween.toColor(0x000000, 0xffffff, 0.3); // 颜色通道
GTween.delayedCall(1).onComplete(() => { /* … */ });
GTween.shake(0, 0, 10, 0.5);             // 抖动
```

### 静态控制

| 方法 | 用途 |
| --- | --- |
| `GTween.isTweening(target, propType?)` | 某目标上是否有补间在跑。 |
| `GTween.kill(target, complete?, propType?)` | 杀掉某目标上的补间。 |
| `GTween.getTween(target, propType?)` | 取当前补间。 |
| `GTween.catchCallbackExceptions` | 是否捕获回调异常（默认 `true`）。 |

### `GTweener` 的链式配置

`setDelay`、`setDuration`、`setBreakpoint`、`setEase`、`setEasePeriod`、
`setEaseOvershootOrAmplitude`、`setRepeat(repeat, yoyo?)`、`setTimeScale`、
`setSnapping`、`setTarget`、`setPath`、`setUserData`、`onStart`、`onUpdate`、`onComplete`、
`setPaused`、`seek(time)`、`kill(complete?)`。

缓动函数在 `EaseType` 里；路径动画用 `GPath` / `GPathPoint`，通过 `.setPath(path)` 设置。

时间前进由 `TweenManager.update(dt)` 负责，而它由 `root.update(dt)` 调用 —— 所以只要根
节点在更新，缓动就会走。

## 序列帧

`GMovieClip` 播放包里的 `MovieClip` 项。

```ts
clip.playing = true;
clip.frame = 3;
clip.timeScale = 1;
clip.rewind();
clip.syncStatus(otherClip);        // 与另一个序列帧同步
clip.advance(0.1);                 // 手动前进
clip.setPlaySettings(0, 9, 3, 9, () => { /* 播放 3 次后停在 9 帧 */ });
```

`setPlaySettings(start?, end?, times?, endAt?, endCallback?, callbackObj?)` 里，`times = 0`
表示无限循环，`endAt = -1` 表示停在 `end` 帧。

底层的 `MovieClip` 类把帧表与播放状态分开，`frameResolver` 是可以替换的扩展点 ——
当帧不属于图集、需要自定义取帧方式时使用。

`GMovieClip` 与 `GLoader` 的每帧推进同样由 `root.update(dt)` 驱动，所以它们的播放速度
与你的渲染循环一致。
