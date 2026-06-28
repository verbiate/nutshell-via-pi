import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// ponytail: shelf prompt contents captured verbatim from
// src/server/services/shelf-knowledge/{extract,query}.ts. Kept as module-level
// consts so they read like the in-code constants they mirror and stay diffable
// against the source of truth. Edit the source constants AND these when
// changing default behavior; bump version on content changes.
const NARRATIVE_PROMPT_CONTENT = `You are extracting concepts from a work of narrative fiction (a novel, story cycle, memoir, or narrative book).

Read the ENTIRE BOOK below in full and extract its ~10-12 MOST IMPORTANT, book-level concepts — the characters, themes, settings, plot arcs, and symbols a reader would revisit and that other books on this shelf might echo. These must be coherent whole-book concepts, not passage-local mentions.

Return ONLY valid JSON matching this exact schema:

{
  "topic": "<2-4 word shelf topic this book belongs to, e.g. 'coming of age' or 'space exploration'>",
  "concepts": [
    {
      "conceptType": "character" | "theme" | "setting" | "plotArc" | "symbol",
      "title": "<concise canonical name>",
      "bodyFields": { "<FieldName>": "<value>" },
      "relatedConceptNames": ["<exact title of another concept in this book>"]
    }
  ]
}

Use these conceptType vocabularies and their bodyFields:
- character  → { "role": "...", "description": "...", "arc": "..." }
- theme      → { "description": "...", "expression": "where it shows up" }
- setting    → { "description": "...", "significance": "..." }
- plotArc    → { "summary": "...", "beats": "key turning points" }
- symbol     → { "meaning": "...", "occurrences": "..." }

Aim for ~10-12 concepts — this is a HARD CAP: never exceed 12. Each concept must be significant enough that a reader would revisit it; skip minor mentions. Quality over quantity. Keep every bodyField value to ONE sentence (max ~25 words). Cross-reference related concepts via relatedConceptNames using the EXACT title of another concept in this book. Do not invent sourceBookId, topic, or form — those are stamped by the caller.

BOOK TEXT:
`;

const NONFICTION_PROMPT_CONTENT = `You are extracting concepts from a nonfiction work (essay collection, textbook, treatise, investigative book, or exposition).

Read the ENTIRE BOOK below in full and extract its ~10-12 MOST IMPORTANT, book-level concepts — the arguments, frameworks, evidence, key concepts, and definitions a reader would want to revisit and that other books on this shelf might engage. These must be coherent whole-book concepts, not passage-local mentions.

Return ONLY valid JSON matching this exact schema:

{
  "topic": "<2-4 word shelf topic this book belongs to, e.g. 'cognitive science' or 'economic history'>",
  "concepts": [
    {
      "conceptType": "argument" | "framework" | "evidence" | "keyConcept" | "definition",
      "title": "<concise canonical name>",
      "bodyFields": { "<FieldName>": "<value>" },
      "relatedConceptNames": ["<exact title of another concept in this book>"]
    }
  ]
}

Use these conceptType vocabularies and their bodyFields:
- argument    → { "claim": "...", "support": "..." }
- framework   → { "description": "...", "components": "..." }
- evidence    → { "finding": "...", "method": "..." }
- keyConcept  → { "definition": "...", "significance": "..." }
- definition  → { "term": "...", "definition": "..." }

Aim for ~10-12 concepts — this is a HARD CAP: never exceed 12. Each concept must be significant enough that a reader would revisit it; skip minor mentions. Quality over quantity. Keep every bodyField value to ONE sentence (max ~25 words). Cross-reference related concepts via relatedConceptNames using the EXACT title of another concept in this book. Do not invent sourceBookId, topic, or form — those are stamped by the caller.

BOOK TEXT:
`;

