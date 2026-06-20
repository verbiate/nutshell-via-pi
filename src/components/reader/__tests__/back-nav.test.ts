import { describe, it, expect, vi } from "vitest";
import { backToLibrary } from "../back-nav";

describe("backToLibrary", () => {
  it("navigates to /my-library with the back scene direction", () => {
    const navigate = vi.fn();
    backToLibrary(navigate);

    expect(navigate).toHaveBeenCalledWith("/my-library", "back");
  });
});
