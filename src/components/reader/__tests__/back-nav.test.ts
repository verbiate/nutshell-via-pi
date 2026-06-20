// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { backToLibrary } from "../back-nav";

describe("backToLibrary", () => {
  it("navigates to /my-library with the back scene direction", () => {
    const navigate = vi.fn();
    backToLibrary(navigate);

    expect(navigate).toHaveBeenCalledWith(
      "/my-library",
      "back",
      undefined,
    );
  });

  it("passes the hero/bookId/sidebarOpen opts through to navigate", () => {
    const navigate = vi.fn();
    const hero = {
      node: document.createElement("div"),
      rect: new DOMRect(0, 0, 10, 10),
    };
    backToLibrary(navigate, { hero, bookId: "b1", sidebarOpen: true });

    expect(navigate).toHaveBeenCalledWith("/my-library", "back", {
      hero,
      bookId: "b1",
      sidebarOpen: true,
    });
  });
});

