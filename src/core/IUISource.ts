/**
 * An external source of UI data that a `Window` waits on before initialising.
 *
 * The runtime never loads anything itself; a host that splits its UI across
 * bundles implements this and hands it to `Window.addUISource`.
 */
export interface IUISource {
    /** Identifies the source to the host's loader. */
    fileName: string;
    /** Set by the host once the source is ready. */
    loaded: boolean;
    /** Begins loading; calls `callback` on completion. */
    load(callback: () => void, target?: unknown): void;
}
