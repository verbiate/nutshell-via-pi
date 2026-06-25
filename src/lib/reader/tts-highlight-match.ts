const WHITESPACE_RE = /\s+/g;

function norm(s: string): string {
  return s.replace(WHITESPACE_RE, " ").trim();
}

// ponytail: probe offsets in document order. Offset 0 matches when a chunk
// starts inside a block; later offsets recover when the leading needle spans a
// block boundary (e.g. a short heading chunked together with the next
// paragraph), skipping the leading short block so we land on the body text
// actually being read. 25 chars is distinctive yet rarely crosses a boundary.
const OFFSETS = [0, 15, 30, 50] as const;
const NEEDLE_LEN = 25;

export function pickTtsTargetIndex(chunk: string, blockTexts: string[]): number {
  const c = norm(chunk);
  for (const off of OFFSETS) {
    const needle = c.slice(off, off + NEEDLE_LEN);
    if (needle.trim().length < 8) continue;
    for (let i = 0; i < blockTexts.length; i++) {
      const bt = norm(blockTexts[i] ?? "");
      if (bt.length < 3) continue;
      if (bt.includes(needle)) return i;
    }
  }
  return -1;
}

// Char span [start, end) of the chunk within an already-normalized block text,
// or null if no overlap. Same offset-probing as pickTtsTargetIndex; once a
// needle is located the chunk's start is back-derived and the end clamped to
// the block (trailing periods the chunker added can overshoot by a char or two,
// which the clamp absorbs).
export function findChunkRange(
  chunk: string,
  blockNormText: string,
): { start: number; end: number } | null {
  const c = norm(chunk);
  const b = norm(blockNormText);
  if (!c || !b) return null;

  // ponytail: anchor START by probing leading needles at a few offsets. A
  // needle that straddles a block boundary or a punctuation mismatch still
  // recovers the true start via i - off, clamped to 0.
  let start = -1;
  for (const off of OFFSETS) {
    const needle = c.slice(off, off + NEEDLE_LEN);
    if (needle.trim().length < 8) continue;
    const i = b.indexOf(needle);
    if (i >= 0) {
      start = Math.max(0, i - off);
      break;
    }
  }
  if (start < 0) return null;

  // ponytail: anchor END by the chunk's trailing text instead of trusting
  // start + c.length. htmlToTtsText adds terminal periods (and strips trailing
  // clause punctuation) per block, so c.length drifts from the real DOM span.
  // That char-count end overshoots into the next chunk's first word. Strip the
  // chunk's own trailing terminator, take the last ~25 chars, and find them
  // forward from start, then re-include any terminator punctuation that follows
  // so the mark covers the full-stop. Stop at the first whitespace so we never
  // overshoot into the next chunk's first word. Fall back to char count if the
  // tail can't be located.
  let end = Math.min(b.length, start + c.length);
  const cBody = c.replace(/[^0-9A-Za-z]+$/, "");
  if (cBody.length >= 8) {
    const tailLen = Math.min(NEEDLE_LEN, cBody.length);
    const tail = cBody.slice(cBody.length - tailLen);
    const i = b.indexOf(tail, start);
    if (i >= start) {
      let e = i + tail.length;
      while (e < b.length && /[.!?…,;:""')\]]/.test(b[e])) e++;
      end = Math.min(b.length, e);
    }
  }

  if (end > start) return { start, end };
  return null;
}

export interface CharPos {
  node: Text;
  offset: number;
}

export interface TextMap {
  text: string;
  positions: CharPos[];
}

const WS_CHARS = new Set([" ", "\n", "\t", "\r", "\f", "\v"]);

// Walk the block's text nodes into a whitespace-normalized string with a
// per-character map back to (node, offset), so a Range can be built over the
// exact spoken span even when it crosses inline elements like <em>/<a>.
export function buildTextMap(doc: Document, root: HTMLElement): TextMap {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const positions: CharPos[] = [];
  const chars: string[] = [];
  let lastWasSpace = false;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const value = node.nodeValue ?? "";
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (WS_CHARS.has(ch)) {
        if (!lastWasSpace) {
          chars.push(" ");
          positions.push({ node, offset: i });
          lastWasSpace = true;
        }
      } else {
        chars.push(ch);
        positions.push({ node, offset: i });
        lastWasSpace = false;
      }
    }
    node = walker.nextNode() as Text | null;
  }
  // trim to match norm()
  while (chars.length > 0 && chars[0] === " ") {
    chars.shift();
    positions.shift();
  }
  while (chars.length > 0 && chars[chars.length - 1] === " ") {
    chars.pop();
    positions.pop();
  }
  return { text: chars.join(""), positions };
}

