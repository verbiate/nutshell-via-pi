// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import * as React from "react";
import { BookCard } from "../book-card";

// ponytail: vi.hoisted so the mock factory can reference the spy without
// hitting TDZ — vitest hoists vi.mock above imports.
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@/components/transitions/scene-transition", () => ({
  useSceneTransition: () => ({ navigate }),
}));

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  navigate.mockClear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

function render(el: React.ReactElement) {
  act(() => {
    root!.render(el);
  });
}

describe("BookCard", () => {
  it("navigates forward to the reader route on click", () => {
    render(<BookCard id="abc" title="Some Book" author={null} coverPath={null} />);
    const card = container!.querySelector("[role=link]") as HTMLElement;
    act(() => {
      card.click();
    });
    expect(navigate).toHaveBeenCalledWith("/book/abc/reader", "forward");
  });

  it("activates on Enter and Space", () => {
    render(<BookCard id="abc" title="Some Book" author={null} coverPath={null} />);
    const card = container!.querySelector("[role=link]") as HTMLElement;
    act(() => {
      card.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });
    expect(navigate).toHaveBeenCalled();

    navigate.mockClear();
    act(() => {
      card.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: " " }),
      );
    });
    expect(navigate).toHaveBeenCalled();
  });

  it("renders the title on the placeholder cover when there is no cover image", () => {
    render(<BookCard id="abc" title="Some Book" author={null} coverPath={null} />);
    expect(container!.textContent).toContain("Some Book");
  });

  it("reserves a progress slot so covers share a common baseline", () => {
    render(<BookCard id="abc" title="T" author={null} coverPath={null} />);
    expect(container!.innerHTML).toContain("h-1.5");
    render(
      <BookCard
        id="abc"
        title="T"
        author={null}
        coverPath={null}
        progress={42}
        hasProgress
      />,
    );
    expect(container!.innerHTML).toContain("42");
    expect(container!.innerHTML).toContain("progressbar");
  });

  it("hides the progress bar when hasProgress is false even with a value", () => {
    render(
      <BookCard
        id="abc"
        title="T"
        author={null}
        coverPath={null}
        progress={42}
        hasProgress={false}
      />,
    );
    expect(container!.innerHTML).not.toContain("progressbar");
  });
});
