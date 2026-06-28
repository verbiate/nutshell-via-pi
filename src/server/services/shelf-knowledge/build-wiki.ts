import { db } from "@/server/db";
import { setSetting } from "../settings";
import { extractBookConcepts } from "./extract";
import { clusterByTopic } from "./cluster";
import { synthesizeClusterTheme } from "./synthesize";
import { conceptToMarkdown, themeToMarkdown, buildIndex } from "./render";
import {
  writeWikiFile,
  listWikiFiles,
  removeWikiFile,
} from "./wiki-storage";
import { getShelfLlmConfig } from "./config";
import type { OkfClusterTheme, OkfConcept } from "./types";

const STATUS_KEY = "shelfWikiStatus";

export interface PreviewResult {
  bookCount: number;
  totalTxtTokens: number;
  extractionCalls: number;  // one whole-book LLM call per book
  synthesisCalls: number;
  model: string;
}

/**
 * Pure estimate, ZERO LLM/spend. The cost gate depends on this never calling
 * extract/synthesize/render/completeJson — it only counts books + tokens the
 * engine WOULD consume and reports the configured model name.
 */
export async function preview(): Promise<PreviewResult> {
  const books = await db.epubFile.findMany({
    select: {
      txtTokens: true,
    },
  });
  const totalTxtTokens = books.reduce(
    (sum, b) => sum + (b.txtTokens ?? 0),
    0,
  );
  const cfg = await getShelfLlmConfig();
  const bookCount = books.length;
  // ponytail: extraction is one whole-book call per book (long-context model).
  // Real cluster count can't be known without extracting (topics are LLM-emitted);
  // estimate = min(books, ceil(books/3)). Revisit once extraction runs.
  const synthesisCalls = Math.min(bookCount, Math.ceil(bookCount / 3));
  return {
    bookCount,
    totalTxtTokens,
    extractionCalls: bookCount,
    synthesisCalls,
    model: cfg.model,
  };
}

export interface BuildResult {
  concepts: number;
  themes: number;
  files: number;
}

type Progress = (stage: string, detail: unknown) => void;

async function setStatus(state: string, extra: Record<string, unknown> = {}) {
  await setSetting(
    STATUS_KEY,
    JSON.stringify({ state, at: new Date().toISOString(), ...extra }),
  );
}

export async function build(opts?: {
  onProgress?: Progress;
}): Promise<BuildResult> {
  // ponytail: in-process mutex. The Next app runs in a single Node process, so
  // a module-level guard reliably serializes builds (concurrent uploads'
  // auto-rebuild hooks share ONE build instead of interleaving file writes).
  // Ceiling: multi-process deploys (e.g. PM2 cluster, serverless) would race on
  // this var — those need a DB-level compare-and-set on shelfWikiStatus inside
  // a transaction. Upgrade path: replace `buildInFlight` with a Prisma atomic
  // claim (UPDATE ... WHERE state <> 'building').
  if (buildInFlight) return buildInFlight;

  buildInFlight = (async () => {
    const onProgress = opts?.onProgress;
    const emit = (stage: string, detail: unknown) => onProgress?.(stage, detail);

    await setStatus("building");
    emit("start", {});

    try {
      const books = await db.epubFile.findMany({ include: { bookMetadata: true } });

      // 1. extract per book
      const perBook: {
        bookId: string;
        bookTitle: string;
        concepts: OkfConcept[];
        topic: string;
      }[] = [];
      for (let i = 0; i < books.length; i++) {
        const book = books[i];
        const res = await extractBookConcepts(book);
        perBook.push({
          bookId: book.id,
          bookTitle: book.title,
          concepts: res.concepts,
          topic: res.topic,
        });
        emit("extract", { bookId: book.id, index: i, total: books.length });
      }

      // 2. cluster
      const clusters = clusterByTopic(
        perBook.map((p) => ({ bookId: p.bookId, topic: p.topic })),
      );
      emit("cluster", { clusterCount: clusters.length });

      // 3. synthesize per cluster
      const byBookId = new Map(perBook.map((p) => [p.bookId, p]));
      const themes: OkfClusterTheme[] = [];
      for (let i = 0; i < clusters.length; i++) {
        const cluster = clusters[i];
        const bookConcepts = cluster.bookIds.map((id) => {
          const p = byBookId.get(id)!;
          return { bookId: id, bookTitle: p.bookTitle, concepts: p.concepts };
        });
        const theme = await synthesizeClusterTheme({
          topic: cluster.topic,
          bookConcepts,
        });
        themes.push(theme);
        emit("synthesize", { topic: cluster.topic, index: i, total: clusters.length });
      }

      // 4. render
      const allConcepts = perBook.flatMap((p) => p.concepts);
      const renderedConcepts = allConcepts.map(conceptToMarkdown);
      // ponytail: the union of all concept relPaths — themeToMarkdown renders a
      // link ONLY for ids in this set, so links resolve to existing files.
      const knownConceptRelPaths = new Set(renderedConcepts.map((r) => r.relPath));

      // ponytail: clear concepts/ + themes/ only. We NEVER list or remove under
      // .cache/ — that holds extract/synthesize LLM cache the build just warmed.
      // Upgrade to dir-scoped wipe if list() gets slow on huge wikis.
      emit("render", { phase: "clear" });
      const stale = [
        ...(await listWikiFiles("concepts")),
        ...(await listWikiFiles("themes")),
      ];
      await Promise.all(stale.map((rel) => removeWikiFile(rel)));

      let files = 0;
      for (const r of renderedConcepts) {
        await writeWikiFile(r.relPath, r.body);
        files++;
      }
      for (const t of themes) {
        const r = themeToMarkdown(t, knownConceptRelPaths);
        await writeWikiFile(r.relPath, r.body);
        files++;
      }
      const index = buildIndex({ concepts: allConcepts, themes });
      await writeWikiFile(index.relPath, index.body);
      files++;

      const counts = {
        concepts: allConcepts.length,
        themes: themes.length,
        files,
      };
      await setStatus("done", { counts });
      emit("done", { counts });
      return counts;
    } catch (err) {
      await setStatus("error", {
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  })();

  try {
    return await buildInFlight;
  } finally {
    buildInFlight = null;
  }
}

// ponytail: module-level in-process build mutex; see comment at top of build().
let buildInFlight: Promise<BuildResult> | null = null;
