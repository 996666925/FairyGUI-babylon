# 扩展

运行时有若干刻意留出的扩展点。本文按"你想替换什么"来组织。

## 用自定义类替换某个组件

编辑器里导出的组件可以绑定到你自己写的类。推荐用 `UIObjectFactory.setExtension`，
它按 `ui://` URL 注册，所有创建路径都会命中 —— 包括其他组件里嵌套引用该组件的情况：

```ts
import { GComponent, UIObjectFactory, GRoot, UIPackage } from 'fairygui-babylon';

class HeroPanel extends GComponent {
    public override constructFromResource(): void {
        super.constructFromResource();       // 先把编辑器里的内容建出来
        this.getChild('hpBar')!.asProgress!.value = 80;
    }
}

// 按名字的 URL 形式，或按 id 的形式 ui://<包id><项id> 都可以。
// 已经解析过的项会立即用上新类，不必重新解析。
UIObjectFactory.setExtension('ui://MainMenu/HeroPanel', HeroPanel);

const pkg = await UIPackage.load('ui/MainMenu');
const hero = pkg.createObject('HeroPanel');   // 现在会是 HeroPanel 实例
```

也可以只在某一次创建时传类：

```ts
const hero = pkg.createObject('HeroPanel', HeroPanel);
```

其它相关入口：

| 入口 | 用途 |
| --- | --- |
| `UIObjectFactory.setExtension(url, type)` | 注册；已解析的项立即生效。 |
| `UIObjectFactory.getExtension(url)` | 查询。 |
| `UIObjectFactory.setLoaderExtension(type)` | 把默认的 `GLoader` 换成子类。 |
| `registerExtension` / `getExtension` / `resolveExtension` | 底层注册表（`ExtensionRegistry.ts`），无导入依赖。 |
| `setObjectFactory(factory)` | 更激进：整体替换"`ObjectType` → 控件类"的工厂。 |

### 覆写 `createDisplayObject`

如果控件需要特定类型的渲染节点（图片、文本、矢量），覆写 `createDisplayObject()` 并
从渲染工厂取对应节点：

```ts
protected createDisplayObject(): void {
    this._node = getRenderFactory().createImage();
}
```

它从 `GObject` 的构造函数里运行，所以覆写里**不能**碰子类字段 —— 那时它们还没初始化。
需要设置子类状态时，放到构造函数体里或 `constructFromResource` 中。

### 替换 `GLoader`

```ts
class MyLoader extends GLoader {
    // …
}
UIObjectFactory.setLoaderExtension(MyLoader);
```

## 自定义命中区域

`GComponent.hitArea` 接收任何实现了 `IHitTest` 的对象：

```ts
import type { IHitTest } from 'fairygui-babylon';
import type { GObject } from 'fairygui-babylon';
import type { Point } from 'fairygui-babylon';

class CircularHitArea implements IHitTest {
    public constructor(private _owner: GObject) {}

    public hitTest(pt: Point, _globalPt: Point): boolean {
        const r = this._owner.width / 2;
        const dx = pt.x - r;
        const dy = pt.y - r;
        return dx * dx + dy * dy <= r * r;
    }
}

comp.hitArea = new CircularHitArea(comp);
```

`hitTest(pt, globalPt)` 的第一个参数在所属对象的局部空间，第二个是同一位置的 UI 根
空间坐标（供需要深入子节点自身坐标的测试使用）。

内置实现：`PixelHitTest`（编辑器烘焙的 alpha 掩码，位按 LSB 优先、行主序打包）、
`ChildHitArea`（把点击区域交给某个子节点的轮廓）、`PixelHitTestData`（解码后的掩码）。
图片项的 `hitTestData` 由包解析填充。

## 资源解析

### 替换包资源的解析

```ts
import { setAssetResolver, PackageItemType } from 'fairygui-babylon';

setAssetResolver((item) => {
    if (item.type !== PackageItemType.Atlas || !item.file) return null;
    return myCache.textureFor(item.file);
});
```

结果缓存在 `item.asset`，每项只调用一次。传 `null` 注销。详见[包与资源](./packages.md)。

### 替换 `GLoader` 外部内容的加载

```ts
import { setUIContentLoader } from 'fairygui-babylon';

setUIContentLoader({
    load(url, callback) {
        // callback(err, { texture, width, height })
    },
});
```

`GLoader` 需要源尺寸来布局内容、需要错误来显示 `UIConfig.loaderErrorSign`。

