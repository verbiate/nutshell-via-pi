export interface FollowState {
  ourNavInFlight: boolean;
  userBrowsedAway: boolean;
  lastTtsPage: number | string | null;
  lastTtsHref: string | null;
}

export const DEFAULT_FOLLOW_STATE: FollowState = {
  ourNavInFlight: false,
  userBrowsedAway: false,
  lastTtsPage: null,
  lastTtsHref: null,
};

export interface RelocatedEvent {
  /** True when this relocated event belongs to a display() we initiated. */
  ourNav: boolean;
  page: number | string | null;
  href: string | null;
}

// ponytail: pure state reducer for TTS follow-along. Kept separate from
// epub-viewer.tsx so the tricky multi-fire relocated logic can be unit-tested
// without a real rendition / iframe.
export function applyRelocated(
  fs: FollowState,
  ev: RelocatedEvent,
): FollowState {
  if (ev.ourNav) {
    // Absorb the 2-3 sibling `relocated` events epub.js fires per turn
    // (post-display, SCROLLED, RESIZED). Keep updating lastTtsPage to the
    // latest value so the settled page wins, and never clear ourNavInFlight
    // here — the display() caller owns the flag lifecycle via a settle window.
    return {
      ...fs,
      ourNavInFlight: true,
      lastTtsPage: ev.page,
      lastTtsHref: ev.href,
      userBrowsedAway: false,
    };
  }

  if (fs.lastTtsPage !== null) {
    const sameSection = ev.href === fs.lastTtsHref;
    const samePage = ev.page === fs.lastTtsPage;
    return {
      ...fs,
      userBrowsedAway: !(sameSection && samePage),
    };
  }

  return fs;
}
