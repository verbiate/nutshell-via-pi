// ponytail: pure merge of chat messages and attachment "added" events into one
// render-ready timeline. No React, no DB — the deterministic, fully-tested
// boundary. The Discussions panel composes these fns (maps its server rows into
// the input shapes, renders the returned slots).

export type TimelineEvent = {
  kind: "book-added" | "section-added";
  createdAt: string; // ISO — always present (events come from persisted rows)
  label: string; // book title or section ToC label
  // optional click targets, mirroring the Context chip row's navigation:
  coverPath?: string | null; // books only (thumbnail)
  bookId?: string; // books only → onOpenBook
  sectionHref?: string; // sections only → onNavigateToHref
};

export type TimelineSlot<M> =
  | { type: "message"; index: number; message: M }
  | { type: "event"; event: TimelineEvent };

// ponytail: a turn-0 attachment is one persisted within the same request that
// created the discussion (streamBlankFirstTurn creates the row, the user msg,
// and the attachment in one pass). Real follow-ups land seconds-to-days later,
// so a 30s window cleanly separates the two. Tunable if clock drift ever bites.
const TURN_ZERO_WINDOW_MS = 30_000;

/**
 * Should this attachment be treated as foundational context (present from the
 * start) rather than a mid-conversation addition? Turn-0 attachments get no
 * timeline marker and don't flip the "Original" badge — they're co-original.
 * Returns false (→ show the marker) when timestamps can't be parsed, since we
 * can't prove it was turn-0 and showing is the honest default.
 */
export function isTurnZeroAttachment(
  attachmentCreatedAt: string | Date,
  discussionCreatedAt: string | Date,
): boolean {
  const a =
    typeof attachmentCreatedAt === "string"
      ? Date.parse(attachmentCreatedAt)
      : attachmentCreatedAt.getTime();
  const d =
    typeof discussionCreatedAt === "string"
      ? Date.parse(discussionCreatedAt)
      : discussionCreatedAt.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(d)) return false;
  return a - d < TURN_ZERO_WINDOW_MS;
}

// Numeric sort key for a timestamp: parsed epoch ms, or Infinity for the
// locally-streamed tail (messages whose createdAt hasn't landed from the server
// yet). Infinity sorts last, preserving input order among themselves via the
// stable sort below.
function key(ts: string | undefined): number {
  if (!ts) return Infinity;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : Infinity;
}

/**
 * Interleave messages and attachment events into a single ordered timeline.
 *
 * Placement rule for an event: it inserts just before the first message whose
 * createdAt is >= the event's. This lands a follow-up-attached book between the
 * user message that attached it and the assistant reply of that same turn
 * (user msg → attachment → assistant msg are created in that order within one
 * request, so the event timestamp sits between the two messages). Locally-
 * streamed messages (undefined createdAt) sort last and never receive an event
 * before them — correct, because no new event exists during the streaming window.
 *
 * Stable: equal-key items keep input order (messages in array order, events in
 * the order passed in — callers should pre-sort events by createdAt asc).
 */
export function mergeTimeline<M extends { createdAt?: string }>(
  messages: readonly M[],
  events: readonly TimelineEvent[],
): TimelineSlot<M>[] {
  // ponytail: pre-sort events by createdAt asc (stable) so equal-key ordering
  // is predictable regardless of how the caller assembled them.
  const sortedEvents = [...events].sort((a, b) => key(a.createdAt) - key(b.createdAt));
  const slots: TimelineSlot<M>[] = [];
  let ei = 0;
  for (let mi = 0; mi < messages.length; mi++) {
    const mKey = key(messages[mi].createdAt);
    // Insert every event that belongs BEFORE this message: event key <= message
    // key. The `<=` (not `<`) covers same-millisecond ties by placing the event
    // ahead of the bracketing assistant reply, which matches the semantic
    // "attached with this turn" read.
    while (ei < sortedEvents.length && key(sortedEvents[ei].createdAt) <= mKey) {
      slots.push({ type: "event", event: sortedEvents[ei] });
      ei++;
    }
    slots.push({ type: "message", index: mi, message: messages[mi] });
  }
  // Tail: events whose key exceeds every message's (or messages have undefined
  // createdAt = Infinity). Appended in sorted order at the end.
  while (ei < sortedEvents.length) {
    slots.push({ type: "event", event: sortedEvents[ei] });
    ei++;
  }
  return slots;
}
