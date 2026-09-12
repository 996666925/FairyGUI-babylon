import { GComponent } from './GComponent.js';
import { GList } from './GList.js';
import { GTreeNode } from './GTreeNode.js';
import { EventType } from './event/Event.js';

import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { Event } from './event/Event.js';
import type { Controller } from './Controller.js';
import type { GObject } from './GObject.js';

/** Scratch for `getSelectedNodes`, so a select-all does not allocate. */
const s_list: number[] = [];

/**
 * A tree view: a `GList` whose items are indented rows, showing and hiding
 * whole sub-trees as folders are expanded.
 *
 * The node model is a `GTreeNode` tree kept in lockstep with the flat list of
 * cells in the list. `_afterInserted` and friends are the tree's callbacks into
 * the list; they are public because `GTreeNode` drives them.
 */
export class GTree extends GList {
    /** Draws a node's cell; assign to fill in each row's content. */
    public treeNodeRender: ((node: GTreeNode, obj: GComponent) => void) | null = null;
    /** Called just before a folder expands or collapses. */
    public treeNodeWillExpand: ((node: GTreeNode, expanded: boolean) => void) | null = null;

    private _indent = 15;
    private _clickToExpand = 0;
    private _rootNode: GTreeNode;
    private _expandedStatusInEvt = false;

    public constructor() {
        super();

        this._rootNode = new GTreeNode(true);
        this._rootNode._setTree(this);
        this._rootNode.expanded = true;
    }

    public get rootNode(): GTreeNode {
        return this._rootNode;
    }

    public get indent(): number {
        return this._indent;
    }

    public set indent(value: number) {
        this._indent = value;
    }

    /** 0: click anywhere toggles, 1: only via the controller, 2: double click. */
    public get clickToExpand(): number {
        return this._clickToExpand;
    }

    public set clickToExpand(value: number) {
        this._clickToExpand = value;
    }

    public getSelectedNode(): GTreeNode | null {
        if (this.selectedIndex !== -1)
            return this.getChildAt(this.selectedIndex)._treeNode ?? null;
        return null;
    }

    public getSelectedNodes(result?: GTreeNode[]): GTreeNode[] {
        if (!result)
            result = [];

        s_list.length = 0;
        super.getSelection(s_list);
        const cnt = s_list.length;
        for (let i = 0; i < cnt; i++)
            result.push(this.getChildAt(s_list[i])._treeNode!);
        return result;
    }

    public selectNode(node: GTreeNode, scrollItToView?: boolean): void {
        let parentNode = node.parent;
        while (parentNode && parentNode !== this._rootNode) {
            parentNode.expanded = true;
            parentNode = parentNode.parent;
        }

        if (!node._cell)
            return;

        this.addSelection(this.getChildIndex(node._cell), scrollItToView);
    }

    public unselectNode(node: GTreeNode): void {
        if (!node._cell)
            return;

        this.removeSelection(this.getChildIndex(node._cell));
    }

    public expandAll(folderNode?: GTreeNode): void {
        if (!folderNode)
            folderNode = this._rootNode;

        folderNode.expanded = true;
        const cnt = folderNode.numChildren;
        for (let i = 0; i < cnt; i++) {
            const node = folderNode.getChildAt(i);
            if (node.isFolder)
                this.expandAll(node);
        }
    }

    public collapseAll(folderNode?: GTreeNode): void {
        if (!folderNode)
            folderNode = this._rootNode;

        if (folderNode !== this._rootNode)
            folderNode.expanded = false;
        const cnt = folderNode.numChildren;
        for (let i = 0; i < cnt; i++) {
            const node = folderNode.getChildAt(i);
            if (node.isFolder)
                this.collapseAll(node);
        }
    }

    private createCell(node: GTreeNode): void {
        const child = this.getFromPool(node._resURL);
        if (!(child instanceof GComponent))
            throw new Error('fairygui: cannot create tree node object.');

        child._treeNode = node;
        node._cell = child;

        const indentObj = child.getChild('indent');
        if (indentObj)
            indentObj.width = (node.level - 1) * this._indent;

        let cc = child.getController('expanded');
        if (cc) {
            cc.onChanged(this.__expandedStateChanged, this);
            cc.selectedIndex = node.expanded ? 1 : 0;
        }

        cc = child.getController('leaf');
        if (cc)
            cc.selectedIndex = node.isFolder ? 0 : 1;

        if (node.isFolder)
            child.on(EventType.TOUCH_BEGIN, this.__cellMouseDown, this);

        if (this.treeNodeRender)
            this.treeNodeRender(node, child);
    }

    public _afterInserted(node: GTreeNode): void {
        if (!node._cell)
            this.createCell(node);

        const index = this.getInsertIndexForNode(node);
        this.addChildAt(node._cell!, index);
        if (this.treeNodeRender)
            this.treeNodeRender(node, node._cell!);

        if (node.isFolder && node.expanded)
            this.checkChildren(node, index);
    }

    private getInsertIndexForNode(node: GTreeNode): number {
        let prevNode = node.getPrevSibling();
        if (prevNode == null)
            prevNode = node.parent;
        let insertIndex = this.getChildIndex(prevNode!._cell!) + 1;
        const myLevel = node.level;
        const cnt = this.numChildren;
        for (let i = insertIndex; i < cnt; i++) {
            const testNode = this.getChildAt(i)._treeNode!;
            if (testNode.level <= myLevel)
                break;

            insertIndex++;
        }

        return insertIndex;
    }

    public _afterRemoved(node: GTreeNode): void {
        this.removeNode(node);
    }