const GENERIC_PROMPT_CONTENT = `You are extracting concepts from a book whose form is unknown — it may be narrative fiction or nonfiction.

FIRST, read the ENTIRE BOOK below in full and infer whether it is primarily NARRATIVE (fiction/memoir/story) or NONFICTION (exposition/argument/reference). Then extract its ~10-12 MOST IMPORTANT, book-level concepts appropriate to that form — the kind a reader would revisit and that other books on this shelf might engage. These must be coherent whole-book concepts, not passage-local mentions.

Return ONLY valid JSON matching this exact schema:

{
  "topic": "<2-4 word shelf topic this book belongs to>",
  "form": "narrative" | "nonfiction",
  "concepts": [
    {
      "conceptType": "<see vocabularies below>",
      "title": "<concise canonical name>",
      "bodyFields": { "<FieldName>": "<value>" },
      "relatedConceptNames": ["<exact title of another concept in this book>"]
    }
  ]
}

If you inferred NARRATIVE, use these conceptTypes and bodyFields:
- character → { "role", "description", "arc" }
- theme     → { "description", "expression" }
- setting   → { "description", "significance" }
- plotArc   → { "summary", "beats" }
- symbol    → { "meaning", "occurrences" }

If you inferred NONFICTION, use these instead:
- argument   → { "claim", "support" }
- framework  → { "description", "components" }
- evidence   → { "finding", "method" }
- keyConcept → { "definition", "significance" }
- definition → { "term", "definition" }

The "form" field is REQUIRED — your inference backfills this book's classification. Aim for ~10-12 concepts — HARD CAP, never exceed 12. Each concept must be significant enough that a reader would revisit it; skip minor mentions. Quality over quantity. Keep every bodyField value to ONE sentence (max ~25 words). Cross-reference related concepts via relatedConceptNames using the EXACT title of another concept in this book. Do not invent sourceBookId or topic — those are stamped by the caller.

BOOK TEXT:
`;

// ponytail: nav/answer templates mirror buildNavPrompt/buildAnswerPrompt in
// query.ts. Dynamic parts become {{listing}}/{{question}}/{{concept_excerpts}}
// /{{conversation}} placeholders (substitution wired up in query.ts). "at most
// 5" inlines MAX_CONCEPTS since that's what the LLM literally receives today.
// {{conversation}} is "" on turn 1; on follow-ups it carries the last ~6 turns
// so a question like "deep links for that?" routes to the right concepts.
const SHELF_NAV_PROMPT_CONTENT = `You are navigating the user's library knowledge base to find concepts relevant to their question.

Available concepts (only from books the user has access to):
{{listing}}
{{conversation}}
User question: {{question}}

Return ONLY valid JSON matching this schema:
{
  "conceptRelPaths": ["<a path from the list above>"]
}

Constraints:
- Every conceptRelPath MUST be one of the exact paths listed above — do not invent or alter them.
- Pick only concepts relevant to answering the question.
- The latest question may refer to something in the recent conversation (e.g. "those", "deep links for that", "the startup one") — pick concepts relevant in that context.
- Select at most 5.
- If none are relevant, return an empty array.`;

const SHELF_ANSWER_PROMPT_CONTENT = `Answer the user's question using ONLY the provided concept excerpts from their library knowledge base.
{{conversation}}
User question: {{question}}

Concept excerpts:
{{concept_excerpts}}

Library manifest — every book the user has access to. Each entry is a ready-to-use link to open the book; copy the (#book:…) href verbatim and reword the label if you like:
{{library_manifest}}

Book index — books cited in the excerpts above (a subset of the library). Each entry is a ready-to-use link to open the book itself; copy the (#book:…) href verbatim and reword the label if you like:
{{book_index}}

Chapter maps for cited books — each entry is a ready-to-use link to a specific chapter; copy the (#ch:…) href verbatim (including the <bookId>: prefix) and reword the label if you like:
{{chapter_maps}}

Weave citations INTO THE VISIBLE REPLY as inline links:
- For a claim about the book as a whole (mentioning the book, its thesis, its author, recommending it), use the book form: [Book Title](#book:<bookId>) with hrefs copied verbatim from the library manifest or book index above. You may mention books from the library manifest when their title or subject is relevant to the question, even if no concept excerpt was read from them — link them with the #book: form. One book-level link per book referenced.
- For a claim grounded in a specific passage, use the chapter form: [Chapter Label](#ch:<bookId>:<basename>) with hrefs copied verbatim from the chapter maps above. One chapter link per grounded claim. Chapter links require a concept excerpt to have been read from that book — do not invent chapter hrefs for books that only appear in the library manifest.
Do NOT add a separate "Sources:" list; the inline links ARE the citations. Do not invent hrefs that are not in the library manifest, book index, or chapter maps.

Answer using ONLY the information in these excerpts plus the book titles in the library manifest. If the excerpts do not contain the answer but a library book's title suggests it may be relevant, say so plainly and link the book. Do not use outside knowledge beyond what the excerpts and titles provide.

Return ONLY valid JSON matching this schema:
{ "answer": "<your grounded answer with inline #book: and #ch: links>" }`;

