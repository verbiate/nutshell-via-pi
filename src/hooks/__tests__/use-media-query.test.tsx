// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { useMediaQuery } from "../use-media-query";

function Probe({ query }: { query: string }) {
  const matches = useMediaQuery(query);
  return <div data-testid="probe">{matches ? "yes" : "no"}</div>;
}

function renderProbe(query: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Probe query={query} />);
  });
  const getText = () => container.querySelector("[data-testid='probe']")!.textContent;
  return {
    getText,
    unmount: () => {
      act(() => root.unmount());
    },
    container,
  };
}

describe("useMediaQuery", () => {
  let listeners: { change: Set<(e: MediaQueryListEvent) => void> };
  let mql: {
    matches: boolean;
    media: string;
    addEventListener: (type: string, cb: (e: any) => void) => void;
    removeEventListener: (type: string, cb: (e: any) => void) => void;
  };

  beforeEach(() => {
    listeners = { change: new Set() };
    mql = {
      matches: false,
      media: "(min-width: 1024px)",
      addEventListener: vi.fn((type, cb) => {
        if (type === "change") listeners.change.add(cb as any);
      }),
      removeEventListener: vi.fn((type, cb) => {
        if (type === "change") listeners.change.delete(cb as any);
      }),
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

  it("does not throw when window is undefined (SSR-safe)", () => {
    const original = globalThis.window;
    // @ts-expect-error — simulate SSR by removing window
    delete globalThis.window;
    try {
      const html = renderToStaticMarkup(<Probe query="(min-width: 1024px)" />);
      expect(html).toContain("no");
    } finally {
      globalThis.window = original;
    }
  });

  it("returns the current matchMedia.matches after mount", () => {
    (window.matchMedia as any).mockImplementation((query: string) => ({
      ...mql,
      matches: true,
      media: query,
    }));
    const { getText, unmount } = renderProbe("(min-width: 1024px)");
    expect(getText()).toBe("yes");
    unmount();
  });

  it("updates when matchMedia fires a change event", () => {
    let currentMatches = false;
    (window.matchMedia as any).mockImplementation((query: string) => ({
      ...mql,
      get matches() {
        return currentMatches;
      },
      media: query,
    }));
    const { getText, unmount } = renderProbe("(min-width: 1024px)");
    expect(getText()).toBe("no");

    currentMatches = true;
    act(() => {
      listeners.change.forEach((cb) =>
        cb({ matches: true, media: "(min-width: 1024px)" } as any),
      );
    });
    expect(getText()).toBe("yes");
    unmount();
  });

  it("cleans up its listener on unmount", () => {
    const { unmount } = renderProbe("(min-width: 1024px)");
    expect(listeners.change.size).toBe(1);
    unmount();
    expect(listeners.change.size).toBe(0);
  });

  it("passes the query string through to matchMedia", () => {
    const { unmount } = renderProbe("(prefers-color-scheme: dark)");
    expect(window.matchMedia).toHaveBeenCalledWith(
      "(prefers-color-scheme: dark)",
    );
    unmount();
  });
});
