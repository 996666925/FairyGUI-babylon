import { RelationItem } from './RelationItem.js';
import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { GObject } from './GObject.js';
import type { GComponent } from './GComponent.js';

/**
 * Everything that keeps one object aligned to others.
 *
 * Relations are grouped by target: one `RelationItem` per target, holding all
 * the edge relationships configured against it.
 */
export class Relations {
    private _owner: GObject;
    private _items: RelationItem[] = [];

    /** The target currently being applied, or `null`. Re-entrancy guard. */
    public handling: GObject | null = null;
    /**
     * Set when a target announces it is about to resize, meaning any cached
     * sizes are stale. `GObject.width`/`height` flush this before reading.
     */
    public sizeDirty = false;

    public constructor(owner: GObject) {
        this._owner = owner;
    }

    public add(target: GObject, relationType: number, usePercent = false): void {
        for (const item of this._items) {
            if (item.target === target) {
                item.add(relationType, usePercent);
                return;
            }
        }
        const newItem = new RelationItem(this._owner);
        newItem.target = target;
        newItem.add(relationType, usePercent);
        this._items.push(newItem);
    }

    public remove(target: GObject, relationType = 0): void {
        for (let i = 0; i < this._items.length;) {
            const item = this._items[i];
            if (item.target === target) {
                item.remove(relationType);
                if (item.isEmpty) {
                    item.dispose();
                    this._items.splice(i, 1);
                } else {
                    i++;
                }
            } else {
                i++;
            }
        }
    }

    public contains(target: GObject): boolean {
        return this._items.some((item) => item.target === target);
    }

    public clearFor(target: GObject): void {
        for (let i = 0; i < this._items.length;) {
            if (this._items[i].target === target) {
                this._items[i].dispose();
                this._items.splice(i, 1);
            } else {
                i++;
            }
        }
    }

    public clearAll(): void {
        for (const item of this._items)
            item.dispose();
        this._items.length = 0;
    }

    public copyFrom(source: Relations): void {
        this.clearAll();
        for (const src of source._items) {
            const item = new RelationItem(this._owner);
            item.copyFrom(src);
            this._items.push(item);
        }
    }

    public dispose(): void {
        this.clearAll();
    }

    public onOwnerSizeChanged(dWidth: number, dHeight: number, applyPivot: boolean): void {
        for (const item of this._items)
            item.applyOnSelfResized(dWidth, dHeight, applyPivot);
    }

    public ensureRelationsSizeCorrect(): void {
        if (this._items.length === 0)
            return;
        this.sizeDirty = false;
        for (const item of this._items)
            item.target?.ensureSizeCorrect();
    }

    public get empty(): boolean {
        return this._items.length === 0;
    }

    public get items(): readonly RelationItem[] {
        return this._items;
    }

    /**
     * Decodes relations from a component's payload.
     *
     * @param parentToChild whether a positive target index names a sibling
     *   (component data) or a child of the owner (list item data).
     */
    public setup(buffer: ByteBuffer, parentToChild: boolean): void {
        const cnt = buffer.readByte();
        for (let i = 0; i < cnt; i++) {
            const targetIndex = buffer.readShort();
            let target: GObject | null;
            if (targetIndex === -1)
                target = this._owner.parent;
            else if (parentToChild)
                target = (this._owner as unknown as GComponent).getChildAt(targetIndex);
            else
                target = this._owner.parent?.getChildAt(targetIndex) ?? null;

            const newItem = new RelationItem(this._owner);
            newItem.target = target;
            this._items.push(newItem);

            const cnt2 = buffer.readByte();
            for (let j = 0; j < cnt2; j++) {
                const rt = buffer.readByte();
                const usePercent = buffer.readBool();
                newItem.internalAdd(rt, usePercent);
            }
        }
    }
}
