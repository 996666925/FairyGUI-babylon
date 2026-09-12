import type { GTree } from './GTree.js';
import type { GComponent } from './GComponent.js';

/**
 * A node in a `GTree`.
 *
 * The node carries the data and the hierarchy; the cell is the `GComponent`
 * `GTree` builds (or recycles) to draw it. A node only becomes a folder by
 * being constructed with children — `isFolder` never changes afterwards.
 */
export class GTreeNode {
    public data?: unknown;

    private _parent: GTreeNode | null = null;
    private _children: GTreeNode[] | null = null;
    private _expanded = false;
    private _level = 0;
    private _tree: GTree | null = null;

    /** The component drawing this node; owned and pooled by the tree. */
    public _cell: GComponent | null = null;
    public _resURL?: string;

    public constructor(hasChild: boolean, resURL?: string) {
        this._resURL = resURL;
        if (hasChild)
            this._children = [];
    }

    public get expanded(): boolean {
        return this._expanded;
    }

    public set expanded(value: boolean) {
        if (this._children == null)
            return;

        if (this._expanded !== value) {
            this._expanded = value;
            if (this._tree) {
                if (this._expanded)
                    this._tree._afterExpanded(this);
                else
                    this._tree._afterCollapsed(this);
            }
        }
    }

    public get isFolder(): boolean {
        return this._children != null;
    }

    public get parent(): GTreeNode | null {
        return this._parent;
    }

    public get text(): string | null {
        if (this._cell)
            return this._cell.text;
        return null;
    }

    public set text(value: string | null) {
        if (this._cell)
            this._cell.text = value;
    }

    public get icon(): string | null {
        if (this._cell)
            return this._cell.icon;
        return null;
    }

    public set icon(value: string | null) {
        if (this._cell)
            this._cell.icon = value;
    }

    public get cell(): GComponent | null {
        return this._cell;
    }

    public get level(): number {
        return this._level;
    }

    public _setLevel(value: number): void {
        this._level = value;
    }

    public addChild(child: GTreeNode): GTreeNode {
        this.addChildAt(child, this._children!.length);
        return child;
    }

    public addChildAt(child: GTreeNode, index: number): GTreeNode {
        if (!child)
            throw new Error('child is null');

        const numChildren = this._children!.length;

        if (index < 0 || index > numChildren)
            throw new RangeError('Invalid child index');

        if (child._parent === this) {
            this.setChildIndex(child, index);
        } else {
            if (child._parent)
                child._parent.removeChild(child);

            const cnt = this._children!.length;
            if (index === cnt)
                this._children!.push(child);
            else
                this._children!.splice(index, 0, child);

            child._parent = this;
            child._level = this._level + 1;
            child._setTree(this._tree);
            // Deliberate precedence, as in the reference: the tree's own root
            // always shows its children, and any other expanded folder does too.
            if (this._tree && this === this._tree.rootNode
                || (this._cell && this._cell.parent && this._expanded)) {
                this._tree!._afterInserted(child);
            }
        }

        return child;
    }

    public removeChild(child: GTreeNode): GTreeNode {
        const childIndex = this._children!.indexOf(child);
        if (childIndex !== -1)
            this.removeChildAt(childIndex);
        return child;
    }

    public removeChildAt(index: number): GTreeNode {
        // The reference threw a bare string here and in `getChildAt`; an
        // `Error` keeps the stack without changing when it is thrown.
        if (index < 0 || index >= this.numChildren)
            throw new RangeError('Invalid child index');

        const child = this._children![index];
        this._children!.splice(index, 1);

        child._parent = null;
        if (this._tree) {
            child._setTree(null);
            this._tree._afterRemoved(child);
        }

        return child;
    }

    public removeChildren(beginIndex = 0, endIndex = -1): void {
        if (endIndex < 0 || endIndex >= this.numChildren)
            endIndex = this.numChildren - 1;

        for (let i = beginIndex; i <= endIndex; ++i)
            this.removeChildAt(beginIndex);
    }

    public getChildAt(index: number): GTreeNode {
        if (index < 0 || index >= this.numChildren)
            throw new RangeError('Invalid child index');
        return this._children![index];
    }

    public getChildIndex(child: GTreeNode): number {
        return this._children!.indexOf(child);
    }

    public getPrevSibling(): GTreeNode | null {
        if (this._parent == null)
            return null;

        const i = this._parent._children!.indexOf(this);
        if (i <= 0)
            return null;

        return this._parent._children![i - 1];
    }

    public getNextSibling(): GTreeNode | null {
        if (this._parent == null)
            return null;

        const i = this._parent._children!.indexOf(this);
        if (i < 0 || i >= this._parent._children!.length - 1)
            return null;

        return this._parent._children![i + 1];
    }

    public setChildIndex(child: GTreeNode, index: number): void {
        const oldIndex = this._children!.indexOf(child);
        if (oldIndex === -1)
            throw new Error('Not a child of this container');

        const cnt = this._children!.length;
        if (index < 0)
            index = 0;
        else if (index > cnt)
            index = cnt;

        if (oldIndex === index)
            return;

        this._children!.splice(oldIndex, 1);
        this._children!.splice(index, 0, child);
        if (this._tree && this === this._tree.rootNode
            || (this._cell && this._cell.parent && this._expanded)) {
            this._tree!._afterMoved(child);
        }
    }

    public swapChildren(child1: GTreeNode, child2: GTreeNode): void {
        const index1 = this._children!.indexOf(child1);
        const index2 = this._children!.indexOf(child2);
        if (index1 === -1 || index2 === -1)
            throw new Error('Not a child of this container');
        this.swapChildrenAt(index1, index2);
    }

    public swapChildrenAt(index1: number, index2: number): void {
        const child1 = this._children![index1];
        const child2 = this._children![index2];

        this.setChildIndex(child1, index2);
        this.setChildIndex(child2, index1);
    }

    public get numChildren(): number {
        return this._children!.length;
    }

    /** Expands this node and every ancestor, so it is on screen. */
    public expandToRoot(): void {
        let p: GTreeNode | null = this;
        while (p) {
            p.expanded = true;
            p = p.parent;
        }
    }

    public get tree(): GTree | null {
        return this._tree;
    }

    public _setTree(value: GTree | null): void {
        this._tree = value;
        if (this._tree && this._tree.treeNodeWillExpand && this._expanded)
            this._tree.treeNodeWillExpand(this, true);

        if (this._children) {
            const cnt = this._children.length;
            for (let i = 0; i < cnt; i++) {
                const node = this._children[i];
                node._level = this._level + 1;
                node._setTree(value);
            }
        }
    }
}
