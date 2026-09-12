import { EventType } from './event/Event.js';
import { EventDispatcher, type Listener } from './event/EventDispatcher.js';
import { UIPackage } from './UIPackage.js';
import { createAction } from './action/ControllerAction.js';
import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { GComponent } from './GComponent.js';

let _nextPageId = 0;

/**
 * A named state machine over a component.
 *
 * Each page has a display name and an opaque id; widgets bind to a controller
 * through gears, which read the selected page. Selecting a page therefore
 * drives every attached gear, and runs any configured page actions.
 */
export class Controller {
    private _selectedIndex = -1;
    private _previousIndex = -1;
    private _pageIds: string[] = [];
    private _pageNames: string[] = [];
    private _actions: import('./action/ControllerAction.js').ControllerAction[] | null = null;
    private _dispatcher = new EventDispatcher();

    public name = '';
    public parent!: GComponent;
    /** When true, `GButton` radios nested in a group auto-manage their depth. */
    public autoRadioGroupDepth = false;
    /** True while a page change is being applied. */
    public changing = false;

    public dispose(): void {
        this._dispatcher.offAll();
    }

    public get dispatcher(): EventDispatcher {
        return this._dispatcher;
    }

    public get selectedIndex(): number {
        return this._selectedIndex;
    }

    public set selectedIndex(value: number) {
        if (this._selectedIndex === value)
            return;
        if (value > this._pageIds.length - 1)
            throw new Error('index out of bounds: ' + value);

        this.changing = true;
        this._previousIndex = this._selectedIndex;
        this._selectedIndex = value;
        this.parent.applyController(this);
        this._dispatcher.emit(EventType.STATUS_CHANGED, this);
        this.changing = false;
    }

    public onChanged(callback: Listener, target?: unknown): void {
        this._dispatcher.on(EventType.STATUS_CHANGED, callback, target);
    }

    public offChanged(callback: Listener, target?: unknown): void {
        this._dispatcher.off(EventType.STATUS_CHANGED, callback, target);
    }

    /** Same as setting `selectedIndex`, but fires no `STATUS_CHANGED`. */
    public setSelectedIndex(value: number): void {
        if (this._selectedIndex === value)
            return;
        if (value > this._pageIds.length - 1)
            throw new Error('index out of bounds: ' + value);

        this.changing = true;
        this._previousIndex = this._selectedIndex;
        this._selectedIndex = value;
        this.parent.applyController(this);
        this.changing = false;
    }

    /** The index selected before the current one. */
    public get previsousIndex(): number {
        return this._previousIndex;
    }

    public get selectedPage(): string | null {
        return this._selectedIndex === -1 ? null : this._pageNames[this._selectedIndex];
    }

    public set selectedPage(val: string | null) {
        let i = this._pageNames.indexOf(val as string);
        if (i === -1)
            i = 0;
        this.selectedIndex = i;
    }

    /** Same as setting `selectedPage`, but fires no `STATUS_CHANGED`. */
    public setSelectedPage(value: string): void {
        let i = this._pageNames.indexOf(value);
        if (i === -1)
            i = 0;
        this.setSelectedIndex(i);
    }

    public get previousPage(): string | null {
        return this._previousIndex === -1 ? null : this._pageNames[this._previousIndex];
    }

    public get pageCount(): number {
        return this._pageIds.length;
    }

    public getPageName(index: number): string {
        return this._pageNames[index];
    }

    public addPage(name = ''): void {
        this.addPageAt(name, this._pageIds.length);
    }

    public addPageAt(name: string, index: number): void {
        const nid = '' + _nextPageId++;
        if (index === this._pageIds.length) {
            this._pageIds.push(nid);
            this._pageNames.push(name);
        } else {
            this._pageIds.splice(index, 0, nid);
            this._pageNames.splice(index, 0, name);
        }
    }

    public removePage(name: string): void {
        const i = this._pageNames.indexOf(name);
        if (i === -1)
            return;
        this._pageIds.splice(i, 1);
        this._pageNames.splice(i, 1);
        if (this._selectedIndex >= this._pageIds.length)
            this.selectedIndex = this._selectedIndex - 1;
        else
            this.parent.applyController(this);
    }

