# 包与资源

FairyGUI 的**包（package）**是你在编辑器里发布的单位：一个 `.fui` 文件，内含项表和
每个组件的布局负载；外加一到多张图集图片，存放美术资源。运行时会解析 `.fui`，据此
构建显示列表，并通过可插拔的资源解析器解析美术资源。

## 发布

在 FairyGUI 编辑器里发布一个包，会生成：

```
ui/MainMenu.fui          包本体
ui/MainMenu_atlas0.png   图集 0（打包器拆分时还会有 atlas1、atlas2……）
```

较老版本的编辑器写 `.bytes` 而不是 `.fui`。两者格式相同；需要时把扩展名作为参数传给
`UIPackage.load`。

命名约定很重要：运行时用"包的基础路径 + `_`"来定位图集，因此必须用**不带扩展名**的
路径来寻址包。

## 加载

```ts
import { UIPackage } from 'fairygui-babylon';

// 拉取并解析。图集不会被 await —— 它们惰性加载。
const pkg = await UIPackage.load('ui/MainMenu');

// 或者，如果你已经拿到了字节：
const pkg = UIPackage.parse(arrayBuffer, 'ui/MainMenu');
```

| 成员 | 用途 |
| --- | --- |
| `UIPackage.load(basePath, extension = '.fui')` | 拉取 `basePath + extension`，然后解析。 |
| `UIPackage.parse(buffer, path = '')` | 解析原始字节。`path` 是用于定位同目录资源的基础路径。 |
| `UIPackage.getById(id)` / `getByName(name)` | 查找已加载的包。 |
| `UIPackage.getAllPackages()` | 所有已加载的包。 |
| `UIPackage.removePackage(idOrName)` | 从注册表中移除一个包。不会销毁已由它构建出的对象。 |

解析后的包会以 id、name、path 三种键注册。

## 创建对象

```ts
const main = pkg.createObject('Main');                    // 按导出名；可能为 null
const byUrl = UIPackage.createObjectFromURL('ui://MainMenu/Main');
const byPkg = UIPackage.createObject('MainMenu', 'Main'); // 静态形式
```

传入类名可以替换成你自己的实现：

```ts
import type { GComponent } from 'fairygui-babylon';

class HeroPanel extends GComponent { /* … */ }
const panel = pkg.createObject('HeroPanel', HeroPanel);
```

不过，把类绑定到包项的常用方式是
[`UIObjectFactory.setExtension`](./extending.md)，这样所有创建路径都会用它 —— 包括
其他组件里嵌套引用的该组件。

## `ui://` URL

每个项都有稳定 URL，形如 `ui://<包id><项id>`；也可以写成
`ui://<包名>/<项名>`。两种形式在任何接受 URL 的地方都有效：`GLoader.url`、
`UIObjectFactory.setExtension`、`UIConfig.tooltipsWin`、`GRoot.showModalWait` 配置的
资源等等。

| 函数 | 用途 |
| --- | --- |
| `UIPackage.getItemURL(pkgName, resName)` | 生成某项按 id 的 URL。 |
| `UIPackage.getItemByURL(url)` | 把任一形式解析为 `PackageItem`。 |
| `UIPackage.normalizeURL(url)` | 把按名字的 URL 转成按 id 的形式。 |

## 包项（`PackageItem`）

每个发布的资源都是一个 `PackageItem`，其 `type` 取自 `PackageItemType`：`Image`、
`MovieClip`、`Sound`、`Component`、`Atlas`、`Font`、`Swf`、`Misc`、`Spine`、
`DragonBones`。

`Component` 项还带一个来自 `ObjectType` 的 `objectType` —— 运行时据此知道该建 `GList`
而不是 `GComponent`、该建 `GButton` 而不是普通组件，等等。`PackageItem` 是导出的，
所以你可以查看包内容：

```ts
for (const item of pkg.items) {
    console.log(item.type, item.name, item.width, item.height);
}
```

`item.owner` 指回所属包。`item.rawData` 是未解码的组件负载；`item.asset` 是解析器
返回的资源。

## 图集、裁剪与旋转

编辑器把 sprite 打进图集，并为每个图片项记录：

- 它属于哪个图集项；
- 图集内的子矩形；
- 该区域是否被旋转 90° 存放；
- **裁剪（trim）** —— 当透明边被切掉时，记录偏移和原始尺寸。