// Wrap [start, end) of the map in a <mark class="tts-chunk">. Returns the mark
// or null if the range can't be formed (caller falls back to block-level).
export function wrapMark(
  doc: Document,
  map: TextMap,
  start: number,
  end: number,
): HTMLElement | null {
  if (map.positions.length === 0) return null;
  const s = Math.max(0, Math.min(start, map.positions.length - 1));
  const eIdx = Math.min(Math.max(end, s + 1), map.positions.length);
  if (eIdx <= s) return null;
  const startPos = map.positions[s];
  const lastCovered = map.positions[eIdx - 1];
  try {
    const range = doc.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(lastCovered.node, lastCovered.offset + 1);
    const contents = range.extractContents();
    const mark = doc.createElement("mark");
    mark.className = "tts-chunk";
    mark.appendChild(contents);
    range.insertNode(mark);
    return mark;
  } catch {
    return null;
  }
}

// Remove every <mark class="tts-chunk">, restoring the original text nodes.
export function unwrapMarks(doc: Document): void {
  const marks = doc.querySelectorAll("mark.tts-chunk");
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });
  doc.body?.normalize();
}

export const TTS_BLOCK_SELECTOR = "p, div, h1, h2, h3, h4, h5, h6, li, blockquote";

// Nearest block-level ancestor of the char at `index` in the map. Used to split
// a range that crosses block boundaries into one mark per block.
export function positionBlock(map: TextMap, index: number): Element | null {
  const pos = map.positions[index];
  if (!pos) return null;
  let el: Element | null = pos.node.parentElement;
  while (el && !el.matches(TTS_BLOCK_SELECTOR)) el = el.parentElement;
  return el;
}

// Wrap [start, end) of the map, creating a separate <mark class="tts-chunk"> in
// each block the span crosses. Per-block marks keep epub.js's column layout
// intact — a single mark across paragraph boundaries would flatten them inline.
// Returns the number of marks created. Build the map over the section body so a
// chunk covering a heading + paragraph is fully marked, not just its tail.
export function wrapRangePerBlock(
  doc: Document,
  map: TextMap,
  start: number,
  end: number,
): number {
  if (map.positions.length === 0) return 0;
  const s = Math.max(0, Math.min(start, map.positions.length - 1));
  const e = Math.min(Math.max(end, s + 1), map.positions.length);
  if (e <= s) return 0;

  let count = 0;
  let runStart = s;
  let runBlock = positionBlock(map, s);
  const flush = (runEndExclusive: number) => {
    if (runEndExclusive <= runStart) return;
    // ponytail: whitespace text nodes sitting directly in body (between
    // </h1> and <p>) have no owning block — skip them so we don't spawn a
    // bogus empty mark or drag a Range across a block boundary.
    if (runBlock === null) return;
    if (wrapMark(doc, map, runStart, runEndExclusive)) count++;
  };

  for (let i = s + 1; i < e; i++) {
    const blk = positionBlock(map, i);
    if (blk !== runBlock) {
      flush(i);
      runStart = i;
      runBlock = blk;
    }
  }
  flush(e);
  return count;
}

// ponytail: index of the first character whose rect overlaps the visible page
// window [visLeft, visRight), or -1 if none. rect.left wraps at each CSS column
// so it isn't globally monotonic — can't binary-search. Step-sample (stride) to
// bracket the page boundary, then linear-scan that window for the true first
// on-page char. Caps rectAt calls at ~n/stride + stride even for long
// paragraphs. Used by the reader's "Start reading from here" to land on the
// sentence/clause actually visible at the page top (the chunk containing this
// char is where playback begins), instead of the next sentence start or — for a
// single long sentence spanning the boundary — a whole page back.
export function findFirstVisibleCharIndex(
  n: number,
  rectAt: (i: number) => DOMRect | null,
  visLeft: number,
  visRight: number,
  stride = 16,
): number {
  if (n <= 0) return -1;
  const onVis = (r: DOMRect | null): boolean =>
    !!r && r.right > visLeft && r.left < visRight;
  let sampled = -1;
  for (let i = 0; i < n; i += stride) {
    if (onVis(rectAt(i))) {
      sampled = i;
      break;
    }
  }
  if (sampled < 0) return -1;
  // Refine: the true first on-page char is in [sampled - stride, sampled]; scan
  // that window forward to find the earliest one.
  for (let i = Math.max(0, sampled - stride); i < sampled; i++) {
    if (onVis(rectAt(i))) return i;
  }
  return sampled;
}
