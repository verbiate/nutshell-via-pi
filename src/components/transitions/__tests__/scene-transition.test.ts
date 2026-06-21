// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";

// next/navigation only matters inside the provider component; the self-check
// function is pure, but the module import resolves next/navigation regardless,
// so stub it to keep this test dependency-free.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

import { _demoTransitionMath, _demoFreezeShelfBar } from "../scene-transition";

describe("scene-transition", () => {
  it("matches the reference transition values from example-bookshelf-to-reader-transition.html", () => {
    // scale .85, x -8%, brightness .55, 0.8s, power3.inOut
    expect(_demoTransitionMath()).toBe(true);
  });

  it("freezes the cloned shelf bar at the captured rect so it tracks the recede", () => {
    // Regression guard: without the freeze, the search bar's position:fixed /
    // position:sticky recomputes against the clone's transform and drifts up
    // independently of the bookshelf mid-transition.
    expect(_demoFreezeShelfBar()).toBe(true);
  });
});
