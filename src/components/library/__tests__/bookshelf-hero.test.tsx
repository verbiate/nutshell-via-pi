// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import * as React from "react";
import gsap from "gsap";

import { Bookshelf } from "../bookshelf";

// ponytail: controllable mock — tests mutate `state.returningHero` (then
// re-render) to drive the hero-hold / reveal / settle wiring without mounting
// the full SceneTransitionProvider + router.
const { state, settleHero, navigate } = vi.hoisted(() => ({
  state: {
    returningHero: null as { bookId: string; fly: boolean } | null,
  },
  settleHero: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/components/transitions/scene-transition", () => ({
  useSceneTransition: () => ({
    returningHero: state.returningHero,
    settleHero,
    navigate,
    entering: false,
    forwardFlyActive: false,
  }),
}));

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  state.returningHero = null;
  settleHero.mockClear();
  navigate.mockClear();
  // No-op tweeners; we assert call args / absence only.
  vi.spyOn(gsap, "set").mockImplementation((() => ({})) as any);
  vi.spyOn(gsap, "to").mockImplementation((() => ({})) as any);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

function render(el: React.ReactElement) {
  act(() => root!.render(el));
}

function book(id: string) {
  return {
    id,
    title: "T",
    author: "A",
    coverPath: "c",
    progress: null,
    hasProgress: false,
  } as any;
}

function cardEl(id: string) {
  return container!.querySelector(
    `[data-book-card][data-book-id="${id}"]`,
  ) as HTMLElement;
}

describe("Bookshelf hero-return", () => {
  it("suppresses the ripple reveal when returningHero is set (no gsap hide)", () => {
    state.returningHero = { bookId: "b1", fly: false };
    render(<Bookshelf books={[book("b1"), book("b2")]} />);
    expect(gsap.set).not.toHaveBeenCalled();
    expect(gsap.to).not.toHaveBeenCalled();
  });

  it("holds the hero card hidden (opacity 0) when fly:true; others visible", () => {
    state.returningHero = { bookId: "b1", fly: true };
    render(<Bookshelf books={[book("b1"), book("b2")]} />);
    expect(cardEl("b1").style.opacity).toBe("0");
    expect(cardEl("b2").style.opacity).not.toBe("0");
  });

  it("calls settleHero with the hero cover rect when fly:true", () => {
    state.returningHero = { bookId: "b1", fly: true };
    render(<Bookshelf books={[book("b1")]} />);
    expect(settleHero).toHaveBeenCalledTimes(1);
    const arg = settleHero.mock.calls[0][0];
    expect(arg).not.toBeNull();
    expect(typeof arg.width).toBe("number");
  });

  it("calls settleHero(null) when fly:false (sidebar was closed)", () => {
    state.returningHero = { bookId: "b1", fly: false };
    render(<Bookshelf books={[book("b1")]} />);
    expect(settleHero).toHaveBeenCalledWith(null);
  });

  it("reveals the hero (opacity 1) once returningHero clears", () => {
    state.returningHero = { bookId: "b1", fly: true };
    render(<Bookshelf books={[book("b1")]} />);
    expect(cardEl("b1").style.opacity).toBe("0");
    state.returningHero = null;
    act(() => root!.render(<Bookshelf books={[book("b1")]} />));
    expect(cardEl("b1").style.opacity).toBe("1");
  });

  it("does not suppress ripple on a normal mount (no returningHero)", () => {
    render(<Bookshelf books={[book("b1"), book("b2")]} />);
    // Normal mount hides cards via gsap.set (ripple start-state).
    expect(gsap.set).toHaveBeenCalled();
  });
});
