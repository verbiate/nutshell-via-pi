import type { BuiltPrompt } from "@/server/services/prompt-builder";
import type { ContextSourceStrategy } from "./types";
import { answerShelfQuestion } from "./query";
import { wikiExists } from "./wiki-storage";

// ponytail: promptVersion bumped from the Plan 1 stub's 1 so any cached
// shelf-discussion context hash differs — shelf discussions don't cache
// explainers, but this is correct hygiene. Bump again if this mapping or
// the underlying query prompt shape changes.
const OKF_CONTEXT_PROMPT_VERSION = 2;

/**
 * Real ContextSourceStrategy backed by the OKF wiki engine. `isReady()` reflects
 * wiki existence; `buildContext` delegates to the progressive-disclosure query
 * pipeline and maps the result into the BuiltPrompt shape that the existing
 * streamShelfFirstTurn / rebuildSystemPrompt flow already consumes.
 *
 * Plan 3's OKF/RAG toggle selects between this and (Stage 2) RagContextSource
 * inside getContextSource().
 */
export class OkfContextSource implements ContextSourceStrategy {
  async isReady(): Promise<boolean> {
    // index.md is the query entry point — its presence means the wiki has been
    // built. The service layer turns a false here into an error event.
    return wikiExists("index.md");
  }

  async buildContext(args: {
    question: string;
    userId: string;
    accessibleBookIds: string[];
    history?: { role: "user" | "assistant"; content: string }[];
  }): Promise<BuiltPrompt> {
    const answer = await answerShelfQuestion({
      question: args.question,
      accessibleBookIds: args.accessibleBookIds,
      history: args.history,
    });
    return {
      prompt: answer.prompt,
      sourceText: answer.sourceText,
      bookText: answer.sourceText,
      bookMd5: answer.bookMd5,
      promptVersion: OKF_CONTEXT_PROMPT_VERSION,
    };
  }
}
