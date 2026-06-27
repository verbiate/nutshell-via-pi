import { describe, it, expect } from "vitest";
import { isTurnZeroAttachment, mergeTimeline, type TimelineEvent } from "../timeline";

type M = { role: "user" | "assistant"; content: string; createdAt?: string };
const um = (content: string, createdAt?: string): M => ({ role: "user", content, createdAt });
const am = (content: string, createdAt?: string): M => ({ role: "assistant", content, createdAt });
const ev = (createdAt: string, label = "e"): TimelineEvent => ({
  kind: "book-added",
  createdAt,
  label,
});

const T0 = "2026-06-01T12:00:00.000Z";
const sec = (n: number) => `2026-06-01T12:00:${String(n).padStart(2, "0")}.000Z`;
const ms = (base: string, delta: number) =>
  new Date(Date.parse(base) + delta).toISOString();

describe("isTurnZeroAttachment", () => {
  it("true within the 30s creation window", () => {
    expect(isTurnZeroAttachment(ms(T0, 5_000), T0)).toBe(true);
    expect(isTurnZeroAttachment(ms(T0, 29_999), T0)).toBe(true);
  });

  it("false once the attachment lands later than the window", () => {
    expect(isTurnZeroAttachment(ms(T0, 30_001), T0)).toBe(false);
    expect(isTurnZeroAttachment(sec(45), T0)).toBe(false);
  });

  it("false (does not suppress) when timestamps are unparseable", () => {
    expect(isTurnZeroAttachment("not-a-date", T0)).toBe(false);
    expect(isTurnZeroAttachment(T0, "garbage")).toBe(false);
  });
});

describe("mergeTimeline", () => {
  it("returns empty for no input", () => {
    expect(mergeTimeline([], [])).toEqual([]);
  });

  it("passes messages through when there are no events", () => {
    const msgs = [um("hi", T0), am("hey", ms(T0, 1))];
    const out = mergeTimeline(msgs, []);
    expect(out).toEqual([
      { type: "message", index: 0, message: msgs[0] },
      { type: "message", index: 1, message: msgs[1] },
    ]);
  });

  it("inserts a follow-up attachment between the user msg and the assistant reply of that turn", () => {
    // Turn 2 attaches a book: user msg T2, attachment T2+δ, assistant T2+2δ.
    const T1 = ms(T0, 1_000);
    const T2 = ms(T0, 60_000);
    const msgs = [
      um("first", T1),
      am("reply1", ms(T1, 1)),
      um("second + attach", T2),
      am("reply2", ms(T2, 2)),
    ];
    const e = ev(ms(T2, 1), "Attached Book");
    const out = mergeTimeline(msgs, [e]);
    expect(out.map((s) => s.type)).toEqual([
      "message",
      "message",
      "message", // u2
      "event", // attachment sits between u2 and reply2
      "message", // reply2
    ]);
    const evtSlot = out[3];
    expect(evtSlot.type).toBe("event");
    if (evtSlot.type === "event") expect(evtSlot.event.label).toBe("Attached Book");
  });

  it("places an event at the top when its createdAt <= the first message", () => {
    const msgs = [um("hi", ms(T0, 5_000)), am("hey", ms(T0, 6_000))];
    const out = mergeTimeline(msgs, [ev(T0, "early")]);
    expect(out[0].type).toBe("event");
  });

  it("appends an event at the end when its createdAt exceeds every message", () => {
    const msgs = [um("hi", T0)];
    const out = mergeTimeline(msgs, [ev(ms(T0, 9_000), "late")]);
    expect(out[out.length - 1].type).toBe("event");
  });

  it("sorts multiple events into their respective gaps", () => {
    const T1 = ms(T0, 1_000);
    const T2 = ms(T0, 60_000);
    const T3 = ms(T0, 120_000);
    const msgs = [
      um("a", T1),
      am("A", ms(T1, 1)),
      um("b", T2),
      am("B", ms(T2, 1)),
      um("c", T3),
      am("C", ms(T3, 1)),
    ];
    // e1 belongs to turn 2, e2 to turn 3. Pass them OUT of order to confirm sorting.
    const out = mergeTimeline(msgs, [ev(ms(T3, 1), "e3"), ev(ms(T2, 1), "e2")]);
    const labels = out
      .filter((s) => s.type === "event")
      .map((s) => (s.type === "event" ? s.event.label : ""));
    expect(labels).toEqual(["e2", "e3"]);
  });

  it("treats locally-streamed messages (undefined createdAt) as the tail", () => {
    const T1 = ms(T0, 1_000);
    const msgs = [um("persisted", T1), um("streaming"), am("streaming too")];
    // An event older than T1 still inserts before the persisted message, never
    // before the undefined-createdAt tail.
    const out = mergeTimeline(msgs, [ev(T0, "early")]);
    expect(out[0].type).toBe("event");
    expect(out[1].type).toBe("message");
    // Tail messages retain input order after the event + persisted message.
    expect(out.slice(2).every((s) => s.type === "message")).toBe(true);
  });

  it("preserves input order for equal-timestamp events (stable)", () => {
    const msgs = [um("hi", T0)];
    const out = mergeTimeline(msgs, [ev(T0, "first"), ev(T0, "second")]);
    // Both events share T0 with the message; with `<=` they insert before it,
    // in input order.
    expect(out.map((s) => (s.type === "event" ? s.event.label : "msg"))).toEqual([
      "first",
      "second",
      "msg",
    ]);
  });
});
