// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { usePrefersReducedMotion } from "../use-prefers-reduced-motion";

function Probe() {
  const reduced = usePrefersReducedMotion();
  return <div data-testid="probe">{reduced ? "yes" : "no"}</div>;
}

function renderProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Probe />);
  });
  const getText = () =>
    container.querySelector("[data-testid='probe']")!.textContent;
  return {
    getText,
    unmount: () => {
      act(() => root.unmount());
    },
  };
}

describe("usePrefersReducedMotion", () => {
  let mql: any;

  beforeEach(() => {
    mql = {
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn((query: string) => ({ ...mql, media: query })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("queries matchMedia with the prefers-reduced-motion: reduce query", () => {
    const { unmount } = renderProbe();
    expect(window.matchMedia).toHaveBeenCalledWith(
      "(prefers-reduced-motion: reduce)",
    );
    unmount();
  });

  it("returns false when the user has no reduced-motion preference", () => {
    (window.matchMedia as any).mockImplementation((query: string) => ({
      ...mql,
      matches: false,
      media: query,
    }));
    const { getText, unmount } = renderProbe();
    expect(getText()).toBe("no");
    unmount();
  });

  it("returns true when prefers-reduced-motion: reduce matches", () => {
    (window.matchMedia as any).mockImplementation((query: string) => ({
      ...mql,
      matches: true,
      media: query,
    }));
    const { getText, unmount } = renderProbe();
    expect(getText()).toBe("yes");
    unmount();
  });
});
