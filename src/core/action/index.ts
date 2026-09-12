/**
 * Imports the built-in controller actions for their registration side effect.
 *
 * `createAction` resolves through a registry, so the action modules must be
 * evaluated before any package containing a controller action is decoded.
 */
import './PlayTransitionAction.js';
import './ChangePageAction.js';

export { ControllerAction, createAction, registerAction } from './ControllerAction.js';
export { PlayTransitionAction } from './PlayTransitionAction.js';
export { ChangePageAction } from './ChangePageAction.js';
