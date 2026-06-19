declare module "https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js" {
  export interface BindingApi {
    element: HTMLElement;
    refresh: () => void;
    on: (event: "change", cb: (ev: { value: string | number }) => void) => void;
  }
  export interface ButtonApi {
    element: HTMLElement;
    on: (event: "click", cb: () => void) => void;
  }
  export interface FolderApi {
    addBinding: (obj: object, key: string, config?: Record<string, unknown>) => BindingApi;
    addButton: (opts: { title: string }) => ButtonApi;
    addBlade: (opts: Record<string, unknown>) => unknown;
    addFolder: (opts: { title: string; expanded?: boolean }) => FolderApi;
  }
  export interface PaneStatic {
    new (opts?: { title?: string; expanded?: boolean }): PaneInstance;
  }
  export interface PaneInstance extends FolderApi {
    element: HTMLElement;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    refresh: () => void;
    dispose: () => void;
  }
  export const Pane: PaneStatic;
}