    public removePageAt(index: number): void {
        this._pageIds.splice(index, 1);
        this._pageNames.splice(index, 1);
        if (this._selectedIndex >= this._pageIds.length)
            this.selectedIndex = this._selectedIndex - 1;
        else
            this.parent.applyController(this);
    }

    public clearPages(): void {
        this._pageIds.length = 0;
        this._pageNames.length = 0;
        if (this._selectedIndex !== -1)
            this.selectedIndex = -1;
        else
            this.parent.applyController(this);
    }

    public hasPage(aName: string): boolean {
        return this._pageNames.indexOf(aName) !== -1;
    }

    public getPageIndexById(aId: string): number {
        return this._pageIds.indexOf(aId);
    }

    public getPageIdByName(aName: string): string | null {
        const i = this._pageNames.indexOf(aName);
        return i === -1 ? null : this._pageIds[i];
    }

    public getPageNameById(aId: string): string | null {
        const i = this._pageIds.indexOf(aId);
        return i === -1 ? null : this._pageNames[i];
    }

    public getPageId(index: number): string {
        return this._pageIds[index];
    }

    public get selectedPageId(): string | null {
        return this._selectedIndex === -1 ? null : this._pageIds[this._selectedIndex];
    }

    public set selectedPageId(val: string | null) {
        this.selectedIndex = this._pageIds.indexOf(val as string);
    }

    /** Selects the first page if `val` is not first, otherwise the second. */
    public set oppositePageId(val: string) {
        const i = this._pageIds.indexOf(val);
        if (i > 0)
            this.selectedIndex = 0;
        else if (this._pageIds.length > 1)
            this.selectedIndex = 1;
    }

    public get previousPageId(): string | null {
        return this._previousIndex === -1 ? null : this._pageIds[this._previousIndex];
    }

    public runActions(): void {
        if (!this._actions)
            return;
        const from = this.previousPageId;
        const to = this.selectedPageId;
        for (const action of this._actions)
            action.run(this, from, to);
    }

    public setup(buffer: ByteBuffer): void {
        const beginPos = buffer.position;
        buffer.seek(beginPos, 0);

        this.name = buffer.readS() ?? '';
        if (buffer.readBool())
            this.autoRadioGroupDepth = true;

        buffer.seek(beginPos, 1);

        const cnt = buffer.readShort();
        for (let i = 0; i < cnt; i++) {
            this._pageIds.push(buffer.readS() as string);
            this._pageNames.push(buffer.readS() as string);
        }

        let homePageIndex = 0;
        if (buffer.version >= 2) {
            const homePageType = buffer.readByte();
            switch (homePageType) {
                case 1:
                    homePageIndex = buffer.readShort();
                    break;

                case 2:
                    // Follow whichever branch the package is currently on.
                    homePageIndex = this._pageNames.indexOf(UIPackage.branch);
                    if (homePageIndex === -1)
                        homePageIndex = 0;
                    break;

                case 3:
                    homePageIndex = this._pageNames.indexOf(UIPackage.getVar(buffer.readS() as string) ?? '');
                    if (homePageIndex === -1)
                        homePageIndex = 0;
                    break;
            }
        }

        buffer.seek(beginPos, 2);

        const actionCount = buffer.readShort();
        if (actionCount > 0) {
            this._actions ??= [];
            for (let i = 0; i < actionCount; i++) {
                let nextPos = buffer.readShort();
                nextPos += buffer.position;

                const action = createAction(buffer.readByte());
                action.setup(buffer);
                this._actions.push(action);

                buffer.position = nextPos;
            }
        }

        this._selectedIndex = this.parent && this._pageIds.length > 0 ? homePageIndex : -1;
    }

    /** Fires `STATUS_CHANGED`; used when a controller is driven externally. */
    public emitStatusChanged(): void {
        this._dispatcher.emit(EventType.STATUS_CHANGED, this);
    }
}