    public _afterExpanded(node: GTreeNode): void {
        if (node === this._rootNode) {
            this.checkChildren(this._rootNode, 0);
            return;
        }

        if (this.treeNodeWillExpand)
            this.treeNodeWillExpand(node, true);

        if (node._cell == null)
            return;

        if (this.treeNodeRender)
            this.treeNodeRender(node, node._cell);

        const cc = node._cell.getController('expanded');
        if (cc)
            cc.selectedIndex = 1;

        if (node._cell.parent)
            this.checkChildren(node, this.getChildIndex(node._cell));
    }

    public _afterCollapsed(node: GTreeNode): void {
        if (node === this._rootNode) {
            this.checkChildren(this._rootNode, 0);
            return;
        }

        if (this.treeNodeWillExpand)
            this.treeNodeWillExpand(node, false);

        if (node._cell == null)
            return;

        if (this.treeNodeRender)
            this.treeNodeRender(node, node._cell);

        const cc = node._cell.getController('expanded');
        if (cc)
            cc.selectedIndex = 0;

        if (node._cell.parent)
            this.hideFolderNode(node);
    }

    public _afterMoved(node: GTreeNode): void {
        const startIndex = this.getChildIndex(node._cell!);
        let endIndex: number;
        if (node.isFolder)
            endIndex = this.getFolderEndIndex(startIndex, node.level);
        else
            endIndex = startIndex + 1;
        const insertIndex = this.getInsertIndexForNode(node);
        const cnt = endIndex - startIndex;
        if (insertIndex < startIndex) {
            for (let i = 0; i < cnt; i++) {
                const obj = this.getChildAt(startIndex + i);
                this.setChildIndex(obj, insertIndex + i);
            }
        } else {
            for (let i = 0; i < cnt; i++) {
                const obj = this.getChildAt(startIndex);
                this.setChildIndex(obj, insertIndex);
            }
        }
    }

    private getFolderEndIndex(startIndex: number, level: number): number {
        const cnt = this.numChildren;
        for (let i = startIndex + 1; i < cnt; i++) {
            const node = this.getChildAt(i)._treeNode!;
            if (node.level <= level)
                return i;
        }

        return cnt;
    }

    private checkChildren(folderNode: GTreeNode, index: number): number {
        const cnt = folderNode.numChildren;
        for (let i = 0; i < cnt; i++) {
            index++;
            const node = folderNode.getChildAt(i);
            if (node._cell == null)
                this.createCell(node);

            if (!node._cell!.parent)
                this.addChildAt(node._cell!, index);

            if (node.isFolder && node.expanded)
                index = this.checkChildren(node, index);
        }

        return index;
    }

    private hideFolderNode(folderNode: GTreeNode): void {
        const cnt = folderNode.numChildren;
        for (let i = 0; i < cnt; i++) {
            const node = folderNode.getChildAt(i);
            if (node._cell)
                this.removeChild(node._cell);
            if (node.isFolder && node.expanded)
                this.hideFolderNode(node);
        }
    }

    private removeNode(node: GTreeNode): void {
        if (node._cell) {
            if (node._cell.parent)
                this.removeChild(node._cell);
            this.returnToPool(node._cell);
            node._cell._treeNode = undefined;
            node._cell = null;
        }

        if (node.isFolder) {
            const cnt = node.numChildren;
            for (let i = 0; i < cnt; i++)
                this.removeNode(node.getChildAt(i));
        }
    }

    private __cellMouseDown(evt: Event): void {
        // `dispatchEvent` puts the listening `GObject` on `currentTarget`; the
        // reference reached the same object through `GObject.cast(node)`.
        const node = (evt.currentTarget as GObject)._treeNode;
        if (node)
            this._expandedStatusInEvt = node.expanded;
    }

    private __expandedStateChanged(cc: Controller): void {
        const node = cc.parent._treeNode!;
        node.expanded = cc.selectedIndex === 1;
    }

    protected dispatchItemEvent(item: GObject, evt: Event): void {
        if (this._clickToExpand !== 0) {
            const node = item._treeNode;
            if (node && this._expandedStatusInEvt === node.expanded) {
                if (this._clickToExpand === 2) {
                    // Double-click expansion is disabled in the reference: the
                    // `clickCount` test is commented out there too.
                } else
                    node.expanded = !node.expanded;
            }
        }

        super.dispatchItemEvent(item, evt);
    }

    public setup_beforeAdd(buffer: ByteBuffer, beginPos: number): void {
        super.setup_beforeAdd(buffer, beginPos);

        buffer.seek(beginPos, 9);

        this._indent = buffer.readInt();
        this._clickToExpand = buffer.readByte();
    }

    protected readItems(buffer: ByteBuffer): void {
        let prevLevel = 0;
        let lastNode: GTreeNode | null = null;

        const cnt = buffer.readShort();
        for (let i = 0; i < cnt; i++) {
            let nextPos = buffer.readShort();
            nextPos += buffer.position;

            let str = buffer.readS();
            if (str == null) {
                str = this.defaultItem;
                if (!str) {
                    buffer.position = nextPos;
                    continue;
                }
            }

            const isFolder = buffer.readBool();
            const level = buffer.readByte();

            const node = new GTreeNode(isFolder, str);
            node.expanded = true;
            if (i === 0)
                this._rootNode.addChild(node);
            else {
                if (level > prevLevel)
                    lastNode!.addChild(node);
                else if (level < prevLevel) {
                    for (let j = level; j <= prevLevel; j++)
                        lastNode = lastNode!.parent;
                    lastNode!.addChild(node);
                } else
                    lastNode!.parent!.addChild(node);
            }
            lastNode = node;
            prevLevel = level;

            this.setupItem(buffer, node.cell!);

            buffer.position = nextPos;
        }
    }
}
