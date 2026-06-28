import type { BuiltPrompt } from "@/server/services/prompt-builder";

/**
 * A context source backs a "shelf" discussion. Given the user's question and
 * their accessible book set, it returns a BuiltPrompt whose prompt/sourceText
 * the normal streamChat flow consumes — identical shape to book/section/passage,
 * so nothing downstream of prompt assembly changes.
 *
 * Stage 1 ships OkfContextSource (Plan 2). Stage 2 adds RagContextSource; the
 * admin OKF/RAG toggle selects which instance getContextSource() returns.
 */
export interface ContextSourceStrategy {
  /** Whether the backing knowledge base is built and ready to answer. */
  isReady(): Promise<boolean>;
  /**
   * Build the system context for one turn. `accessibleBookIds` is the user's
   * UserBookAccess-derived set; the source MUST only draw from those books.
   */
  buildContext(args: {
    question: string;
    userId: string;
    accessibleBookIds: string[];
  }): Promise<BuiltPrompt>;
}

export interface ShelfLlmConfig {
  apiKey: string;
  model: string;
}

// ponytail: JSON the LLM emits during compile (Plan 2). The script renders
// markdown from this — the LLM never writes markdown directly, so dangling
// links are impossible by construction. Defined here so Plan 2 doesn't move it.
export interface OkfConcept {
  conceptType: string;          // "theme" | "character" | "argument" | ...
  title: string;
  bodyFields: Record<string, string>;
  relatedConceptNames: string[];// resolved to valid links by the renderer
  sourceBookId: string;
  topic: string;
  form: "narrative" | "nonfiction" | "unknown";
}
