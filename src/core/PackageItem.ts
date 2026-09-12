import type { ByteBuffer } from './utils/ByteBuffer.js';
import type { ObjectType, PackageItemType } from './FieldTypes.js';
import type { Rect } from './utils/Geometry.js';
import type { PixelHitTestData } from './event/HitTest.js';
import type { BitmapFont, BitmapFontData } from './display/BitmapFont.js';
import { globalState } from './State.js';
import type { UIPackage } from './UIPackage.js';

/** One decoded frame of a `MovieClip` item. */
export interface Frame {
    /** Region of the atlas this frame shows. */
    rect: Rect;
    /** Extra hold time in seconds, on top of the clip's own interval. */
    addDelay: number;
    /** Id of the sprite backing this frame, for the backend to resolve. */
    spriteId: string | null;
}

export class PackageItem {
    /** Set by the parser immediately after construction. */
    public owner!: UIPackage;

    public type!: PackageItemType;
    public objectType?: ObjectType;
    public id!: string;
    /** Items published without a name are stored as `null`, not `""`. */
    public name: string | null = null;
    public width = 0;
    public height = 0;
    /** Resolved asset path; `null` for items that do not reference a file. */
    public file: string | null = null;
    /**
     * Whether the editor marked this item as exported — i.e. part of the
     * package's public surface rather than a component's internal parts.
     */
    public exported = false;
    public decoded?: boolean;
    public loading?: Array<(err: Error | null, item: PackageItem) => void>;
    /** Sub-buffer holding this item's type-specific payload. */
    public rawData?: ByteBuffer;
    /**
     * Backend-resolved asset. The core never reads this — it exists so the
     * renderer can cache whatever it built (a texture, a font atlas, …) next to
     * the item that produced it.
     */
    public asset?: unknown;

    public highResolution?: string[];
    public branches?: string[];

    // image
    public scale9Grid?: Rect;
    public scaleByTile?: boolean;
    public tileGridIndice?: number;
    public smoothing?: boolean;
    public hitTestData?: PixelHitTestData;

    // movieclip
    public interval?: number;
    public repeatDelay?: number;
    public swing?: boolean;
    public frames?: Frame[];

    // font
    public font?: BitmapFontData;
    /**
     * The same table with the package lookups a renderer needs. Built by the
     * parser and owned by the core — unlike `asset`, which the backend fills.
     */
    public bitmapFont?: BitmapFont;

    // component
    public extensionType?: unknown;

    /** Resolves through the branch table, if a branch is selected. */
    public getBranch(): PackageItem {
        if (this.branches && this.owner.branchIndex !== -1) {
            const itemId = this.branches[this.owner.branchIndex];
            if (itemId)
                return this.owner.getItemById(itemId) ?? this;
        }
        return this;
    }

    /** Resolves through the high-resolution table, if one is active. */
    public getHighResolution(): PackageItem {
        if (this.highResolution && globalState.contentScaleLevel > 0) {
            const itemId = this.highResolution[globalState.contentScaleLevel - 1];
            if (itemId)
                return this.owner.getItemById(itemId) ?? this;
        }
        return this;
    }

    public toString(): string {
        return this.name ?? '';
    }
}
