/**
 * FairyGUI runtime for Babylon.js.
 *
 * Importing this module wires the runtime together: it pulls in the
 * self-registering gear and controller-action tables, installs the widget
 * factory, and binds the two heavyweight collaborators (`ScrollPane`,
 * `Transition`) that `GComponent` reaches through `Builtins`.
 *
 * Importing anything from `src/core/` directly skips that wiring, so a partial
 * import that builds a component will throw with an explanatory message rather
 * than misbehave.
 */

// ---- wiring (import for side effects, in dependency order) ----------------
import './core/gears/index.js';
import './core/action/index.js';
import { setScrollPaneClass, setTransitionClass } from './core/Builtins.js';
import { ScrollPane } from './core/ScrollPane.js';
import { Transition } from './core/Transition.js';
// Registers the ObjectType -> widget-class table used by UIPackage/GComponent.
import './core/UIObjectFactory.js';

setScrollPaneClass(ScrollPane);
setTransitionClass(Transition);

// ---- core ----------------------------------------------------------------
export { GObject } from './core/GObject.js';
export { GComponent } from './core/GComponent.js';
export { GGroup } from './core/GGroup.js';
export { GImage } from './core/GImage.js';
export { GGraph, GraphType } from './core/GGraph.js';
export {
    GLoader,
    setUIContentLoader,
    getUIContentLoader,
    type UIContentLoader,
    type UILoadedContent,
    type UIContentLoadCallback,
} from './core/GLoader.js';
export {
    GLoader3D,
    setLoader3DContentFactory,
    type ILoader3DContent,
    type ILoader3DContentFactory,
} from './core/GLoader3D.js';
export { GMovieClip, MovieClip, type FrameResolver, type ResolvedFrame } from './core/GMovieClip.js';
export { GTextField } from './core/GTextField.js';
export type { TextFormat } from './core/GTextField.js';
export { GRichTextField } from './core/GRichTextField.js';
export { GTextInput, type ITextInputObject } from './core/GTextInput.js';
export { GButton } from './core/GButton.js';
export { GLabel } from './core/GLabel.js';
export { GProgressBar } from './core/GProgressBar.js';
export { GSlider } from './core/GSlider.js';
export { GScrollBar } from './core/GScrollBar.js';
export { GComboBox } from './core/GComboBox.js';
export { GList } from './core/GList.js';
export { GTree } from './core/GTree.js';
export { GTreeNode } from './core/GTreeNode.js';
export { GObjectPool } from './core/GObjectPool.js';
export { GRoot } from './core/GRoot.js';
export { Window } from './core/Window.js';
export type { IUISource } from './core/IUISource.js';
export { PopupMenu } from './core/PopupMenu.js';
export { DragDropManager } from './core/DragDropManager.js';
export { Controller } from './core/Controller.js';
export { Transition } from './core/Transition.js';
export { ScrollPane } from './core/ScrollPane.js';
export { UIObjectFactory } from './core/UIObjectFactory.js';
export { UIConfig, registerFont, getFontByName } from './core/UIConfig.js';
export { UBBParser } from './core/UBBParser.js';

// ---- packages ------------------------------------------------------------
export {
    UIPackage,
    setAssetResolver,
    spriteTrim,
    setObjectFactory,
    type AtlasSprite,
    type PackageDependency,
    type AssetResolver,
} from './core/UIPackage.js';
export { PackageItem, type Frame } from './core/PackageItem.js';
export { TranslationHelper, translateComponent } from './core/TranslationHelper.js';

// ---- events --------------------------------------------------------------
export { Event, EventType } from './core/event/Event.js';
export { EventDispatcher, type Listener } from './core/event/EventDispatcher.js';
export { InputProcessor } from './core/event/InputProcessor.js';
export { PixelHitTest, PixelHitTestData, ChildHitArea, type IHitTest } from './core/event/HitTest.js';

// ---- gears ---------------------------------------------------------------
export {
    GearBase, GearTweenConfig, GearIndex, registerGear,
} from './core/gears/GearBase.js';
export { GearDisplay } from './core/gears/GearDisplay.js';
export { GearDisplay2 } from './core/gears/GearDisplay2.js';
export { GearXY } from './core/gears/GearXY.js';
export { GearSize } from './core/gears/GearSize.js';
export { GearLook } from './core/gears/GearLook.js';
export { GearColor } from './core/gears/GearColor.js';
export { GearAnimation } from './core/gears/GearAnimation.js';
export { GearText } from './core/gears/GearText.js';
export { GearIcon } from './core/gears/GearIcon.js';
export { GearFontSize } from './core/gears/GearFontSize.js';

// ---- controller actions --------------------------------------------------
export { ControllerAction, createAction, registerAction } from './core/action/ControllerAction.js';
export { PlayTransitionAction } from './core/action/PlayTransitionAction.js';
export { ChangePageAction } from './core/action/ChangePageAction.js';

// ---- tweens --------------------------------------------------------------
export { GTween } from './core/tween/GTween.js';
export { GTweener } from './core/tween/GTweener.js';
export { TweenManager } from './core/tween/TweenManager.js';
export { TweenValue } from './core/tween/TweenValue.js';
export { EaseType } from './core/tween/EaseType.js';
export { GPath } from './core/tween/GPath.js';
export { GPathPoint } from './core/tween/GPathPoint.js';

// ---- render seam ---------------------------------------------------------
export {
    setRenderFactory,
    getRenderFactory,
    type IRenderObject,
    type IImageObject,
    type SpriteTrim,
    type ITextObject,
    type IGraphObject,
    type IRenderFactory,
} from './core/render/IRenderObject.js';

// ---- helpers and types ---------------------------------------------------
export { ByteBuffer } from './core/utils/ByteBuffer.js';
export { ToolSet } from './core/utils/ToolSet.js';
export { Point, Rect } from './core/utils/Geometry.js';
export { Color } from './core/utils/Color.js';
export { Margin } from './core/Margin.js';
export { Scheduler } from './core/utils/Scheduler.js';
export { scheduler } from './core/Scheduler.js';
export { globalState } from './core/State.js';
export { registerExtension, getExtension, resolveExtension } from './core/ExtensionRegistry.js';
export { setStage, getStage } from './core/Stage.js';
export {
    BitmapFont,
    type BitmapFontData,
    type BitmapFontGlyph,
    type BitmapGlyphSource,
} from './core/display/BitmapFont.js';

export * from './core/FieldTypes.js';

// ---- Babylon backend -----------------------------------------------------
export {
    BabylonRenderer,
    createBabylonRenderer,
    installBabylonRenderer,
    BabylonPackageAssets,
    UI_LAYER_MASK,
    type BabylonRendererOptions,
} from './babylon/index.js';
export { bindBabylonInput } from './babylon/index.js';
