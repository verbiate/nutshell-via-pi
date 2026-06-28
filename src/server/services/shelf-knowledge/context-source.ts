import type { BuiltPrompt } from "@/server/services/prompt-builder";
import type { ContextSourceStrategy } from "./types";

/**
 * ponytail: Plan 1 stub. Returns an honest "engine not connected" system prompt
 * so the full shelf-discussion plumbing (create → persist → stream → list →
 * follow-up) is testable end-to-end before the OKF engine (Plan 2) exists.
 * The first answer will explain the feature is wired but awaiting the engine.
 *
 * Plan 2 replaces the returned instance with OkfContextSource; Plan 3's admin
 * toggle selects between OKF/RAG here. Callers never change.
 */
class StubContextSource implements ContextSourceStrategy {
  async isReady(): Promise<boolean> {
    return true;
  }
  async buildContext(args: {
    question: string;
    userId: string;
    accessibleBookIds: string[];
  }): Promise<BuiltPrompt> {
    const n = args.accessibleBookIds.length;
    const systemPrompt = [
      "You are Nutshell's 'ask your bookshelf' assistant.",
      "The whole-library knowledge engine is wired but NOT YET CONNECTED — you cannot see any of the reader's books and have no knowledge of their contents.",
      `The reader has ${n} book${n === 1 ? "" : "s"} on their shelf, but you do not know their titles, authors, or contents.`,
      "Do NOT guess, invent, or recommend books — you have no way to know what is on this shelf, so any title you name will be a fabrication.",
      "Be brief and honest: tell the reader that whole-shelf answers arrive once the knowledge base is built (an admin can build it from the admin panel), and that this thread will work normally once that's done.",
    ].join("\n");
    return {
      prompt: systemPrompt,
      sourceText: "",   // stub: no compiled knowledge yet
      bookText: "",
      // ponytail: synthetic md5 — shelf discussions don't use the explainer
      // cache (like blank discussions), so this only feeds a hash that's never
      // looked up. Hashing the user id keeps per-user rows distinct.
      bookMd5: `shelf:${args.userId}`,
      promptVersion: 1,
    };
  }
}

export function getContextSource(): ContextSourceStrategy {
  // Plan 2: return new OkfContextSource();  Plan 3: select on AppSetting.
  return new StubContextSource();
}
