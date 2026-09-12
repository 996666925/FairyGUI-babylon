import type { GComponent } from './GComponent.js';
import type { ScrollPane } from './ScrollPane.js';
import type { Transition } from './Transition.js';

/**
 * Late-bound hooks for the heavyweight classes `GComponent` needs.
 *
 * `ScrollPane` and `Transition` both operate on components and therefore import
 * `GComponent` themselves. Importing them from `GComponent` would close a cycle
 * that ESM must resolve before either class exists, so `GComponent` calls
 * through these instead; the core entry point installs the real constructors.
 */
type ScrollPaneCtor = new (owner: GComponent) => ScrollPane;
type TransitionCtor = new (owner: GComponent) => Transition;

let scrollPaneCtor: ScrollPaneCtor | null = null;
let transitionCtor: TransitionCtor | null = null;

export function setScrollPaneClass(ctor: ScrollPaneCtor): void {
    scrollPaneCtor = ctor;
}

export function setTransitionClass(ctor: TransitionCtor): void {
    transitionCtor = ctor;
}

export function createScrollPane(owner: GComponent): ScrollPane {
    if (!scrollPaneCtor)
        throw new Error('fairygui: ScrollPane not registered. Import the core entry point.');
    return new scrollPaneCtor(owner);
}

export function createTransition(owner: GComponent): Transition {
    if (!transitionCtor)
        throw new Error('fairygui: Transition not registered. Import the core entry point.');
    return new transitionCtor(owner);
}
