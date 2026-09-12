import { describe, expect, test } from '@rstest/core';
import { readFixture } from './helpers/fixtures.js';
import { MockImageObject, MockRenderer } from './helpers/mockRender.js';
import { setRenderFactory, type IRenderObject } from '../src/core/render/IRenderObject.js';
import { UIPackage } from '../src/core/UIPackage.js';
import { setObjectFactory } from '../src/core/ObjectFactory.js';
import { setScrollPaneClass, setTransitionClass } from '../src/core/Builtins.js';
import { ScrollPane } from '../src/core/ScrollPane.js';
import { Transition } from '../src/core/Transition.js';
import {
    ButtonMode,
    ListLayoutType,
    ListSelectionMode,
    ObjectPropID,
    ObjectType,
    ProgressTitleType,
} from '../src/core/FieldTypes.js';
import { Event, EventType } from '../src/core/event/Event.js';
import { Color } from '../src/core/utils/Color.js';
import { Point } from '../src/core/utils/Geometry.js';
import { scheduler } from '../src/core/Scheduler.js';
import { TweenManager } from '../src/core/tween/TweenManager.js';
import { Controller } from '../src/core/Controller.js';
import { GRoot } from '../src/core/GRoot.js';

// The entry point (`src/index.ts`) cannot be imported here: it pulls in modules
// other agents have not published yet (the Babylon backend, `Window`, …). The
// wiring it performs is reproduced below from the parts that exist.
import '../src/core/gears/index.js';
import '../src/core/action/index.js';
import { GObject } from '../src/core/GObject.js';
import { GComponent } from '../src/core/GComponent.js';
import { GButton } from '../src/core/GButton.js';
import { GLabel } from '../src/core/GLabel.js';
import { GImage } from '../src/core/GImage.js';
import { GGraph } from '../src/core/GGraph.js';
import { GGroup } from '../src/core/GGroup.js';
import { GList } from '../src/core/GList.js';
import { GTree } from '../src/core/GTree.js';
import { GTreeNode } from '../src/core/GTreeNode.js';
import { GObjectPool } from '../src/core/GObjectPool.js';
import { GLoader } from '../src/core/GLoader.js';
import { GMovieClip } from '../src/core/GMovieClip.js';
import { GProgressBar } from '../src/core/GProgressBar.js';
import { GSlider } from '../src/core/GSlider.js';
import { GScrollBar } from '../src/core/GScrollBar.js';
import { GComboBox } from '../src/core/GComboBox.js';
import { GTextField } from '../src/core/GTextField.js';
import { GTextInput } from '../src/core/GTextInput.js';
import { GRichTextField } from '../src/core/GRichTextField.js';

const renderer = new MockRenderer();
setRenderFactory(renderer);
setScrollPaneClass(ScrollPane);
setTransitionClass(Transition);

/** The object table `UIObjectFactory` installs, minus the widget not yet published. */
function buildByType(type: number): GObject | null {
    switch (type) {
        case ObjectType.Image: return new GImage();
        case ObjectType.MovieClip: return new GMovieClip();
        case ObjectType.Component: return new GComponent();
        case ObjectType.Text: return new GTextField();
        case ObjectType.RichText: return new GRichTextField();
        case ObjectType.InputText: return new GTextInput();
        case ObjectType.Group: return new GGroup();
        case ObjectType.List: return new GList();
        case ObjectType.Graph: return new GGraph();
        case ObjectType.Loader: return new GLoader();
        case ObjectType.Button: return new GButton();
        case ObjectType.Label: return new GLabel();
        case ObjectType.ProgressBar: return new GProgressBar();
        case ObjectType.Slider: return new GSlider();
        case ObjectType.ScrollBar: return new GScrollBar();
        case ObjectType.ComboBox: return new GComboBox();
        case ObjectType.Tree: return new GTree();
        default: return null;
    }
}
setObjectFactory(buildByType);

function parse(name: string): UIPackage {
    return UIPackage.parse(readFixture(`${name}.fui`), `ui/${name}`);
}

function build(pkgName: string, itemName: string): GObject {
    const obj = parse(pkgName).createObject(itemName);
    if (!obj)
        throw new Error(`could not build ${pkgName}/${itemName}`);
    return obj;
}

/**
 * A widget taken from a demo page.
 *
 * The pages matter: `setup_afterAdd` — which decodes the editor's per-widget
 * block — only runs for a child during its parent's construction, so a widget
 * built standalone would be missing everything the editor authored.
 */
function pageWidget<T extends GObject>(page: string, name: string, cls: new () => T): T {
    const com = build('Basics', page) as GComponent;
    const child = com.getChild(name);
    expect(child, `${page}/${name}`).toBeInstanceOf(cls);
    return child as T;
}

/**
 * Runs a list's layout synchronously.
 *
 * `setBoundsChangedFlag` marks it dirty (even when a scheduled refresh already
 * cleared the flag) and `ensureBoundsCorrect` then applies it without waiting
 * for a scheduler tick.
 */
function layoutNow(list: GList): void {
    list.setBoundsChangedFlag();
    list.ensureBoundsCorrect();
}

function positions(list: GList): string {
    const out: string[] = [];
    for (let i = 0; i < list.numItems; i++) {
        const c = list.getChildAt(i);
        out.push(`${c.x},${c.y}`);
    }
    return out.join(' ');
}

function point(p: { x: number; y: number }): [number, number] {
    return [p.x, p.y];
}

// ---------------------------------------------------------------------------
// GObjectPool
// ---------------------------------------------------------------------------