### 提供 `GLoader3D` 的内容

运行时不自带骨骼引擎。注册一个工厂，Spine、DragonBones 或任何你有的内容都能接进来：

```ts
import { setLoader3DContentFactory, type ILoader3DContent } from 'fairygui-babylon';

setLoader3DContentFactory({
    createFromPackage(item) {
        // 返回 ILoader3DContent 或 null（不支持该类型时）
        return null;
    },
    createFromUrl(url) {
        return null;
    },
});
```

`ILoader3DContent` 需要实现：`node`（挂进加载器容器的渲染节点）、`playing`、`frame`
（当前动画的归一化 `0..100` 位置）、`animationName`、`skinName`、`loop`、`color`、
`update(dt)`、`dispose()`。除内容之外的 URL 处理、填充模式、对齐、自动尺寸和
`playing`/`frame`/`skinName` 等属性面都由加载器负责。

## 自定义字体

```ts
import { registerFont } from 'fairygui-babylon';

registerFont('Title', myBitmapFont);
```

之后文本字段可以 `field.font = 'Title'`。注册表本身对类型不做校验，但 `GTextField`
只有在取到的值是 `BitmapFont` 实例时才会采用它，否则把该名字当作系统字体族；以
`ui://` 开头的名字则按包项解析，不走注册表。见[文本](./text.md)。

## 声音

运行时不自带音频后端，`soundPlayer` 就是留给你的接口：

```ts
root.soundPlayer = (clip, volume) => audio.play(clip, volume);
```

未安装时 `playOneShotSound` 是空操作而不是报错，因为按钮点击时会无条件地调用它。
全局默认值在 `UIConfig`：

```ts
UIConfig.buttonSound = 'ui://MainMenu/Click';
UIConfig.buttonSoundVolumeScale = 1;
root.volumeScale = 0.8;                 // 全局音量系数
root.playOneShotSound(clip, 0.5);       // 单次播放，会乘以上面的系数
```

## 全局配置（`UIConfig`）

`UIConfig` 是运行时默认值的集中处。常用项：

| 字段 | 作用 |
| --- | --- |
| `defaultFont` | 未指定字体时使用的字体，默认 `'Arial'`。 |
| `windowModalWait` / `globalModalWait` | `Window` / `GRoot` 模态等待界面的资源 URL。 |
| `modalLayerColor` | 模态遮罩颜色。 |
| `tooltipsWin` | `showTooltips` 使用的资源 URL。 |
| `popupMenu` / `popupMenu_seperator` | `PopupMenu` 的模板资源。 |
| `loaderErrorSign` | `GLoader` 加载失败的占位资源。 |
| `horizontalScrollBar` / `verticalScrollBar` | 默认滚动条资源。 |
| `buttonSound` / `buttonSoundVolumeScale` | 按钮点击音效。 |
| `defaultScrollStep` / `defaultScrollDecelerationRate` / `defaultScrollBarDisplay` / `defaultScrollTouchEffect` / `defaultScrollBounceEffect` | 滚动面板默认行为。 |
| `defaultComboBoxVisibleItemCount` | 下拉框可见项数。 |
| `touchScrollSensitivity` / `touchDragSensitivity` / `clickDragSensitivity` | 触摸/拖拽灵敏度。 |
| `bringWindowToFrontOnClick` | 点击是否把窗口提到最前。 |
| `linkUnderline` | 富文本链接默认是否加下划线。 |
| `defaultUIGroup` | UI 网格放入的渲染分组名。 |

## 自定义齿轮与控制器动作

两者都按 id 自注册：

```ts
import { registerGear, GearBase, GearIndex } from 'fairygui-babylon';
registerGear(/* 槽位 */ GearIndex.Color, MyGear);

import { ControllerAction, registerAction } from 'fairygui-babylon';
registerAction(2, MyAction);
```

**新增自注册模块后，必须在核心入口 `src/index.ts` 里以副作用方式导入它**，否则运行时
拿不到对应实现，而且不会有编译错误。原因见[架构](./architecture.md)。

## 本地化

`TranslationHelper.loadFromXML(xml)` 加载编辑器的翻译表，
`TranslationHelper.translateComponent(item)` 在构建对象**之前**就地重写组件的字符串表。
详见[包与资源](./packages.md)。

## 自定义渲染后端

用另一套引擎替换 Babylon 见[渲染](./rendering.md#写一个不同的后端)。`tests/helpers/mockRender.ts`
是一份完整、带注释的参考实现。
