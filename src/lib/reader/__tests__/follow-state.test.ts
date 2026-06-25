import { describe, it, expect } from "vitest";
import {
  applyRelocated,
  DEFAULT_FOLLOW_STATE,
  type FollowState,
} from "../follow-state";

describe("applyRelocated", () => {
  const stateOnPage5: FollowState = {
    ...DEFAULT_FOLLOW_STATE,
    lastTtsPage: 5,
    lastTtsHref: "chapter1.xhtml",
  };

  it("absorbs a multi-fire relocated burst as our own nav", () => {
    // Simulates a forward page turn where epub.js fires relocated 3×:
    // post-display on the destination, a transient SCROLLED step on the
    // previous page, then a RESIZED step back on the destination.
    // With ourNav true for the whole burst, the settled page wins and
    // userBrowsedAway must stay false.
    const s1 = applyRelocated(stateOnPage5, {
      ourNav: true,
      page: 6,
      href: "chapter1.xhtml",
    });
    expect(s1.userBrowsedAway).toBe(false);
    expect(s1.lastTtsPage).toBe(6);

    const s2 = applyRelocated(s1, {
      ourNav: true,
      page: 5,
      href: "chapter1.xhtml",
    });
    expect(s2.userBrowsedAway).toBe(false);
    expect(s2.lastTtsPage).toBe(5);

    const s3 = applyRelocated(s2, {
      ourNav: true,
      page: 6,
      href: "chapter1.xhtml",
    });
    expect(s3.userBrowsedAway).toBe(false);
    expect(s3.lastTtsPage).toBe(6);
  });

  it("documents the old single-shot bug: first fire consumed, siblings misattributed", () => {
    // This is the behavior BEFORE the settle-window fix: ourNav is cleared
    // on fire #1, so fire #2 (transient wrong-direction page) is treated as
    // a user navigation and sticks userBrowsedAway=true.
    const s1 = applyRelocated(stateOnPage5, {
      ourNav: true,
      page: 6,
      href: "chapter1.xhtml",
    });
    // Simulate the old handler clearing ourNavInFlight after the first fire.
    const afterOldClear = { ...s1, ourNavInFlight: false };

    const s2 = applyRelocated(afterOldClear, {
      ourNav: false,
      page: 5,
      href: "chapter1.xhtml",
    });
    expect(s2.userBrowsedAway).toBe(true);
  });

  it("marks a genuine user navigation as browsed-away", () => {
    const s = applyRelocated(stateOnPage5, {
      ourNav: false,
      page: 10,
      href: "chapter2.xhtml",
    });
    expect(s.userBrowsedAway).toBe(true);
    expect(s.lastTtsPage).toBe(5);
  });

  it("clears browsed-away when the user returns to the TTS page", () => {
    const away: FollowState = { ...stateOnPage5, userBrowsedAway: true };
    const s = applyRelocated(away, {
      ourNav: false,
      page: 5,
      href: "chapter1.xhtml",
    });
    expect(s.userBrowsedAway).toBe(false);
  });

  it("is a no-op before any TTS position is recorded", () => {
    const s = applyRelocated(DEFAULT_FOLLOW_STATE, {
      ourNav: false,
      page: 99,
      href: "chapter2.xhtml",
    });
    expect(s).toEqual(DEFAULT_FOLLOW_STATE);
  });
});
