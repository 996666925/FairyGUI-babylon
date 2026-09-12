import { ControllerAction, registerAction } from './ControllerAction.js';
import type { ByteBuffer } from '../utils/ByteBuffer.js';
import type { Controller } from '../Controller.js';
import type { Transition } from '../Transition.js';

/** Plays a named transition on the controller's parent when a page change matches. */
export class PlayTransitionAction extends ControllerAction {
    public transitionName: string | null = null;
    public playTimes = 1;
    public delay = 0;
    public stopOnExit = false;

    private _currentTransition: Transition | null = null;

    protected enter(controller: Controller): void {
        const trans = controller.parent.getTransition(this.transitionName as string);
        if (!trans)
            return;

        if (this._currentTransition && this._currentTransition.playing)
            trans.changePlayTimes(this.playTimes);
        else
            trans.play(null, this.playTimes, this.delay);

        this._currentTransition = trans;
    }

    protected leave(_controller: Controller): void {
        if (this.stopOnExit && this._currentTransition) {
            this._currentTransition.stop();
            this._currentTransition = null;
        }
    }

    public setup(buffer: ByteBuffer): void {
        super.setup(buffer);
        this.transitionName = buffer.readS();
        this.playTimes = buffer.readInt();
        this.delay = buffer.readFloat();
        this.stopOnExit = buffer.readBool();
    }
}

registerAction(0, PlayTransitionAction);
