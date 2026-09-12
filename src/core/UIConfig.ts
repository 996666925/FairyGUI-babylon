import { Color } from './utils/Color.js';
import { ScrollBarDisplayType } from './FieldTypes.js';

export class UIConfig {
    /** Font used when an object asks for none. */
    public static defaultFont = 'Arial';

    /** Resource shown by `Window.showModalWait` while blocking a window. */
    public static windowModalWaiting: string | null = null;
    /** Resource shown by `GRoot.showModalWait` while blocking the screen. */
    public static globalModalWait: string | null = null;

    /** Scrim painted behind a modal window. */
    public static modalLayerColor: Color = new Color(0x33, 0x33, 0x33, 0x33);

    public static buttonSound: string | null = null;
    public static buttonSoundVolumeScale = 1;

    public static horizontalScrollBar: string | null = null;
    public static verticalScrollBar: string | null = null;

    /** Pixels moved per scroll wheel notch. */
    public static defaultScrollStep = 25;
    /** Per-frame velocity retention while dragging a scroll pane. */
    public static defaultScrollDecelerationRate = 0.967;
    public static defaultScrollBarDisplay: ScrollBarDisplayType = ScrollBarDisplayType.Visible;
    /** Whether content can be dragged directly. True suits touch; false suits desktop. */
    public static defaultScrollTouchEffect = true;
    /** Whether a scroll pane rebounds past its ends. */
    public static defaultScrollBounceEffect = true;

    public static popupMenu: string | null = null;
    public static popupMenu_seperator: string | null = null;
    /** Shown by `GLoader` when its content fails to load. */
    public static loaderErrorSign: string | null = null;
    public static tooltipsWin: string | null = null;

    /** Items a `GComboBox` shows before it starts scrolling. */
    public static defaultComboBoxVisibleItemCount = 10;

    /** Finger travel, in pixels, that starts a scroll. */
    public static touchScrollSensitivity = 20;
    /** Finger travel, in pixels, that starts a drag. */
    public static touchDragSensitivity = 10;
    /** Pointer travel, in pixels, that starts a drag. */
    public static clickDragSensitivity = 2;

    /** Whether clicking a window raises it above its siblings. */
    public static bringWindowToFrontOnClick = true;

    /** Milliseconds of object construction to allow per frame when building async. */
    public static frameTimeForAsyncUIConstruction = 2;

    public static linkUnderline = true;

    /** Name of the Babylon rendering group UI meshes are put in. */
    public static defaultUIGroup = 'UI';
}

const _fontRegistry: Record<string, unknown> = {};

/**
 * Makes a font available under a name, so a text field can ask for it by that
 * name rather than by the `ui://` URL of the item it came from.
 *
 * The value is expected to be a `BitmapFont`. Fonts published inside a package
 * do not come through here — a field naming one resolves it against the item,
 * which is what keeps the registry from outliving the package that filled it.
 * Anything else the registry holds is ignored rather than rejected, so a
 * backend is free to keep its own kind of font here.
 */
export function registerFont(name: string, font: unknown): void {
    _fontRegistry[name] = font;
}

export function getFontByName(name: string): unknown {
    return _fontRegistry[name];
}
