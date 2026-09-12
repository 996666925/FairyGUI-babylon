import { ControllerAction, registerAction } from './ControllerAction.js';
import type { ByteBuffer } from '../utils/ByteBuffer.js';
import type { Controller } from '../Controller.js';
import type { GComponent } from '../GComponent.js';
import type { GObject } from '../GObject.js';

/** Duck-typed check, so this module need not import `GComponent` at runtime. */
function asComponent(obj: GObject | null | undefined): GComponent | null {
    return obj && typeof (obj as unknown as GComponent).getController === 'function'
        ? obj as unknown as GComponent
        : null;
}

/**
 * Drives a second controller's page from the controller that triggered this
 * action — the mechanism behind linked tabs and nested tabs.
 */
export class ChangePageAction extends ControllerAction {
    public objectId: string | null = null;
    public controllerName: string | null = null;
    public targetPage: string | null = null;

    protected enter(controller: Controller): void {
        if (!this.controllerName)
            return;

        let gcom: GComponent | null;
        if (this.objectId) {
            gcom = asComponent(controller.parent.getChildById(this.objectId));
            if (!gcom)
                return;
        } else {
            gcom = controller.parent;
        }

        const target = gcom.getController(this.controllerName);
        if (!target || target === controller || target.changing)
            return;

        if (this.targetPage === '~1') {
            // Mirror the source controller's index.
            if (controller.selectedIndex < target.pageCount)
                target.selectedIndex = controller.selectedIndex;
        } else if (this.targetPage === '~2') {
            // Mirror the source controller's page by name.
            target.selectedPage = controller.selectedPage;
        } else {
            target.selectedPageId = this.targetPage;
        }
    }

    public setup(buffer: ByteBuffer): void {
        super.setup(buffer);
        this.objectId = buffer.readS();
        this.controllerName = buffer.readS();
        this.targetPage = buffer.readS();
    }
}

registerAction(1, ChangePageAction);
