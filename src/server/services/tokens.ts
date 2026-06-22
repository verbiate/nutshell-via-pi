// ponytail: cl100k_base is the GPT-3.5/4 BPE; also the de-facto approximation
// for Claude / Llama / Gemini English (within ~5-10%). For GPT-4o's o200k_base
// we'd be slightly off; acceptable for an advisory indicator. If we ever need
// per-model encodings, swap to a Map<model, encoding> here.
import { countTokens as _countTokens } from "gpt-tokenizer/encoding/cl100k_base";

export function countTokens(text: string): number {
  if (!text) return 0;
  // ponytail: encode() is sync and handles arbitrary-length input internally
  // (it chunks under the hood). For a typical 1MB book this is ~100ms on cold
  // cache; faster warm.
  return _countTokens(text);
}