对象的框是**未裁剪**的尺寸，因为布局就是照着它设计的。所以美术资源会按裁剪量内缩绘制，
而不是拉伸铺满整个框。这些信息通过 `UIPackage.getSprite(itemId)` /
`getSpriteByName(resName)` 暴露，辅助函数 `spriteTrim()` 在 sprite 是整图发布时返回
`null`。

`IImageObject.setSprite(texture, rect, rotated, trim)` 是这些信息跨到后端的入口。
忽略 `trim` 的后端会把裁剪过的图错位绘制。

## 资源解析器

纹理并没有硬编码到 Babylon。核心通过单一钩子索要资源：

```ts
import { setAssetResolver } from 'fairygui-babylon';

setAssetResolver((item: PackageItem) => {
    if (item.type !== PackageItemType.Atlas || !item.file) return null;
    return myTextureCache.get(item.file);
});
```

`UIPackage.getItemAsset(item)` 对每个项调用一次解析器，并把结果缓存在 `item.asset`
上（由 `item.decoded` 保护）。没有安装解析器时返回 `null`。

`installBabylonRenderer` 会把 `BabylonPackageAssets` 装为解析器，它把每个图集文件映射
为一个惰性加载的 Babylon `Texture`。纹理细节（包括为什么关闭 `invertY`、为什么地址
模式用 clamp）见[渲染](./rendering.md)。

## 外部图片等内容：`GLoader`

`GLoader` 可以指向普通图片 URL 而不是包项。这走的是另一个独立钩子：

```ts
import { setUIContentLoader, type UILoadedContent } from 'fairygui-babylon';

setUIContentLoader({
    load(url, callback) {
        const img = new Image();
        img.onload = () => callback(null, { texture, width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => callback(new Error('…'), null);
        img.src = url;
    },
});
```

`UILoadedContent` 携带后端的纹理句柄加源尺寸 —— 尺寸是必需的，因为 `GLoader` 要据此
布局内容，也因为失败时必须能回退到 `UIConfig.loaderErrorSign`。
`BabylonPackageAssets` 用 `Image` 元素而不是 Babylon 的 `Texture` 实现这个钩子，正是
出于这两个原因。

`GLoader` 也能渲染包对象：把 `url` 设为 `ui://` URL 会构建并显示对应组件或序列帧。

## 依赖、分支与变量

| 概念 | API |
| --- | --- |
| 跨包引用 | `pkg.dependencies` —— `{ id, name }` 列表。指向另一个包的 `ui://` URL 要能解析，两个包都必须已加载。 |
| 分支变体 | `UIPackage.branch = 'en'`、`pkg.branches`、`pkg.branchIndex`。分支名会作为前缀加到项名上，所以 `pkg.createObject('en/Main')` 选中分支副本。 |
| 包变量 | `UIPackage.setVar(key, value)` / `getVar(key)` —— 会代入引用它们的文本。 |
| 高清变体 | `item.highResolution` 列出替代项 id；`GRoot.contentScaleLevel`（由视口缩放推导）决定用哪一个。 |

## 本地化

翻译是**对包缓冲区的就地重写**，而不是绘制时查表：

```ts
import { TranslationHelper } from 'fairygui-babylon';

// 编辑器导出的 XML：一串扁平的 <string name="…">…</string>。
TranslationHelper.loadFromXML(xmlText);

// 在构建对象之前，逐组件就地应用。
TranslationHelper.translateComponent(packageItem);
```

`translateComponent` 会遍历组件的负载，就地覆写字符串表中保存文本、tooltip、齿轮文本、
下拉项标题、列表项标题的槽位。之后的一切 —— 包括由同一个包构建的第二个实例 —— 读到的
都是翻译后的字符串，无需再做别的。由于它改动的是共享状态，请**在创建对象之前**加载
翻译表。

解析用的是小型正则而不是 `DOMParser`，所以在没有 DOM 的 Node 里也能用。

## 内存与重载

包及其资源保存在模块级注册表里：已解析的包按 id/name/path，图集纹理按 URL 存在后端，
外部内容按 URL 存在后端。没有引用计数。要全部释放：

```ts
UIPackage.removePackage('MainMenu');   // 忘记这个包
renderer.packageAssets.dispose();      // 释放图集与外部纹理
```

已构建的对象在你销毁它们之前仍可用；它们持有 `PackageItem` 引用，但 GPU 内存由纹理
缓存持有。
