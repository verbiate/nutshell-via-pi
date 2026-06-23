export interface ChunkOptions {
  softLimit: number;
  hardLimit: number;
}

export const CHUNK_LIMITS = {
  kokoro: { softLimit: 400, hardLimit: 500 },
  supertonic: { softLimit: 400, hardLimit: 500 },
  cloud: { softLimit: 4500, hardLimit: 5000 },
  browser: { softLimit: 400, hardLimit: 500 },
} as const;

const SENTENCE_RE = /.*?(?:[.!?]+["')\]]*(?=\s|$)|$)/gs;

function splitSentences(text: string): string[] {
  return Array.from(text.matchAll(SENTENCE_RE))
    .map((m) => m[0].trim())
    .filter(Boolean);
}

function findCascadeSplit(text: string, hardLimit: number): number {
  const slice = text.slice(0, hardLimit);

  // ponytail: last sentence terminator before hardLimit
  for (let i = slice.length - 1; i >= 0; i--) {
    if (/[.!?]/.test(slice[i])) {
      return i + 1;
    }
  }

  // ponytail: clause boundaries, preferring larger first chunk
  const clauseBoundaries = ["\n\n", "\n", ";", ":", ",", "—", "-"];
  for (const boundary of clauseBoundaries) {
    const idx = slice.lastIndexOf(boundary);
    if (idx !== -1) {
      return idx + boundary.length;
    }
  }

  // ponytail: last whitespace before hardLimit
  for (let i = slice.length - 1; i >= 0; i--) {
    if (/\s/.test(slice[i])) {
      return i + 1;
    }
  }

  // ponytail: hard cut floor
  return hardLimit;
}

function cascadeSplit(longSentence: string, hardLimit: number): string[] {
  const chunks: string[] = [];
  let remaining = longSentence;

  while (remaining.length > hardLimit) {
    const splitAt = findCascadeSplit(remaining, hardLimit);
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

export function chunkText(text: string, opts: ChunkOptions): string[] {
  const { softLimit, hardLimit } = opts;
  const sentences = splitSentences(text);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > hardLimit) {
      if (current.length > 0) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...cascadeSplit(sentence, hardLimit));
      continue;
    }

    if (current.length === 0) {
      current = sentence;
      continue;
    }

    const joinedLen = current.length + 1 + sentence.length;
    if (joinedLen <= softLimit) {
      current += " " + sentence;
    } else if (current.length < softLimit && joinedLen <= hardLimit) {
      // ponytail: extend to hardLimit only when still under softLimit
      current += " " + sentence;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function demo(): void {
  const short = "Hello world. This is a test. Another sentence here.";
  const long = "A".repeat(600);
  const paragraphs = "First paragraph.\n\nSecond paragraph with more words. And a third.";

  const results = [
    chunkText(short, CHUNK_LIMITS.kokoro),
    chunkText(long, CHUNK_LIMITS.kokoro),
    chunkText(paragraphs, CHUNK_LIMITS.kokoro),
  ];

  for (const r of results) {
    console.log("chunks:", r.length, "max:", Math.max(...r.map((c) => c.length)));
  }
}

if (process.env.NODE_ENV !== "production") {
  demo();
}