describe('GObjectPool', () => {
    const ITEM_URL = 'ui://ListEffect/mailItem';

    test('creates on demand and counts only what it holds', () => {
        parse('ListEffect');
        const pool = new GObjectPool();
        expect(pool.count).toBe(0);

        const fresh = pool.getObject(ITEM_URL);
        expect(fresh).toBeInstanceOf(GButton);
        expect(pool.count, 'a freshly built object is not pooled').toBe(0);
    });

    test('hands back the same instance once one is returned', () => {
        parse('ListEffect');
        const pool = new GObjectPool();

        const first = pool.getObject(ITEM_URL)!;
        pool.returnObject(first);
        expect(pool.count).toBe(1);

        const second = pool.getObject(ITEM_URL);
        expect(second).toBe(first);
        expect(pool.count, 'taking it back empties the slot').toBe(0);

        expect(pool.getObject(ITEM_URL)).not.toBe(first);
    });

    test('matches pooled objects by normalised URL', () => {
        parse('ListEffect');
        const pool = new GObjectPool();
        const obj = pool.getObject('ui://ListEffect/mailItem')!;
        pool.returnObject(obj);

        expect(pool.getObject(ITEM_URL)).toBe(obj);
    });

    test('ignores a URL it cannot resolve, and objects with no resource', () => {
        parse('ListEffect');
        const pool = new GObjectPool();

        pool.returnObject(new GButton());
        expect(pool.count).toBe(0);

        expect(pool.getObject('not-a-url')).toBeNull();
    });

    test('clear disposes everything held', () => {
        parse('ListEffect');
        const pool = new GObjectPool();
        const a = pool.getObject(ITEM_URL)!;
        const b = pool.getObject(ITEM_URL)!;
        pool.returnObject(a);
        pool.returnObject(b);
        expect(pool.count).toBe(2);

        pool.clear();
        expect(pool.count).toBe(0);
        expect(a.disposed).toBe(true);
        expect(b.disposed).toBe(true);
    });

    test('a list recycles its own items through its pool', () => {
        const list = (build('ListEffect', 'Main') as GComponent).getChild('mailList') as GList;
        expect(list.itemPool).toBeInstanceOf(GObjectPool);

        list.numItems = 3;
        const ids = [list.getChildAt(0).id, list.getChildAt(1).id, list.getChildAt(2).id];
        expect(list.itemPool.count).toBe(0);

        list.numItems = 0;
        expect(list.numItems).toBe(0);
        expect(list.itemPool.count, 'the three items went back on the pile').toBe(3);

        list.numItems = 3;
        expect([list.getChildAt(0).id, list.getChildAt(1).id, list.getChildAt(2).id],
            'the same renderers came back').toEqual(ids);
        expect(list.itemPool.count).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// GList: non-virtual behaviour
// ---------------------------------------------------------------------------

describe('GList', () => {
    /** A SingleColumn list with no authored items and a recyclable default item. */
    function mailList(): GList {
        return (build('ListEffect', 'Main') as GComponent).getChild('mailList') as GList;
    }

    test('numItems adds and removes renderers from the pool', () => {
        const list = mailList();
        expect(list.numItems).toBe(0);
        expect(list.defaultItem, 'the editor stored a default item').toBe('ui://jou4kj6pgsia7');

        list.numItems = 4;
        expect(list.numItems).toBe(4);
        expect(list.numChildren).toBe(4);
        for (let i = 0; i < 4; i++)
            expect(list.getChildAt(i), `item ${i}`).toBeInstanceOf(GButton);

        list.numItems = 2;
        expect(list.numItems).toBe(2);
        expect(list.itemPool.count).toBe(2);
    });

    test('numItems drives itemRenderer for every item', () => {
        const list = mailList();
        const seen: Array<[number, string]> = [];
        list.itemRenderer = (index, item) => {
            seen.push([index, item.id]);
        };

        list.numItems = 3;
        expect(seen.map((s) => s[0])).toEqual([0, 1, 2]);
        expect(new Set(seen.map((s) => s[1])).size, 'each renderer is distinct').toBe(3);
    });

    test('addItemFromPool / removeChildToPool recycle one item at a time', () => {
        const list = mailList();

        const a = list.addItemFromPool();
        const b = list.addItemFromPool();
        expect(list.numItems).toBe(2);
        expect(a).not.toBe(b);

        a.visible = false;
        list.removeChildToPool(a);
        expect(list.numItems).toBe(1);
        expect(list.itemPool.count).toBe(1);

        const again = list.addItemFromPool();
        expect(again, 'the returned renderer is handed straight back').toBe(a);
        expect(again.visible, 'getFromPool makes it visible again').toBe(true);

        list.removeChildrenToPool();
        expect(list.numItems).toBe(0);
        expect(list.itemPool.count).toBe(2);
    });

    test('items are recycled through the pool, not rebuilt', () => {
        const list = mailList();
        const before = renderer.objects.length;

        list.numItems = 3;
        expect(renderer.objects.length - before, 'three renderers were built').toBeGreaterThanOrEqual(3);

        list.numItems = 0;
        const afterRemove = renderer.objects.length;
        list.numItems = 3;
        expect(renderer.objects.length - afterRemove, 'nothing new was built on refill').toBe(0);
    });

    test('a removed item stops reporting clicks to the list', () => {
        const list = mailList();
        list.numItems = 2;

        let clicks = 0;
        list.on(EventType.CLICK_ITEM, () => clicks++);

        const item = list.getChildAt(1);
        list.removeChildToPool(item);
        item.dispatchEvent(new Event(EventType.CLICK));
        expect(clicks, 'the recycled item is no longer wired to the list').toBe(0);

        list.getChildAt(0).dispatchEvent(new Event(EventType.CLICK, true));
        expect(clicks).toBe(1);
    });

    test('selectionMode Single keeps one item selected', () => {
        const list = mailList();
        list.numItems = 4;
        expect(list.selectionMode).toBe(ListSelectionMode.Single);

        list.selectedIndex = 2;
        expect(list.selectedIndex).toBe(2);
        expect(list.getSelection()).toEqual([2]);

        list.selectedIndex = 0;
        expect(list.selectedIndex).toBe(0);
        expect(list.getSelection()).toEqual([0]);

        list.selectedIndex = -1;
        expect(list.selectedIndex, 'an out-of-range index clears the selection').toBe(-1);
        expect(list.getSelection()).toEqual([]);

        list.selectedIndex = 99;
        expect(list.selectedIndex).toBe(-1);
    });

    test('selectionMode Multiple accumulates and removes selections', () => {
        const list = mailList();
        list.numItems = 4;
        list.selectionMode = ListSelectionMode.Multiple;

        list.addSelection(0);
        list.addSelection(2);
        list.addSelection(3);
        expect(list.getSelection()).toEqual([0, 2, 3]);

        list.removeSelection(2);
        expect(list.getSelection()).toEqual([0, 3]);

        list.selectReverse();
        expect(list.getSelection()).toEqual([1, 2]);

        list.selectAll();
        expect(list.getSelection()).toEqual([0, 1, 2, 3]);

        list.selectNone();
        expect(list.getSelection()).toEqual([]);
    });

    test('setting selectedIndex in Multiple mode replaces the selection', () => {
        const list = mailList();
        list.numItems = 4;
        list.selectionMode = ListSelectionMode.Multiple;
        list.addSelection(0);
        list.addSelection(1);

        list.selectedIndex = 3;
        expect(list.getSelection()).toEqual([3]);
    });

    test('selectionMode None refuses to select at all', () => {
        const list = mailList();
        list.numItems = 3;
        list.selectionMode = ListSelectionMode.None;

        list.addSelection(1);
        expect(list.selectedIndex).toBe(-1);
        expect(list.getSelection()).toEqual([]);
    });

    test('a click selects the item it landed on', () => {
        const list = mailList();
        list.numItems = 4;
        const clicked: GObject[] = [];
        list.on(EventType.CLICK_ITEM, (item: GObject) => clicked.push(item));

        list.getChildAt(2).dispatchEvent(new Event(EventType.CLICK, true));
        expect(list.selectedIndex).toBe(2);
        expect(clicked).toEqual([list.getChildAt(2)]);
    });

    test('scrollToView clamps to the content box', () => {
        const demos = build('Basics', 'Demo_List') as GComponent;
        const list = demos.getChild('n0') as GList;
        layoutNow(list);

        const pane = list.scrollPane!;
        const maxScroll = pane.contentHeight - pane.viewHeight;
        expect(maxScroll, 'the list overflows its view').toBeGreaterThan(0);

        list.scrollToView(5);
        expect(pane.posY).toBe(maxScroll);

        list.scrollToView(0, false, true);
        expect(pane.posY).toBe(0);

        list.scrollToView(0);
        expect(pane.posY).toBe(0);

        // Out-of-range requests must not throw, and must not move anything.
        list.scrollToView(99);
        expect(pane.posY).toBe(0);
        list.scrollToView(-1);
        expect(pane.posY).toBe(0);

        list.scrollToView(5, false, true);
        expect(pane.posY).toBe(maxScroll);
        expect(pane.posY).toBeLessThanOrEqual(maxScroll);
    });

    test('getSnappingPosition snaps to the nearest item edge', () => {
        const demos = build('Basics', 'Demo_List') as GComponent;
        const list = demos.getChild('n0') as GList;
        layoutNow(list);

        // Items are 100 tall with a 6px gap: 0, 106, 212, …
        expect(point(list.getSnappingPosition(0, 40))).toEqual([0, 0]);
        expect(point(list.getSnappingPosition(0, 80))).toEqual([0, 106]);
        expect(point(list.getSnappingPosition(0, 130))).toEqual([0, 106]);
        expect(point(list.getSnappingPosition(0, 170))).toEqual([0, 212]);
    });

    test('getFirstChildInView reports the first visible index', () => {
        const list = mailList();
        list.numItems = 3;
        layoutNow(list);
        expect(list.getFirstChildInView()).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// GList: layouts
// ---------------------------------------------------------------------------

describe('GList layouts', () => {
    function demoList(childName: string): GList {
        return (build('Basics', 'Demo_List') as GComponent).getChild(childName) as GList;
    }

    test('every layout the editor can publish is decoded', () => {
        expect(demoList('n0').layout).toBe(ListLayoutType.SingleColumn);
        expect(demoList('n4').layout).toBe(ListLayoutType.SingleRow);
        expect(demoList('n7').layout).toBe(ListLayoutType.FlowHorizontal);
        expect(demoList('n9').layout).toBe(ListLayoutType.FlowVertical);
    });

    test('SingleColumn stacks items and stretches them to the view width', () => {
        const list = demoList('n0');
        layoutNow(list);

        expect(list.lineGap).toBe(6);
        expect(list.getChildAt(0).width, 'autoResizeItem fills the view').toBe(list.viewWidth);
        expect(positions(list)).toBe('0,0 0,106 0,212 0,318 0,424 0,530');
    });

    test('SingleRow lines items up and stretches them to the view height', () => {
        const list = demoList('n4');
        layoutNow(list);

        expect(list.columnGap).toBe(6);
        expect(list.getChildAt(0).height, 'autoResizeItem fills the view').toBe(list.viewHeight);
        expect(positions(list)).toBe('0,0 106,0 212,0 318,0 424,0 530,0');
    });

    test('FlowHorizontal wraps into rows', () => {
        const list = demoList('n7');
        layoutNow(list);

        expect(list.autoResizeItem, 'published without auto-resize').toBe(false);
        // A 434px view, 100px items and 6px gaps: four fit per row.
        expect(positions(list)).toBe('0,0 106,0 212,0 318,0 0,106 106,106');
        expect(list.getChildAt(0).width, 'items keep their authored size').toBe(100);
    });

    test('FlowHorizontal honours columnCount', () => {
        const list = demoList('n7');
        list.columnCount = 2;
        layoutNow(list);

        expect(positions(list)).toBe('0,0 106,0 0,106 106,106 0,212 106,212');
    });

    test('FlowVertical wraps into columns', () => {
        const list = demoList('n9');
        layoutNow(list);

        // A 447px view, 100px items and 6px gaps: four fit per column.
        expect(positions(list)).toBe('0,0 0,106 0,212 0,318 106,0 106,106');
    });

    test('FlowVertical honours lineCount', () => {
        const list = demoList('n9');
        list.lineCount = 2;
        layoutNow(list);

        expect(positions(list)).toBe('0,0 0,106 106,0 106,106 212,0 212,106');
    });

    test('Pagination lays out whole pages side by side', () => {
        const list = demoList('n7');
        list.layout = ListLayoutType.Pagination;
        layoutNow(list);

        // One row of four per page, so a page is as wide as the view.
        const vw = list.viewWidth;
        expect(positions(list)).toBe(`0,0 106,0 212,0 318,0 ${vw},0 ${vw + 106},0`);

        const pane = list.scrollPane!;
        expect(pane.contentWidth, 'two pages of content').toBe(vw * 2);
    });

    test('an item resized by autoResizeItem keeps its own height', () => {
        const list = demoList('n0');
        layoutNow(list);
        for (let i = 0; i < list.numItems; i++)
            expect(list.getChildAt(i).height, `item ${i}`).toBe(100);
    });

    test('a layout change is applied on the next layout pass', () => {
        const list = (build('ListEffect', 'Main') as GComponent).getChild('mailList') as GList;
        list.numItems = 3;
        layoutNow(list);
        expect(list.getChildAt(1).y, 'SingleColumn stacks').toBe(125);
        expect(list.getChildAt(1).x).toBe(0);

        list.layout = ListLayoutType.SingleRow;
        layoutNow(list);
        expect(list.getChildAt(0).y).toBe(0);
        expect(list.getChildAt(1).x, 'SingleRow lists across').toBe(380);
        expect(list.getChildAt(1).y).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// GList: virtual
// ---------------------------------------------------------------------------

describe('GList virtual lists', () => {
    function virtualList(): GList {
        return (build('VirtualList', 'Main') as GComponent).getChild('mailList') as GList;
    }

    test('setVirtual needs a scroll pane and derives the item size', () => {
        const list = virtualList();
        expect(list.scrollPane, 'the editor published it scrollable').not.toBeNull();
        expect(list.virtualItemSize).toBeNull();

        list.setVirtual();
        expect((list as unknown as { _virtual: boolean })._virtual).toBe(true);
        expect(list.virtualItemSize, 'taken from the default item').not.toBeNull();
        expect(list.virtualItemSize!.width).toBeGreaterThan(0);
        expect(list.virtualItemSize!.height).toBeGreaterThan(0);
    });

    test('numItems requires an itemRenderer', () => {
        const list = virtualList();
        list.setVirtual();
        expect(() => {
            list.numItems = 10;
        }).toThrow(/itemRenderer/);

        list.itemRenderer = () => {};
        list.numItems = 10;
        expect(list.numItems).toBe(10);
    });

    test('only the visible items are built', () => {
        const list = virtualList();
        list.setVirtual();
        list.itemRenderer = () => {};
        list.numItems = 40;

        const itemH = list.virtualItemSize!.height;
        expect(list.numItems, 'the list reports every item').toBe(40);
        expect(list.numChildren, 'but only materialises what fits').toBeLessThan(40);
        expect(list.numChildren).toBeGreaterThan(0);
        expect(list.itemPool.count).toBe(0);
        expect(list.scrollPane!.contentHeight).toBe(40 * itemH);
    });

    test('itemRenderer sees the item index, not the slot index', () => {
        const list = virtualList();
        list.setVirtual();
        const rendered: number[] = [];
        list.itemRenderer = (index) => {
            rendered.push(index);
        };
        list.numItems = 40;

        expect(rendered.length).toBeGreaterThan(0);
        for (let i = 1; i < rendered.length; i++)
            expect(rendered[i]).toBe(rendered[i - 1] + 1);
    });

    test('scrolling moves the window and recycles renderers', () => {
        const list = virtualList();
        list.setVirtual();
        list.itemRenderer = () => {};
        list.numItems = 40;

        const pane = list.scrollPane!;
        const itemH = list.virtualItemSize!.height;
        const materialised = list.numChildren;
        const builtSoFar = renderer.objects.length;

        pane.setPosY(itemH * 10);
        scheduler.update(0);

        const firstIndex = (list as unknown as { _firstIndex: number })._firstIndex;
        expect(firstIndex, 'the window moved down the list').toBeGreaterThan(0);
        expect(list.numChildren, 'the window keeps about its size').toBeLessThanOrEqual(materialised + 1);
        expect(renderer.objects.length - builtSoFar, 'renderers were recycled, not rebuilt')
            .toBeLessThanOrEqual(1);
        expect(pane.posY).toBeLessThanOrEqual(pane.contentHeight - pane.viewHeight);
    });

    test('item and child indices translate through the window', () => {
        const list = virtualList();
        list.setVirtual();
        list.itemRenderer = () => {};
        list.numItems = 40;

        expect(list.childIndexToItemIndex(0)).toBe(0);
        expect(list.itemIndexToChildIndex(0)).toBe(0);

        const itemH = list.virtualItemSize!.height;
        list.scrollPane!.setPosY(itemH * 10);
        scheduler.update(0);

        const first = (list as unknown as { _firstIndex: number })._firstIndex;
        expect(list.childIndexToItemIndex(0)).toBe(first);
        expect(list.itemIndexToChildIndex(first)).toBe(0);
        expect(list.getFirstChildInView()).toBe(first);
    });

    test('selection survives on items that are not materialised', () => {
        const list = virtualList();
        list.setVirtual();
        list.itemRenderer = () => {};
        list.numItems = 40;

        // Index 30 is far below the window and has no renderer.
        list.addSelection(30);
        expect(list.selectedIndex).toBe(30);
        expect(list.getSelection()).toEqual([30]);

        list.clearSelection();
        expect(list.selectedIndex).toBe(-1);
    });

    test('scrollToView reveals an item below the window', () => {
        const list = virtualList();
        list.setVirtual();
        list.itemRenderer = () => {};
        list.numItems = 40;

        const pane = list.scrollPane!;
        const itemH = list.virtualItemSize!.height;

        list.scrollToView(20, false, true);
        expect(pane.posY).toBe(20 * itemH);

        expect(() => list.scrollToView(39)).not.toThrow();
        expect(pane.posY).toBeLessThanOrEqual(pane.contentHeight - pane.viewHeight);
    });

    test('virtualItemSize feeds resizeToFit', () => {
        const list = virtualList();
        list.setVirtual();
        list.itemRenderer = () => {};
        list.virtualItemSize = { width: 200, height: 50 };
        // `ItemSize` is width/height, unlike the x/y that `point` reads.
        expect([list.virtualItemSize!.width, list.virtualItemSize!.height]).toEqual([200, 50]);

        scheduler.update(0);
        list.numItems = 10;
        list.resizeToFit(4, 0);
        expect(list.viewHeight, 'four lines of 50px').toBe(200);
    });

    test('setVirtualAndLoop repeats the content six times over', () => {
        const list = (build('LoopList', 'Main') as GComponent).getChild('list') as GList;
        list.setVirtualAndLoop();
        list.itemRenderer = () => {};
        list.numItems = 5;

        const priv = list as unknown as { _loop: boolean; _realNumItems: number };
        expect(priv._loop).toBe(true);
        expect(priv._realNumItems, 'six copies make the wrap seamless').toBe(30);
        expect(list.scrollPane!.bouncebackEffect).toBe(false);
        expect(list.scrollPane!._loop, 'a SingleRow loop scrolls along its row').toBe(1);

        // A real index maps back into the logical range.
        list.addSelection(7);
        expect(list.selectedIndex).toBe(2);
    });

    test('a loop list refuses FlowHorizontal', () => {
        const list = (build('Basics', 'Demo_List') as GComponent).getChild('n7') as GList;
        expect(() => list.setVirtualAndLoop()).toThrow(/Loop list/);
    });

    test('setVirtual refuses a list with nothing to scroll', () => {
        const list = new GList();
        expect(() => list.setVirtual()).toThrow(/scrollable/);
    });
});

// ---------------------------------------------------------------------------
// GButton
// ---------------------------------------------------------------------------

describe('GButton', () => {
    test('a Check button toggles and reports STATUS_CHANGED', () => {
        const cb = pageWidget('Demo_Button', 'n4', GButton);
        expect(cb.mode).toBe(ButtonMode.Check);
        expect(cb.selected).toBe(false);

        const ctrl = cb.getController('button')!;
        expect(ctrl.selectedPage).toBe('up');

        let changes = 0;
        cb.on(EventType.STATUS_CHANGED, () => changes++);

        cb.emit(EventType.CLICK, new Event(EventType.CLICK));
        expect(cb.selected).toBe(true);
        expect(ctrl.selectedPage, 'selected shows the down page').toBe('down');
        expect(changes).toBe(1);

        cb.emit(EventType.CLICK, new Event(EventType.CLICK));
        expect(cb.selected).toBe(false);
        expect(ctrl.selectedPage).toBe('up');
        expect(changes).toBe(2);
    });

    test('changeStateOnClick false stops a Check button reacting', () => {
        const cb = pageWidget('Demo_Button', 'n4', GButton);
        cb.changeStateOnClick = false;
        cb.emit(EventType.CLICK, new Event(EventType.CLICK));
        expect(cb.selected).toBe(false);
    });

    test('a Radio button selects but never deselects itself', () => {
        const rb = pageWidget('Demo_Button', 'n5', GButton);
        expect(rb.mode).toBe(ButtonMode.Radio);

        let changes = 0;
        rb.on(EventType.STATUS_CHANGED, () => changes++);

        rb.emit(EventType.CLICK, new Event(EventType.CLICK));
        expect(rb.selected).toBe(true);
        expect(changes).toBe(1);

        rb.emit(EventType.CLICK, new Event(EventType.CLICK));
        expect(rb.selected, 'already selected: a click is a no-op').toBe(true);
        expect(changes).toBe(1);
    });

    test('title and selectedTitle follow the selected state', () => {
        const onOff = pageWidget('Demo_Button', 'n16', GButton);
        const tf = onOff.getTextField()!;
        expect(onOff.title).toBe('On');
        expect(onOff.selectedTitle).toBe('Off');
        expect(tf.text).toBe('On');

        onOff.selected = true;
        expect(tf.text, 'the selected title takes over').toBe('Off');

        onOff.selected = false;
        expect(tf.text).toBe('On');

        onOff.selected = true;
        onOff.title = 'Renamed';
        expect(tf.text, 'the selected title still wins').toBe('Off');
        expect(onOff.title).toBe('Renamed');

        onOff.selectedTitle = null;
        onOff.title = 'Renamed';
        expect(tf.text).toBe('Renamed');
    });

    test('icon and selectedIcon follow the selected state', () => {
        const btn = pageWidget('Demo_Button', 'n6', GButton);
        expect(btn.mode).toBe(ButtonMode.Common);
        const plain = btn.icon;
        expect(plain, 'the editor stored an icon').toBeTruthy();

        btn.selectedIcon = 'ui://Basics/icon';
        btn.selected = true; // no-op while the mode is Common
        expect(btn.selected).toBe(false);

        // `icon` is the *base* value and round-trips what was assigned; the
        // icon that actually shows is what follows the selected state. They are
        // deliberately separate: were the getter to return the effective icon,
        // `btn.icon = btn.icon` would write the override back over the base.
        const iconObject = btn.getChild('icon')!;

        btn.mode = ButtonMode.Check;
        btn.selected = true;
        expect(iconObject.icon).toBe('ui://Basics/icon');
        expect(btn.icon).toBe(plain);

        btn.selected = false;
        expect(iconObject.icon).toBe(plain);
        expect(btn.icon).toBe(plain);
        expect(btn.selectedIcon).toBe('ui://Basics/icon');
    });

    test('a Common button ignores `selected`', () => {
        const btn = pageWidget('Demo_Button', 'n3', GButton);
        expect(btn.mode).toBe(ButtonMode.Common);
        btn.selected = true;
        expect(btn.selected).toBe(false);
    });

    test('setting Common mode clears an existing selection', () => {
        const cb = pageWidget('Demo_Button', 'n4', GButton);
        cb.selected = true;
        cb.mode = ButtonMode.Common;
        expect(cb.selected).toBe(false);
    });

    test('grayed drives the disabled pages', () => {
        const btn = pageWidget('Demo_Button', 'n38', GButton);
        const ctrl = btn.getController('button')!;
        expect(ctrl.hasPage('disabled')).toBe(true);
        expect(ctrl.hasPage('selectedDisabled')).toBe(true);

        btn.enabled = false;
        expect(btn.grayed).toBe(true);
        expect(ctrl.selectedPage, 'a selected disabled button uses its own page').toBe('selectedDisabled');

        btn.selected = false;
        expect(ctrl.selectedPage).toBe('disabled');

        btn.enabled = true;
        expect(ctrl.selectedPage).toBe('up');
    });

    test('getProp / setProp expose the title slots a gear drives', () => {
        const btn = pageWidget('Demo_Button', 'n3', GButton);
        const tf = btn.getTextField()!;

        btn.setProp(ObjectPropID.FontSize, 30);
        expect(tf.fontSize).toBe(30);
        expect(btn.getProp(ObjectPropID.FontSize)).toBe(30);

        btn.setProp(ObjectPropID.Color, '#123456');
        expect(tf.color.r).toBe(0x12);
        expect(tf.color.g).toBe(0x34);
        expect(tf.color.b).toBe(0x56);

        btn.setProp(ObjectPropID.OutlineColor, new Color(1, 2, 3, 255));
        expect(tf.strokeColor!.r).toBe(1);

        btn.mode = ButtonMode.Check;
        btn.setProp(ObjectPropID.Selected, true);
        expect(btn.selected).toBe(true);
        expect(btn.getProp(ObjectPropID.Selected)).toBe(true);

        btn.setProp(ObjectPropID.Text, 'typed');
        expect(tf.text).toBe('typed');
    });

    test('relatedController keeps a radio group in step', () => {
        const demo = build('Basics', 'Demo_Button') as GComponent;
        const first = demo.getChild('n18') as GButton;
        const second = demo.getChild('n19') as GButton;
        const third = demo.getChild('n20') as GButton;

        const ctrl = first.relatedController!;
        expect(ctrl).not.toBeNull();
        expect(second.relatedController).toBe(ctrl);
        expect(third.relatedController).toBe(ctrl);

        expect(first.selected).toBe(true);
        expect(second.selected).toBe(false);
        expect(third.selected).toBe(false);

        second.selected = true;
        expect(ctrl.selectedPageId, 'selecting drives the shared controller').toBe(second.relatedPageId);
        expect(second.selected).toBe(true);
        expect(first.selected, 'the previous holder was deselected').toBe(false);
        expect(third.selected).toBe(false);

        third.selected = true;
        expect(second.selected).toBe(false);
        expect(third.selected).toBe(true);
    });

    test('deselecting bounces a Check button but leaves a Radio alone', () => {
        const demo = build('Basics', 'Demo_Button') as GComponent;
        const first = demo.getChild('n18') as GButton;
        const ctrl = first.relatedController!;

        // A radio's page stands for the whole group, so one member cannot
        // retract it: deselecting programmatically leaves the controller where
        // it is, and some other radio stays selected.
        expect(first.mode).toBe(ButtonMode.Radio);
        expect(first.selected).toBe(true);
        first.selected = false;
        expect(ctrl.selectedPageId).toBe(first.relatedPageId);
        expect(first.getController('button')!.selectedPage).toBe('up');

        // A check button represents only itself, so deselecting has to push the
        // controller off the page the button stood for.
        first.mode = ButtonMode.Check;
        first.selected = true;
        expect(ctrl.selectedPageId).toBe(first.relatedPageId);

        first.selected = false;
        expect(ctrl.selectedPageId).not.toBe(first.relatedPageId);
    });

    test('a controller change drives the button back', () => {
        const demo = build('Basics', 'Demo_Button') as GComponent;
        const first = demo.getChild('n18') as GButton;
        const second = demo.getChild('n19') as GButton;
        const ctrl = first.relatedController!;

        ctrl.selectedPageId = second.relatedPageId;
        expect(second.selected).toBe(true);
        expect(first.selected).toBe(false);
    });

    test('autoRadioGroupDepth lifts the selected radio above its siblings', () => {
        const group = new GComponent();
        group.setSize(200, 100);

        const ctrl = new Controller();
        ctrl.name = 'group';
        ctrl.autoRadioGroupDepth = true;
        group.addController(ctrl);
        ctrl.addPage('a');
        ctrl.addPage('b');

        const r1 = new GButton();
        r1.mode = ButtonMode.Radio;
        const r2 = new GButton();
        r2.mode = ButtonMode.Radio;
        group.addChild(r1);
        group.addChild(r2);
        r1.relatedController = ctrl;
        r1.relatedPageId = ctrl.getPageId(0);
        r2.relatedController = ctrl;
        r2.relatedPageId = ctrl.getPageId(1);

        expect(group.getChildIndex(r1)).toBe(0);

        r1.selected = true;
        expect(ctrl.selectedIndex).toBe(0);
        expect(r1.selected).toBe(true);
        expect(r2.selected, 'the sibling gave way').toBe(false);
        expect(group.getChildIndex(r1), 'the selected radio was lifted above its sibling').toBe(1);

        r2.selected = true;
        expect(ctrl.selectedIndex).toBe(1);
        expect(r1.selected).toBe(false);
        expect(r2.selected).toBe(true);
        expect(group.getChildIndex(r2)).toBeGreaterThan(group.getChildIndex(r1));
    });

    test('a button with no controller still tracks its own state', () => {
        const rb = new GButton();
        rb.mode = ButtonMode.Radio;
        expect(rb.getController('button')).toBeNull();

        rb.selected = true;
        expect(rb.selected).toBe(true);
        expect(rb.getTextField(), 'no title child').toBeNull();
    });
});

// ---------------------------------------------------------------------------
// GLabel
// ---------------------------------------------------------------------------

describe('GLabel', () => {
    test('title, text and icon reach the child objects by name', () => {
        const label = pageWidget('Demo_Label', 'n4', GLabel);
        expect(label.getChild('title')).toBeInstanceOf(GTextField);
        expect(label.getChild('icon')).not.toBeNull();

        const tf = label.getTextField()!;
        expect(label.title).toBe('Hello world');
        expect(label.text).toBe('Hello world');

        label.title = 'Changed';
        expect(tf.text).toBe('Changed');
        expect(label.text).toBe('Changed');

        label.text = 'Again';
        expect(tf.text).toBe('Again');
        expect(label.title).toBe('Again');

        label.icon = 'ui://Basics/icon';
        expect(label.icon).toBe('ui://Basics/icon');
    });

    test('titleColor and titleFontSize write through to the text field', () => {
        const label = pageWidget('Demo_Label', 'n5', GLabel);
        const tf = label.getTextField()!;
        expect(label.titleFontSize).toBe(16);
        expect([label.titleColor.r, label.titleColor.g, label.titleColor.b]).toEqual([255, 204, 51]);

        label.titleFontSize = 22;
        expect(tf.fontSize).toBe(22);

        label.titleColor = new Color(9, 8, 7, 255);
        expect(label.titleColor.r).toBe(9);
        expect(label.titleColor.g).toBe(8);
        expect(label.titleColor.b).toBe(7);
    });

    test('getProp / setProp route the slots a gear drives', () => {
        const label = pageWidget('Demo_Label', 'n4', GLabel);

        label.setProp(ObjectPropID.Text, 'Via prop');
        expect(label.getTextField()!.text).toBe('Via prop');

        label.setProp(ObjectPropID.FontSize, 11);
        expect(label.titleFontSize).toBe(11);
        expect(label.getProp(ObjectPropID.FontSize)).toBe(11);

        label.setProp(ObjectPropID.Color, '#ffffff');
        expect(label.getProp(ObjectPropID.Color)).toBeInstanceOf(Color);
        expect(label.titleColor.r).toBe(255);

        label.setProp(ObjectPropID.Icon, 'ui://Basics/icon');
        expect(label.icon).toBe('ui://Basics/icon');
    });

    test('a label with no icon child ignores icon writes', () => {
        const frame = pageWidget('Demo_Label', 'frame', GLabel);
        expect(frame.getChild('icon')).toBeNull();
        frame.icon = 'ui://Basics/icon';
        expect(frame.icon).toBeNull();
    });

    test('editable follows the title widget', () => {
        const label = pageWidget('Demo_Label', 'n4', GLabel);
        expect(label.getTextField()).toBeInstanceOf(GTextField);
        expect(label.editable, 'a plain text field is not editable').toBe(false);
        label.editable = true;
        expect(label.editable).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// GProgressBar
// ---------------------------------------------------------------------------

describe('GProgressBar', () => {
    test('the editor-decoded value drives the title and the bar', () => {
        const bar = pageWidget('Demo_ProgressBar', 'n2', GProgressBar);
        expect(bar.min).toBe(0);
        expect(bar.max).toBe(100);
        expect(bar.value).toBe(78);
        expect(bar.titleType).toBe(ProgressTitleType.ValueAndMax);
        expect(bar.getChild('title')!.text, 'setup_afterAdd ran update').toBe('78/100');

        // The bar is a plain image, so its width tracks the value.
        const image = bar.getChild('bar')!;
        bar.value = 100;
        const full = image.width;
        expect(full).toBeGreaterThan(0);

        bar.value = 50;
        expect(image.width).toBe(Math.round(full * 0.5));

        bar.value = 0;
        expect(image.width).toBe(0);
    });

    test('a fill-capable bar animates fillAmount instead of size', () => {
        const bar = pageWidget('Demo_ProgressBar', 'n9', GProgressBar);
        const image = bar.getChild('bar') as GImage;
        expect(image.fillMethod, 'a radial fill, not a resizing bar').not.toBe(0);

        const authored = image.width;
        bar.value = 25;
        expect(image.fillAmount).toBeCloseTo(0.25, 5);
        expect(image.width, 'the box is left alone').toBe(authored);
    });

    test('min, max and clamping', () => {
        const bar = pageWidget('Demo_ProgressBar', 'n2', GProgressBar);
        const image = bar.getChild('bar')!;
        const title = bar.getChild('title')!;

        bar.min = 50;
        bar.max = 150;
        bar.value = 150;
        const full = image.width;

        bar.value = 100;
        expect(title.text).toBe('100/150');
        expect(image.width).toBe(Math.round(full * 0.5));

        // Below the minimum clamps to 0%.
        bar.value = 0;
        expect(image.width).toBe(0);

        // Above the maximum clamps to 100%.
        bar.value = 999;
        expect(image.width).toBe(full);
    });

    test('every titleType formats the same value differently', () => {
        const bar = pageWidget('Demo_ProgressBar', 'n2', GProgressBar);
        const title = bar.getChild('title')!;
        bar.value = 25;

        bar.titleType = ProgressTitleType.Percent;
        expect(title.text).toBe('25%');

        bar.titleType = ProgressTitleType.ValueAndMax;
        expect(title.text).toBe('25/100');

        bar.titleType = ProgressTitleType.Value;
        expect(title.text).toBe('25');

        bar.titleType = ProgressTitleType.Max;
        expect(title.text).toBe('100');
    });

    test('a resized bar recomputes its full width', () => {
        const bar = pageWidget('Demo_ProgressBar', 'n2', GProgressBar);
        const image = bar.getChild('bar')!;

        bar.setSize(200, bar.height);
        bar.value = 50;
        const half = image.width;

        bar.setSize(400, bar.height);
        bar.value = 50;
        expect(image.width, 'the full width grew with the component').toBeGreaterThan(half);
    });

    test('tweenValue animates through update()', () => {
        const bar = pageWidget('Demo_ProgressBar', 'n2', GProgressBar);
        const title = bar.getChild('title')!;
        const image = bar.getChild('bar')!;
        bar.value = 0;

        bar.tweenValue(100, 1);
        expect(bar.value, 'the value jumps to its destination immediately').toBe(100);

        TweenManager.update(0.5);
        expect(title.text, 'the display follows the tween').toBe('50/100');
        expect(image.width).toBeGreaterThan(0);

        TweenManager.update(0.5);
        expect(title.text).toBe('100/100');
    });
});

// ---------------------------------------------------------------------------
// GSlider
// ---------------------------------------------------------------------------

describe('GSlider', () => {
    function horizontal(): GSlider {
        return pageWidget('Demo_Slider', 'n3', GSlider);
    }

    /** Drags the grip by `dx` pixels, in the grip's own space. */
    function dragGrip(slider: GSlider, dx: number): void {
        const grip = slider.getChild('grip')!;
        const down = new Event(EventType.TOUCH_BEGIN);
        down.pos.copy(grip.localToGlobal(0, 0));
        grip.emit(EventType.TOUCH_BEGIN, down);

        const move = new Event(EventType.TOUCH_MOVE);
        move.pos.copy(grip.localToGlobal(dx, 0));
        grip.emit(EventType.TOUCH_MOVE, move);
    }

    /** The full width the bar spans at 100%. */
    function fullWidth(slider: GSlider): number {
        const bar = slider.getChild('bar')!;
        const saved = slider.value;
        slider.value = slider.max;
        const full = bar.width;
        slider.value = saved;
        return full;
    }

    test('the editor-decoded value drives the title and the bar', () => {
        const slider = horizontal();
        expect(slider.min).toBe(0);
        expect(slider.max).toBe(100);
        expect(slider.value).toBe(50);
        expect(slider.titleType).toBe(ProgressTitleType.Percent);
        expect(slider.getChild('title')!.text, 'setup_afterAdd ran update').toBe('50%');

        const bar = slider.getChild('bar')!;
        const full = fullWidth(slider);

        slider.value = 25;
        expect(bar.width).toBe(Math.round(full * 0.25));
        expect(slider.getChild('title')!.text).toBe('25%');
    });

    test('titleType formats the value', () => {
        const slider = horizontal();
        const title = slider.getChild('title')!;
        slider.value = 40;

        slider.titleType = ProgressTitleType.ValueAndMax;
        expect(title.text).toBe('40/100');

        slider.titleType = ProgressTitleType.Value;
        expect(title.text).toBe('40');

        slider.titleType = ProgressTitleType.Max;
        expect(title.text).toBe('100');
    });

    test('dragging the grip moves the value', () => {
        const slider = horizontal();
        slider.value = 50;
        const full = fullWidth(slider);

        dragGrip(slider, full * 0.25);
        expect(slider.value, 'a quarter of the track to the right').toBe(75);

        slider.value = 50;
        dragGrip(slider, -full * 0.5);
        expect(slider.value).toBe(0);
    });

    test('wholeNumbers rounds a drag to whole steps', () => {
        const slider = horizontal();
        const bar = slider.getChild('bar')!;
        slider.max = 3;
        slider.value = 3;
        const full = bar.width;

        slider.value = 0;
        slider.wholeNumbers = false;
        dragGrip(slider, full * 0.2);
        expect(slider.value).toBeCloseTo(0.6, 5);

        slider.value = 0;
        slider.wholeNumbers = true;
        dragGrip(slider, full * 0.2);
        expect(slider.value, '0.6 rounded to a whole step').toBe(1);
    });

    test('changeOnClick makes a track click jump the grip', () => {
        const slider = horizontal();
        const grip = slider.getChild('grip')!;
        const full = fullWidth(slider);
        slider.value = 0;
        expect(slider.changeOnClick).toBe(true);

        // A press a quarter of the way along, measured from the grip's centre.
        const click = new Event(EventType.TOUCH_BEGIN);
        click.pos.copy(grip.localToGlobal(grip.width / 2 + full * 0.25, 0));
        slider.emit(EventType.TOUCH_BEGIN, click);
        expect(slider.value).toBe(25);
    });

    test('changeOnClick false ignores a track click', () => {
        const slider = horizontal();
        const grip = slider.getChild('grip')!;
        slider.value = 0;
        slider.changeOnClick = false;

        const click = new Event(EventType.TOUCH_BEGIN);
        click.pos.copy(grip.localToGlobal(grip.width / 2 + 100, 0));
        slider.emit(EventType.TOUCH_BEGIN, click);
        expect(slider.value).toBe(0);
    });

    test('a vertical slider drives its bar_v', () => {
        const slider = (build('Basics', 'Demo_Slider') as GComponent).getChild('n2') as GSlider;
        expect(slider.getChild('bar')).toBeNull();
        const barV = slider.getChild('bar_v')!;

        slider.value = 100;
        const full = barV.height;
        slider.value = 50;
        expect(barV.height).toBe(Math.round(full * 0.5));
    });
});

// ---------------------------------------------------------------------------
// GScrollBar
// ---------------------------------------------------------------------------

describe('GScrollBar', () => {
    /** The pane of a list that really does overflow, so scrolling can be seen. */
    function aPane(): ScrollPane {
        const list = (build('Basics', 'Demo_List') as GComponent).getChild('n0') as GList;
        layoutNow(list);
        const pane = list.scrollPane!;
        pane.posY = 0;
        expect(pane.contentHeight).toBeGreaterThan(pane.viewHeight);
        return pane;
    }

    test('the grip is sized and placed from the display percent', () => {
        const bar = build('Basics', 'ScrollBar_VT') as GScrollBar;
        const grip = bar.getChild('grip')!;
        const track = bar.getChild('bar')!;
        bar.setScrollPane(aPane(), true);

        bar.setDisplayPerc(0.5);
        expect(grip.height).toBe(Math.floor(0.5 * track.height));
        expect(grip.visible, 'a part-visible grip is shown').toBe(true);

        bar.setDisplayPerc(1);
        expect(grip.visible, 'nothing to scroll: the grip hides').toBe(false);

        bar.setDisplayPerc(0);
        expect(grip.visible).toBe(false);

        bar.setDisplayPerc(0.25);
        expect(grip.visible).toBe(true);
    });

    test('a fixed grip keeps its authored height', () => {
        const bar = build('Basics', 'ScrollBar_VT') as GScrollBar;
        const grip = bar.getChild('grip')!;
        const fixed = (bar as unknown as { _fixedGripSize: boolean })._fixedGripSize;
        bar.setScrollPane(aPane(), true);
        const authored = grip.height;

        bar.setDisplayPerc(0.25);
        const quarter = grip.height;
        bar.setDisplayPerc(0.75);

        if (fixed)
            expect(grip.height, 'fixedGripSize ignores the display percent').toBe(authored);
        else
            expect(grip.height).toBeGreaterThan(quarter);
    });

    test('scroll percent moves the grip along the track', () => {
        const bar = build('Basics', 'ScrollBar_VT') as GScrollBar;
        const grip = bar.getChild('grip')!;
        const track = bar.getChild('bar')!;
        bar.setScrollPane(aPane(), true);
        bar.setDisplayPerc(0.5);

        bar.setScrollPerc(0);
        expect(grip.y).toBe(track.y);

        bar.setScrollPerc(1);
        expect(grip.y).toBe(track.y + (track.height - grip.height));

        bar.setScrollPerc(0.5);
        expect(grip.y).toBeCloseTo(track.y + (track.height - grip.height) * 0.5, 5);
    });

    test('minSize is the space the arrows take', () => {
        const bar = build('Basics', 'ScrollBar_VT') as GScrollBar;
        const arrow1 = bar.getChild('arrow1')!;
        const arrow2 = bar.getChild('arrow2')!;

        // Orientation is not a property of the package: a bar learns whether it
        // is vertical from the pane that adopts it, so until `setScrollPane`
        // runs it measures along its horizontal axis.
        expect(bar.minSize).toBe(arrow1.width + arrow2.width);

        bar.setScrollPane(aPane(), true);
        expect(bar.minSize).toBe(arrow1.height + arrow2.height);
        expect(arrow1).toBeInstanceOf(GButton);
        expect(bar.gripDragging).toBe(false);
    });

    test('dragging the grip reports state and moves the pane', () => {
        const bar = build('Basics', 'ScrollBar_VT') as GScrollBar;
        const pane = aPane();
        bar.setScrollPane(pane, true);
        bar.setDisplayPerc(0.5);

        // The grip only tracks the pointer while the bar is actually on stage,
        // so it has to hang off a root.
        const root = GRoot.create();
        root.addChild(bar);

        try {
            const grip = bar.getChild('grip')!;
            const down = new Event(EventType.TOUCH_BEGIN);
            down.pos.copy(grip.localToGlobal(0, 0));
            grip.emit(EventType.TOUCH_BEGIN, down);
            expect(bar.gripDragging).toBe(true);

            const before = pane.posY;
            const move = new Event(EventType.TOUCH_MOVE);
            move.pos.copy(grip.localToGlobal(0, 40));
            grip.emit(EventType.TOUCH_MOVE, move);
            expect(pane.posY, 'the pane scrolled').not.toBe(before);
            expect(pane.posY).toBeGreaterThanOrEqual(0);

            grip.emit(EventType.TOUCH_END, new Event(EventType.TOUCH_END));
            expect(bar.gripDragging).toBe(false);
        } finally {
            root.removeChild(bar);
        }
    });
});

// ---------------------------------------------------------------------------
// GComboBox
// ---------------------------------------------------------------------------

describe('GComboBox', () => {
    test('the dropdown and its list come from the extension block', () => {
        const combo = pageWidget('Demo_ComboBox', 'n1', GComboBox);
        expect(combo.dropdown, 'the popup component').not.toBeNull();
        expect(combo.dropdown!.getChild('list')).toBeInstanceOf(GList);
        expect(combo.getTextField()).toBeInstanceOf(GTextField);
    });

    test('items and the selection are decoded from the extension block', () => {
        const combo = pageWidget('Demo_ComboBox', 'n1', GComboBox);
        expect(combo.items).toEqual([
            'Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5', 'Item 6', 'Item 7', 'Item 8',
        ]);
        expect(combo.selectedIndex).toBe(0);
        expect(combo.text).toBe('Item 1');
        expect(combo.visibleItemCount).toBe(10);
    });

    test('visibleItemCount is decoded per instance', () => {
        const five = pageWidget('Demo_ComboBox', 'n4', GComboBox);
        expect(five.visibleItemCount).toBe(5);
        expect(five.items).toHaveLength(7);
    });

    test('selectedIndex steers text and icon', () => {
        const combo = pageWidget('Demo_ComboBox', 'n4', GComboBox);
        const tf = combo.getTextField()!;

        combo.selectedIndex = 2;
        expect(combo.text).toBe('Item 3');
        expect(tf.text).toBe('Item 3');

        combo.selectedIndex = -1;
        expect(combo.text).toBe('');
        expect(tf.text).toBe('');
    });

    test('items and values can be replaced wholesale', () => {
        const combo = pageWidget('Demo_ComboBox', 'n4', GComboBox);
        combo.items = ['Alpha', 'Beta'];
        combo.values = ['a', 'b'];
        expect(combo.selectedIndex, 'the old index still fits').toBe(0);
        expect(combo.text).toBe('Alpha');
        expect(combo.value).toBe('a');

        combo.value = 'b';
        expect(combo.selectedIndex).toBe(1);
        expect(combo.text).toBe('Beta');

        combo.items = [];
        expect(combo.selectedIndex).toBe(-1);
        expect(combo.text).toBe('');
    });

    test('an out-of-range selection index clears the text', () => {
        const combo = pageWidget('Demo_ComboBox', 'n4', GComboBox);
        combo.selectedIndex = 99;
        expect(combo.text).toBe('');

        combo.selectedIndex = 1;
        expect(combo.text).toBe('Item 2');
    });

    test('titleColor and titleFontSize reach the title text field', () => {
        const combo = pageWidget('Demo_ComboBox', 'n4', GComboBox);
        const tf = combo.getTextField()!;

        combo.titleFontSize = 18;
        expect(tf.fontSize).toBe(18);
        expect(combo.titleFontSize).toBe(18);

        combo.titleColor = new Color(1, 2, 3, 255);
        expect(tf.color.r).toBe(1);
    });

    test('showDropdown fills the popup list from items and values', () => {
        const combo = pageWidget('Demo_ComboBox', 'n4', GComboBox);
        const list = combo.dropdown!.getChild('list') as GList;
        combo.values = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'];

        (combo as unknown as { showDropdown(): void }).showDropdown();

        expect(list.numItems).toBe(7);
        expect(list.getChildAt(0).text).toBe('Item 1');
        expect(list.getChildAt(6).text).toBe('Item 7');
        expect(list.getChildAt(2).name, 'the value becomes the item name').toBe('v3');
        expect(list.selectedIndex, 'the popup opens with nothing highlighted').toBe(-1);
        expect(combo.dropdown!.width).toBe(combo.width);
    });

    test('picking an item updates the selection once the click settles', () => {
        const combo = pageWidget('Demo_ComboBox', 'n4', GComboBox);
        const list = combo.dropdown!.getChild('list') as GList;
        (combo as unknown as { showDropdown(): void }).showDropdown();

        const item = list.getChildAt(3);
        list.emit(EventType.CLICK_ITEM, item, new Event(EventType.CLICK_ITEM));
        expect(combo.selectedIndex, 'the change is deferred, not immediate').not.toBe(3);

        scheduler.update(0.1);
        expect(combo.selectedIndex).toBe(3);
        expect(combo.text).toBe('Item 4');
    });

    test('the popup list is only rebuilt when the items changed', () => {
        const combo = pageWidget('Demo_ComboBox', 'n4', GComboBox);
        const list = combo.dropdown!.getChild('list') as GList;
        const show = (combo as unknown as { showDropdown(): void });

        show.showDropdown();
        const first = list.getChildAt(0);

        show.showDropdown();
        expect(list.getChildAt(0), 'the same renderers are reused').toBe(first);

        combo.items = ['Only'];
        show.showDropdown();
        expect(list.numItems).toBe(1);
        expect(list.getChildAt(0).text).toBe('Only');
    });

    test('dispose tears the dropdown down too', () => {
        const combo = pageWidget('Demo_ComboBox', 'n4', GComboBox);
        const dropdown = combo.dropdown!;
        combo.dispose();
        expect(dropdown.disposed).toBe(true);
        expect(combo.dropdown).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// GTree and GTreeNode
// ---------------------------------------------------------------------------

describe('GTree', () => {
    function tree(): GTree {
        return (build('TreeView', 'Main') as GComponent).getChild('tree') as GTree;
    }

    test('the editor-decoded tree is laid out flat', () => {
        const t = tree();
        expect(t.layout).toBe(ListLayoutType.SingleColumn);
        expect(t.indent).toBe(15);
        expect(t.clickToExpand).toBe(1);
        expect(t.numItems).toBe(7);
        expect(t.rootNode.numChildren).toBe(2);

        const first = t.rootNode.getChildAt(0);
        expect(first.isFolder).toBe(true);
        expect(first.expanded).toBe(true);
        expect(first.text).toBe('Folder 1');
    });

    test('level decides the indent width of each cell', () => {
        const t = tree();
        const widths: string[] = [];
        for (let i = 0; i < t.numItems; i++) {
            const cell = t.getChildAt(i) as GComponent;
            widths.push(`${cell._treeNode!.level}:${cell.getChild('indent')!.width}`);
        }
        expect(widths).toEqual(['1:0', '2:15', '2:15', '2:15', '2:15', '1:0', '2:15']);
    });

    test('collapseAll hides descendants and expandAll brings them back', () => {
        const t = tree();
        const cellIds = () => {
            const ids: string[] = [];
            for (let i = 0; i < t.numItems; i++)
                ids.push(t.getChildAt(i).id);
            return ids;
        };
        const before = cellIds();

        t.collapseAll();
        expect(t.numItems, 'only the two folders are left').toBe(2);
        expect(t.rootNode.getChildAt(0).expanded).toBe(false);

        t.expandAll();
        expect(t.numItems).toBe(7);
        expect(cellIds(), 'the same cells come back').toEqual(before);
    });

    test('collapsing one folder leaves the other alone', () => {
        const t = tree();
        t.rootNode.getChildAt(0).expanded = false;
        expect(t.numItems).toBe(3);
        expect(t.rootNode.getChildAt(1).expanded).toBe(true);
    });

    test('a node expanded state drives its cell controller', () => {
        const t = tree();
        const folder = t.rootNode.getChildAt(0);
        expect(folder.cell!.getController('expanded')!.selectedIndex, 'expanded').toBe(1);

        folder.expanded = false;
        expect(folder.cell!.getController('expanded')!.selectedIndex).toBe(0);
        // The folder keeps its own row — collapsing hides its descendants, not
        // the folder itself. Two folders plus the other one's single child.
        expect(folder.cell!.parent, 'the folder row stays').toBe(t);
        expect(t.numItems).toBe(3);

        folder.expanded = true;
        expect(folder.cell!.getController('expanded')!.selectedIndex).toBe(1);
        expect(folder.cell!.parent).toBe(t);
        expect(t.numItems).toBe(7);
    });

    test('selectNode expands the path and selects the cell', () => {
        const t = tree();
        t.collapseAll();
        const deep = t.rootNode.getChildAt(1).getChildAt(0);

        t.selectNode(deep, false);
        expect(t.rootNode.getChildAt(1).expanded, 'the ancestor expanded').toBe(true);
        expect(t.selectedIndex).toBe(t.getChildIndex(deep.cell!));
        expect(t.getSelectedNode()).toBe(deep);

        t.unselectNode(deep);
        expect(t.selectedIndex).toBe(-1);
    });

    test('getSelectedNodes reports the nodes behind the selection', () => {
        const t = tree();
        t.selectionMode = ListSelectionMode.Multiple;
        t.addSelection(0);
        t.addSelection(1);

        const nodes = t.getSelectedNodes();
        expect(nodes).toHaveLength(2);
        expect(nodes[0]).toBe(t.rootNode.getChildAt(0));
    });

    test('clickToExpand toggles a folder when its cell is clicked', () => {
        const t = tree();
        const folder = t.rootNode.getChildAt(0);
        expect(folder.expanded).toBe(true);

        // A real click begins with TOUCH_BEGIN on the cell, which records the
        // expanded state the click started from.
        const cell = folder.cell!;
        cell.dispatchEvent(new Event(EventType.TOUCH_BEGIN, true));
        cell.dispatchEvent(new Event(EventType.CLICK, true));

        expect(folder.expanded, 'the click collapsed the folder').toBe(false);
    });

    test('treeNodeRender is called for cells as they change', () => {
        const t = tree();
        const seen: GTreeNode[] = [];
        t.treeNodeRender = (node) => seen.push(node);

        t.collapseAll();
        t.expandAll();
        expect(seen.length).toBeGreaterThan(0);
        expect(seen[0]).toBeInstanceOf(GTreeNode);
        expect(seen[0]).toBe(t.rootNode.getChildAt(0));
    });
});

describe('GTreeNode', () => {
    test('a node knows its parent, level and siblings', () => {
        const root = new GTreeNode(true);
        const a = new GTreeNode(false);
        const b = new GTreeNode(false);
        const c = new GTreeNode(false);

        root.addChild(a);
        root.addChild(b);
        root.addChild(c);

        expect(root.numChildren).toBe(3);
        expect(root.isFolder).toBe(true);
        expect(a.isFolder).toBe(false);
        expect(a.parent).toBe(root);
        expect(a.level).toBe(1);
        expect(root.level).toBe(0);
        expect(root.getChildAt(1)).toBe(b);
        // Children are looked up on the parent, not on a sibling.
        expect(root.getChildIndex(c)).toBe(2);
        expect(b.getPrevSibling()).toBe(a);
        expect(b.getNextSibling()).toBe(c);
        expect(a.getPrevSibling()).toBeNull();
        expect(c.getNextSibling()).toBeNull();
    });

    test('removing and swapping children keeps the levels right', () => {
        const root = new GTreeNode(true);
        const a = new GTreeNode(true);
        const a1 = new GTreeNode(false);
        const b = new GTreeNode(false);

        root.addChild(a);
        a.addChild(a1);
        root.addChild(b);
        expect(a1.level).toBe(2);

        root.swapChildren(a, b);
        expect(root.getChildAt(0)).toBe(b);
        expect(root.getChildAt(1)).toBe(a);

        root.removeChild(a);
        expect(root.numChildren).toBe(1);
        expect(a.parent).toBeNull();

        a.removeChildren();
        expect(a.numChildren).toBe(0);
    });

    test('a node moves between parents without being cloned', () => {
        const root = new GTreeNode(true);
        const folder = new GTreeNode(true);
        const child = new GTreeNode(false);

        root.addChild(folder);
        root.addChild(child);
        expect(child.parent).toBe(root);

        folder.addChild(child);
        expect(child.parent, 'the same node, re-parented').toBe(folder);
        expect(child.level).toBe(2);
        expect(root.numChildren).toBe(1);
    });

    test('expandToRoot opens every ancestor', () => {
        const root = new GTreeNode(true);
        const folder = new GTreeNode(true);
        const deep = new GTreeNode(false);
        root.addChild(folder);
        folder.addChild(deep);

        folder.expanded = false;
        expect(folder.expanded).toBe(false);

        deep.expandToRoot();
        expect(folder.expanded).toBe(true);
        expect(deep.expanded, 'a leaf cannot expand').toBe(false);
    });

    test('only a folder can be expanded', () => {
        const leaf = new GTreeNode(false);
        leaf.expanded = true;
        expect(leaf.expanded).toBe(false);
        expect(leaf.isFolder).toBe(false);
    });

    test('invalid child access throws', () => {
        const root = new GTreeNode(true);
        expect(() => root.getChildAt(0)).toThrow(/Invalid child index/);
        expect(() => root.addChildAt(new GTreeNode(false), 5)).toThrow(/Invalid child index/);
        expect(() => root.swapChildren(new GTreeNode(false), new GTreeNode(false))).toThrow(/Not a child/);
    });
});

// ---------------------------------------------------------------------------
// Input wiring
// ---------------------------------------------------------------------------

describe('widget input', () => {
    test('fireClick drives a button through the root input processor', () => {
        const root = GRoot.create();
        const cb = build('Basics', 'Checkbox') as GButton;
        root.addChild(cb);

        expect(cb.mode).toBe(ButtonMode.Check);
        expect(cb.selected).toBe(false);

        cb.fireClick();
        expect(cb.selected, 'the synthetic click toggled the check box').toBe(true);
        expect(cb.getController('button')!.selectedPage).toBe('down');

        cb.fireClick();
        expect(cb.selected).toBe(false);
        cb.dispose();
    });

    test('a button finds the root it was added to', () => {
        const root = GRoot.create();
        const btn = build('Basics', 'Button') as GButton;
        root.addChild(btn);
        expect(btn.root).toBe(root);
        expect(btn.onStage).toBe(true);
        btn.dispose();
    });
});

describe('GList loop lists', () => {
    function loopList(): GList {
        return (build('LoopList', 'Main') as GComponent).getChild('list') as GList;
    }

    test('a loop list starts half way into its copies', () => {
        // The pane holds six copies of the items so that the loop can be entered
        // from either direction, and it belongs in the middle of them. It used to
        // start at the very left of the first copy — the position only moved once
        // something was scrolled, which is what made the first frame of the
        // sample look wrong and then snap into place.
        const list = loopList();
        list.setVirtualAndLoop();
        list.itemRenderer = () => {};
        list.numItems = 5;

        const pane = list.scrollPane!;
        expect(pane.contentWidth, 'six copies of five items').toBeGreaterThan(5 * list.virtualItemSize!.width * 2);
        // Half the strip: the gap is part of a copy's pitch, so it counts too.
        expect(pane.posX, 'the position starts half way in').toBeCloseTo((pane.contentWidth + list.columnGap) / 2, 3);
        expect(pane.posX, 'and there is room to scroll back').toBeGreaterThan(0);
    });

    test('a plain virtual list still starts at the beginning', () => {
        const list = (build('VirtualList', 'Main') as GComponent).getChild('mailList') as GList;
        list.setVirtual();
        list.itemRenderer = () => {};
        list.numItems = 40;

        expect(list.scrollPane!.posY, 'nothing loops, so nothing is re-based').toBe(0);
    });
});

describe('GLoader content', () => {
    /** The image node in a loader's tree — where it draws its content. */
    function contentOf(loader: GLoader): MockImageObject | null {
        const walk = (node: IRenderObject | null): MockImageObject | null => {
            if (!node)
                return null;
            if (node instanceof MockImageObject)
                return node;
            for (let i = 0; i < node.numChildren; i++) {
                const found = walk(node.getChildAt(i));
                if (found)
                    return found;
            }
            return null;
        };
        return walk(loader.node);
    }

    test('a movie clip an icon points at is shown, not played behind a hidden node', () => {
        // A clip draws through the loader's own content node, which `clearContent`
        // hides — and the image path is the only one that shows it again. An icon
        // naming a movie clip therefore animated away, invisible, and only clips
        // were affected.
        UIPackage.parse(readFixture('Basics.fui'), 'ui/Basics');

        const loader = new GLoader();
        loader.icon = 'ui://9leh0eyfhixt1v'; // Basics' `nlge1k`, a movie clip

        const content = contentOf(loader);
        expect(content, 'the loader bound its content').not.toBeNull();
        expect(content!.visible, 'and it is on show').toBe(true);
        expect(loader.playing, 'with the clip running behind it').toBe(true);
    });
});

describe('masks', () => {
    /** A stage-sized host with `under` below and a masked `layer` over it. */
    function build(hole: { x: number; y: number; w: number; h: number }, inverted: boolean): {
        stage: GComponent;
        under: GButton;
        layer: GComponent;
    } {
        const stage = new GComponent();
        stage.setSize(300, 300);

        // Solid to the pointer, as the editor publishes a button and a layer.
        const under = new GButton();
        under.opaque = true;
        under.setSize(50, 50);
        under.setPosition(100, 100);
        stage.addChild(under);

        const layer = new GComponent();
        layer.opaque = true;
        layer.setSize(300, 300);
        const holeShape = new GGraph();
        holeShape.setSize(hole.w, hole.h);
        holeShape.setPosition(hole.x, hole.y);
        layer.addChild(holeShape);
        layer.setMask(holeShape, inverted);
        stage.addChild(layer);

        return { stage, under, layer };
    }

    test('an inverted mask passes a click through the hole it cuts out', () => {
        // A guide layer covers the screen and cuts a hole over the button it is
        // pointing at, so the click has to reach the button underneath. Reading
        // the inverted flag the wrong way round left the layer answering for the
        // hole itself: the button showed through and could never be pressed.
        const { stage, under, layer } = build({ x: 95, y: 95, w: 60, h: 60 }, true);

        expect(stage.hitTest(new Point(120, 120)), 'inside the hole').toBe(under);
        expect(stage.hitTest(new Point(10, 10)), 'outside it').toBe(layer);
    });

    test('a plain mask keeps the click inside its shape', () => {
        const { stage, under, layer } = build({ x: 95, y: 95, w: 60, h: 60 }, false);

        expect(stage.hitTest(new Point(120, 120)), 'inside the shape').toBe(layer);
        expect(stage.hitTest(new Point(10, 10)), 'outside it').toBeNull();
        expect(stage.hitTest(new Point(120, 120))).not.toBe(under);
    });

    test('the mask object itself never answers for a click', () => {
        const { stage, under } = build({ x: 0, y: 0, w: 300, h: 300 }, true);
        // A full-screen hole leaves nothing for the layer to hold on to.
        expect(stage.hitTest(new Point(120, 120))).toBe(under);
    });
});
