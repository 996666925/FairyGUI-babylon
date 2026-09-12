import { EventType, GRoot, GTreeNode, UIPackage, type GComponent, type GObject, type GTree } from 'fairygui-babylon';

export class TreeViewDemo {
    private _view!: GComponent;
    private _tree1!: GTree;
    private _tree2!: GTree;
    private _fileURL!: string;

    constructor() {
        UIPackage.load('ui/TreeView').then(() => this.onUILoaded()).catch((err: unknown) => console.error(err));
    }

    onUILoaded(): void {
        const view = UIPackage.createObject('TreeView', 'Main')?.asCom;
        if (view === undefined)
            return;
        this._view = view;
        this._view.makeFullScreen();
        GRoot.inst.addChild(this._view);

        this._fileURL = 'ui://TreeView/file';

        this._tree1 = this._view.getChild('tree')!.asTree;
        this._tree1.on(EventType.CLICK_ITEM, this.__clickNode, this);
        this._tree2 = this._view.getChild('tree2')!.asTree;
        this._tree2.on(EventType.CLICK_ITEM, this.__clickNode, this);
        this._tree2.treeNodeRender = this.renderTreeNode.bind(this);

        const topNode: GTreeNode = new GTreeNode(true);
        topNode.data = "I'm a top node";
        this._tree2.rootNode.addChild(topNode);
        for (let i: number = 0; i < 5; i++) {
            const node: GTreeNode = new GTreeNode(false);
            node.data = 'Hello ' + i;
            topNode.addChild(node);
        }

        const aFolderNode: GTreeNode = new GTreeNode(true);
        aFolderNode.data = 'A folder node';
        topNode.addChild(aFolderNode);
        for (let i: number = 0; i < 5; i++) {
            const node: GTreeNode = new GTreeNode(false);
            node.data = 'Good ' + i;
            aFolderNode.addChild(node);
        }

        for (let i: number = 0; i < 3; i++) {
            const node: GTreeNode = new GTreeNode(false);
            node.data = 'World ' + i;
            topNode.addChild(node);
        }

        const anotherTopNode: GTreeNode = new GTreeNode(false);
        anotherTopNode.data = ["I'm a top node too", 'ui://TreeView/heart'];
        this._tree2.rootNode.addChild(anotherTopNode);
    }

    private renderTreeNode(node: GTreeNode, obj: GComponent): void {
        if (node.isFolder) {
            obj.text = node.data as string;
        }
        else if (node.data instanceof Array) {
            obj.icon = (node.data as unknown[])[1] as string;
            obj.text = (node.data as unknown[])[0] as string;
        }
        else {
            obj.icon = this._fileURL;
            obj.text = node.data as string;
        }
    }

    private __clickNode(itemObject: GObject): void {
        const node: GTreeNode = itemObject.treeNode!;
        console.log(node.text);
    }
}