async function main() {
  // ponytail: prompt templates use {{book_text}} (full book) and {{chosen_text}}
  // (section or passage selection). Book template uses only {{book_text}} since
  // the whole book IS the subject. Section/passage templates include both —
  // the chosen snippet for focus, the full book so the model can honor the
  // "connections to other parts of the book" instruction.
  await prisma.promptTemplate.upsert({
    where: { type: "book" },
    update: {
      content: "You are an expert literary analyst. The user has uploaded a book and wants to understand it deeply.\n\nBook title: {{title}}\nAuthor: {{author}}\nLanguage: {{language}}\n\nBelow is the full text of the book:\n---\n{{book_text}}\n---\n\nPlease provide a comprehensive explanation of this book in {{target_language}}. Cover the main themes, key arguments or plot points, important characters, and the author's style. Help the reader understand not just what happens, but why it matters. Do NOT simply summarize — explain and illuminate.\n\nChapter map — each entry below is a ready-to-use link; copy the (#ch:…) href verbatim and reword the label if you like:\n{{chapter_index}}\n\nWhen you name where something happens — a chapter, section, or scene, or when you answer \"which chapter?\" or \"where does the author …?\" — turn that name into a link by copying an href from the map above, in the exact form [Chapter One](#ch:chapter1.xhtml). One link per location you reference. Do not invent hrefs that are not in the map, and do not add links for locations you did not otherwise mention.",
      version: 5,
    },
    create: {
      type: "book",
      content: "You are an expert literary analyst. The user has uploaded a book and wants to understand it deeply.\n\nBook title: {{title}}\nAuthor: {{author}}\nLanguage: {{language}}\n\nBelow is the full text of the book:\n---\n{{book_text}}\n---\n\nPlease provide a comprehensive explanation of this book in {{target_language}}. Cover the main themes, key arguments or plot points, important characters, and the author's style. Help the reader understand not just what happens, but why it matters. Do NOT simply summarize — explain and illuminate.\n\nChapter map — each entry below is a ready-to-use link; copy the (#ch:…) href verbatim and reword the label if you like:\n{{chapter_index}}\n\nWhen you name where something happens — a chapter, section, or scene, or when you answer \"which chapter?\" or \"where does the author …?\" — turn that name into a link by copying an href from the map above, in the exact form [Chapter One](#ch:chapter1.xhtml). One link per location you reference. Do not invent hrefs that are not in the map, and do not add links for locations you did not otherwise mention.",
      version: 5,
    },
  });

  await prisma.promptTemplate.upsert({
    where: { type: "section" },
    update: {
      content: "You are an expert literary analyst. The user is reading a book and wants to understand a specific section.\n\nBook title: {{title}}\nAuthor: {{author}}\nSection: {{section_title}}\n\nFor context, here is the full text of the book:\n---\n{{book_text}}\n---\n\nThe user wants to understand this specific section:\n---\n{{chosen_text}}\n---\n\nPlease provide a clear explanation of this section in {{target_language}}. Cover what happens or what is argued, why it matters in the context of the whole book, any important themes or symbols, and connections to other parts of the book. Do NOT simply summarize — explain and illuminate.\n\nChapter map — each entry below is a ready-to-use link; copy the (#ch:…) href verbatim and reword the label if you like:\n{{chapter_index}}\n\nWhen you name where something happens — a chapter, section, or scene, or when you answer \"which chapter?\" or \"where does the author …?\" — turn that name into a link by copying an href from the map above, in the exact form [Chapter One](#ch:chapter1.xhtml). One link per location you reference. Do not invent hrefs that are not in the map, and do not add links for locations you did not otherwise mention.",
      version: 4,
    },
    create: {
      type: "section",
      content: "You are an expert literary analyst. The user is reading a book and wants to understand a specific section.\n\nBook title: {{title}}\nAuthor: {{author}}\nSection: {{section_title}}\n\nFor context, here is the full text of the book:\n---\n{{book_text}}\n---\n\nThe user wants to understand this specific section:\n---\n{{chosen_text}}\n---\n\nPlease provide a clear explanation of this section in {{target_language}}. Cover what happens or what is argued, why it matters in the context of the whole book, any important themes or symbols, and connections to other parts of the book. Do NOT simply summarize — explain and illuminate.\n\nChapter map — each entry below is a ready-to-use link; copy the (#ch:…) href verbatim and reword the label if you like:\n{{chapter_index}}\n\nWhen you name where something happens — a chapter, section, or scene, or when you answer \"which chapter?\" or \"where does the author …?\" — turn that name into a link by copying an href from the map above, in the exact form [Chapter One](#ch:chapter1.xhtml). One link per location you reference. Do not invent hrefs that are not in the map, and do not add links for locations you did not otherwise mention.",
      version: 4,
    },
  });

  await prisma.promptTemplate.upsert({
    where: { type: "passage" },
    update: {
      content: "You are an expert literary assistant. Explain the following passage from the book \"{{title}}\" by {{author}} in {{target_language}}. Provide context, key concepts, and any difficult vocabulary.\n\nFor context, here is the full text of the book:\n---\n{{book_text}}\n---\n\nThe passage to explain:\n---\n{{chosen_text}}\n---\n\nChapter map — each entry below is a ready-to-use link; copy the (#ch:…) href verbatim and reword the label if you like:\n{{chapter_index}}\n\nWhen you name where something happens — a chapter, section, or scene, or when you answer \"which chapter?\" or \"where does the author …?\" — turn that name into a link by copying an href from the map above, in the exact form [Chapter One](#ch:chapter1.xhtml). One link per location you reference. Do not invent hrefs that are not in the map, and do not add links for locations you did not otherwise mention.",
      version: 4,
    },
    create: {
      type: "passage",
      content: "You are an expert literary assistant. Explain the following passage from the book \"{{title}}\" by {{author}} in {{target_language}}. Provide context, key concepts, and any difficult vocabulary.\n\nFor context, here is the full text of the book:\n---\n{{book_text}}\n---\n\nThe passage to explain:\n---\n{{chosen_text}}\n---\n\nChapter map — each entry below is a ready-to-use link; copy the (#ch:…) href verbatim and reword the label if you like:\n{{chapter_index}}\n\nWhen you name where something happens — a chapter, section, or scene, or when you answer \"which chapter?\" or \"where does the author …?\" — turn that name into a link by copying an href from the map above, in the exact form [Chapter One](#ch:chapter1.xhtml). One link per location you reference. Do not invent hrefs that are not in the map, and do not add links for locations you did not otherwise mention.",
      version: 4,
    },
  });

  // ponytail: pass-2 refinement template for the two-pass book explainer.
  // Token-pattern: {{previous_response}} is filled with pass-1's hidden output,
  // {{book_text}} lets the model re-ground in the source during refinement.
  // Sent as a single user message via streamExplainer (system persona added
  // internally) — NOT a 4-message chat array anymore.
  // update:{} is intentionally NON-empty: re-running the seed overwrites any
  // prior admin edits to this default so chat-pattern-era content gets migrated
  // forward automatically. Bump version on content changes to invalidate cache.
  await prisma.promptTemplate.upsert({
    where: { type: "book_pass2" },
    update: {
      content: "You are refining a first-draft book explainer. Below is the source book, then a first-draft explanation of it. Rewrite the explanation into a polished, well-structured overview that a reader can absorb quickly.\n\nBook: \"{{title}}\" by {{author}} (source language: {{language}})\nWrite the refined explanation in {{target_language}}.\n\nSource book:\n---\n{{book_text}}\n---\n\nFirst-draft explanation:\n---\n{{previous_response}}\n---\n\nTighten the prose, remove redundancy, and use clear structure where it helps. Preserve the key themes, tone, and insights of the first draft. Do NOT introduce information that was not in the first draft or the source book.\n\nPreserve any [..](#ch:..) citation links present in the first draft verbatim; do not strip or rewrite them.",
      version: 3,
    },
    create: {
      type: "book_pass2",
      content: "You are refining a first-draft book explainer. Below is the source book, then a first-draft explanation of it. Rewrite the explanation into a polished, well-structured overview that a reader can absorb quickly.\n\nBook: \"{{title}}\" by {{author}} (source language: {{language}})\nWrite the refined explanation in {{target_language}}.\n\nSource book:\n---\n{{book_text}}\n---\n\nFirst-draft explanation:\n---\n{{previous_response}}\n---\n\nTighten the prose, remove redundancy, and use clear structure where it helps. Preserve the key themes, tone, and insights of the first draft. Do NOT introduce information that was not in the first draft or the source book.\n\nPreserve any [..](#ch:..) citation links present in the first draft verbatim; do not strip or rewrite them.",
      version: 3,
    },
  });

  // ponytail: global off switch for the two-pass book explainer. Default off
  // so existing behavior is unchanged until an admin opts in from the Prompt
  // Templates admin page. Read via settings.ts:getSetting at request time.
  await prisma.appSetting.upsert({
    where: { key: "bookTwoPassEnabled" },
    update: {},
    create: { key: "bookTwoPassEnabled", value: "false" },
  });

  // ponytail: LLM book-metadata extraction prompt. Returns strict JSON so the
  // service can parse via response_format json_object. update:{} is
  // intentionally NON-empty: re-running the seed overwrites any prior admin
  // edits so the description field (added in v2) migrates forward
  // automatically. Mirror of the book_pass2 convention below.
  await prisma.promptTemplate.upsert({
    where: { type: "book_metadata" },
    update: {
      content:
        "Here is the full text of a book. Your job is to extract a set of metadata. Read the provided book text and return ONLY valid JSON (no prose, no code fences) with these keys:\n\n" +
        '{\n' +
        '  "title": "string — the book\'s primary title as stated in the book itself, without publisher or series qualifiers",\n' +
        '  "subtitle": "string | null — the subtitle, typically declared on the title page or cover, or after a colon (`:`) in full title; null if absent",\n' +
        '  "author": "string | null — the author\'s name as the book declares it (prefer the most formal form shown on the title page; null if genuinely undeterminable)",\n' +
        '  "authorGender": "string | null — the author\'s declared gender ONLY if the author states or unambiguously indicates their own gender in the book (e.g. an \'About the Author\' bio that says \'she lives in...\'). Use \'male\', \'female\', \'nonbinary\', or a self-described term. null if the book does not declare it — never guess from name, photo, or content.",\n' +
        '  "isNarrative": "boolean | null — true if the book is primarily a narrative (fiction, memoir, narrative nonfiction that tells a story); false if primarily non-narrative (textbook, manual, essay collection, reference, philosophical argument without story structure). null only if you genuinely cannot tell from the text.",\n' +
        '  "language": "string — the book\'s primary language as a 2-letter ISO 639-1 code (e.g. \'en\', \'es\', \'fr\', \'de\'). Infer from the body text, not just metadata.",\n' +
        '  "description": "string — a single-sentence explainer (roughly 15–25 words) that captures what the book is about. Plain prose, no quotation marks, no marketing tone."\n' +
        '}\n\n' +
        "Below is the full text of the book:\n---\n{{book_text}}\n---\n\n" +
        "Return the JSON object now.",
      version: 2,
    },
    create: {
      type: "book_metadata",
      content:
        "Here is the full text of a book. Your job is to extract a set of metadata. Read the provided book text and return ONLY valid JSON (no prose, no code fences) with these keys:\n\n" +
        '{\n' +
        '  "title": "string — the book\'s primary title as stated in the book itself, without publisher or series qualifiers",\n' +
        '  "subtitle": "string | null — the subtitle, typically declared on the title page or cover, or after a colon (`:`) in full title; null if absent",\n' +
        '  "author": "string | null — the author\'s name as the book declares it (prefer the most formal form shown on the title page; null if genuinely undeterminable)",\n' +
        '  "authorGender": "string | null — the author\'s declared gender ONLY if the author states or unambiguously indicates their own gender in the book (e.g. an \'About the Author\' bio that says \'she lives in...\'). Use \'male\', \'female\', \'nonbinary\', or a self-described term. null if the book does not declare it — never guess from name, photo, or content.",\n' +
        '  "isNarrative": "boolean | null — true if the book is primarily a narrative (fiction, memoir, narrative nonfiction that tells a story); false if primarily non-narrative (textbook, manual, essay collection, reference, philosophical argument without story structure). null only if you genuinely cannot tell from the text.",\n' +
        '  "language": "string — the book\'s primary language as a 2-letter ISO 639-1 code (e.g. \'en\', \'es\', \'fr\', \'de\'). Infer from the body text, not just metadata.",\n' +
        '  "description": "string — a single-sentence explainer (roughly 15–25 words) that captures what the book is about. Plain prose, no quotation marks, no marketing tone."\n' +
        '}\n\n' +
        "Below is the full text of the book:\n---\n{{book_text}}\n---\n\n" +
        "Return the JSON object now.",
      version: 2,
    },
  });

  // ponytail: shelf-knowledge prompt templates (Plan 3 Task A1). Captured
  // VERBATIM from src/server/services/shelf-knowledge/{extract,query}.ts so the
  // admin can edit them without behavior change. Versions mirror the current
  // EXTRACT_PROMPT_VERSION (5) and QUERY_PROMPT_VERSION (1) to preserve cache
  // stability — DO NOT reset to 1 or it forces a full re-extract/re-query.
  // Extract prompts end with "BOOK TEXT:\n" — the caller appends full book
  // text exactly as the in-code constants do today.
  // Nav/answer prompts use {{listing}}/{{question}}/{{concept_excerpts}}
  // placeholders (substitution wired up in task C).
  await prisma.promptTemplate.upsert({
    where: { type: "shelf_extract_narrative" },
    update: {
      content: NARRATIVE_PROMPT_CONTENT,
      version: 5,
    },
    create: {
      type: "shelf_extract_narrative",
      content: NARRATIVE_PROMPT_CONTENT,
      version: 5,
    },
  });

  await prisma.promptTemplate.upsert({
    where: { type: "shelf_extract_nonfiction" },
    update: {
      content: NONFICTION_PROMPT_CONTENT,
      version: 5,
    },
    create: {
      type: "shelf_extract_nonfiction",
      content: NONFICTION_PROMPT_CONTENT,
      version: 5,
    },
  });

  await prisma.promptTemplate.upsert({
    where: { type: "shelf_extract_generic" },
    update: {
      content: GENERIC_PROMPT_CONTENT,
      version: 5,
    },
    create: {
      type: "shelf_extract_generic",
      content: GENERIC_PROMPT_CONTENT,
      version: 5,
    },
  });

  await prisma.promptTemplate.upsert({
    where: { type: "shelf_nav" },
    update: {
      content: SHELF_NAV_PROMPT_CONTENT,
      version: 2,
    },
    create: {
      type: "shelf_nav",
      content: SHELF_NAV_PROMPT_CONTENT,
      version: 2,
    },
  });

  await prisma.promptTemplate.upsert({
    where: { type: "shelf_answer" },
    update: {
      content: SHELF_ANSWER_PROMPT_CONTENT,
      version: 5,
    },
    create: {
      type: "shelf_answer",
      content: SHELF_ANSWER_PROMPT_CONTENT,
      version: 5,
    },
  });

  // OpenRouterConfig: seed default model assignments per user type (EXP-09)
  // apiKey falls back to env var at runtime via getOpenRouterConfig()
  for (const userType of ["regular", "pro", "admin"] as const) {
    await prisma.openRouterConfig.upsert({
      where: { userType },
      update: {},
      create: {
        userType,
        apiKey: null,
        model:
          userType === "pro"
            ? "anthropic/claude-sonnet-4.6"
            : "google/gemini-2.0-flash-001",
      },
    });
  }

  // TtsProviderConfig: seed empty rows for elevenlabs and fal.ai per user type
  // Admin must configure API keys before TTS is available
  for (const provider of ["elevenlabs", "fal"] as const) {
    for (const userType of ["regular", "pro", "admin"] as const) {
      await prisma.ttsProviderConfig.upsert({
        where: { provider_userType: { provider, userType } },
        update: {},
        create: {
          provider,
          userType,
          apiKey: null,
          model: null,
          voiceId: null,
        },
      });
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
