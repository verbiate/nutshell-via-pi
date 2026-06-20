// ponytail: extracted as a pure seam so the back-nav transition is unit-
// testable without mounting the 769-line ReaderClient (iframe + heavy children).
// Takes the transition navigate() directly — keeps the reader decoupled from
// the SceneTransitionProvider's router internals.
export type SceneNavigate = (
  url: string,
  direction: "forward" | "back",
  opts?: {
    hero?: { node: HTMLElement; rect: DOMRect };
    bookId?: string;
    sidebarOpen?: boolean;
  },
) => void;

export function backToLibrary(
  navigate: SceneNavigate,
  opts?: {
    hero?: { node: HTMLElement; rect: DOMRect };
    bookId?: string;
    sidebarOpen?: boolean;
  },
) {
  navigate("/my-library", "back", opts);
}
