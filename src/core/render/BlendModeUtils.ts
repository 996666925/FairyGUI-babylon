import { BlendMode } from '../FieldTypes.js';
import type { IRenderObject } from './IRenderObject.js';

/**
 * Applies a FairyGUI blend mode to a render object.
 *
 * The base contract only carries the enum; mapping it onto real GPU blend state
 * is backend work, so this checks for an optional hook and otherwise leaves the
 * mode for the backend to observe via `IRenderObject.blendMode`. A backend that
 * can honour the mode implements `applyBlendMode` on its render objects.
 */
interface BlendModeAware {
    applyBlendMode(mode: BlendMode): void;
}

const GROUPABLE: BlendMode[] = [
    BlendMode.Add,
    BlendMode.Multiply,
    BlendMode.Screen,
    BlendMode.Erase,
    BlendMode.Mask,
    BlendMode.Below,
    BlendMode.Off,
    BlendMode.One_One,
    BlendMode.Custom1,
    BlendMode.Custom2,
    BlendMode.Custom3,
];

export function applyBlendMode(node: IRenderObject, mode: BlendMode): void {
    const aware = node as unknown as Partial<BlendModeAware>;
    if (typeof aware.applyBlendMode === 'function') {
        aware.applyBlendMode(mode);
        return;
    }
    // Without backend support the object still records the mode, so a backend
    // that reads `blendMode` during its own update can pick it up then.
    node.blendMode = mode;
}

/** Whether `mode` needs the object to break out of the normal draw batch. */
export function isAdvancedBlendMode(mode: BlendMode): boolean {
    return mode !== BlendMode.Normal && mode !== BlendMode.None && GROUPABLE.includes(mode);
}
