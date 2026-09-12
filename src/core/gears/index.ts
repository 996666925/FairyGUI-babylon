/**
 * Every gear module, imported for its `registerGear` call.
 *
 * `GearBase.create` looks its constructor up in a registry rather than naming
 * the subclasses directly, so importing this module is what makes
 * `GObject.getGear(index)` work. Import it before building any UI — the core
 * entry point re-exports it for exactly that reason.
 */
import { GearDisplay } from './GearDisplay.js';
import { GearXY } from './GearXY.js';
import { GearSize } from './GearSize.js';
import { GearLook } from './GearLook.js';
import { GearColor } from './GearColor.js';
import { GearAnimation } from './GearAnimation.js';
import { GearText } from './GearText.js';
import { GearIcon } from './GearIcon.js';
import { GearDisplay2 } from './GearDisplay2.js';
import { GearFontSize } from './GearFontSize.js';

export { GearBase, GearTweenConfig, GearIndex, registerGear } from './GearBase.js';
export {
    GearDisplay,
    GearXY,
    GearSize,
    GearLook,
    GearColor,
    GearAnimation,
    GearText,
    GearIcon,
    GearDisplay2,
    GearFontSize,
};
