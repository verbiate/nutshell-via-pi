import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // ponytail: prompt templates use {{book_text}} (full book) and {{chosen_text}}
  // (section or passage selection). Book template uses only {{book_text}} since
  // the whole book IS the subject. Section/passage templates include both —
  // the chosen snippet for focus, the full book so the model can honor the
  // "connections to other parts of the book" instruction.
  await prisma.promptTemplate.upsert({
    where: { type: "book" },
    update: {
      content: "You are an expert literary analyst. The user has uploaded a book and wants to understand it deeply.\n\nBook title: {{title}}\nAuthor: {{author}}\nLanguage: {{language}}\n\nBelow is the full text of the book:\n---\n{{book_text}}\n---\n\nPlease provide a comprehensive explanation of this book in {{target_language}}. Cover the main themes, key arguments or plot points, important characters, and the author's style. Help the reader understand not just what happens, but why it matters. Do NOT simply summarize — explain and illuminate.\n\nThe book's chapter map:\n{{chapter_index}}\n\nWhen you reference where something occurs in the book (a chapter, section, or scene), cite it as a markdown link using ONLY hrefs that appear in the chapter map above, in the exact form [Chapter One](#ch:chapter1.xhtml). Cite only when you genuinely reference a location — do not pad with citations, and never invent an href that is not in the map. Use the natural-language label as the link text.",
      version: 4,
    },
    create: {
      type: "book",
      content: "You are an expert literary analyst. The user has uploaded a book and wants to understand it deeply.\n\nBook title: {{title}}\nAuthor: {{author}}\nLanguage: {{language}}\n\nBelow is the full text of the book:\n---\n{{book_text}}\n---\n\nPlease provide a comprehensive explanation of this book in {{target_language}}. Cover the main themes, key arguments or plot points, important characters, and the author's style. Help the reader understand not just what happens, but why it matters. Do NOT simply summarize — explain and illuminate.\n\nThe book's chapter map:\n{{chapter_index}}\n\nWhen you reference where something occurs in the book (a chapter, section, or scene), cite it as a markdown link using ONLY hrefs that appear in the chapter map above, in the exact form [Chapter One](#ch:chapter1.xhtml). Cite only when you genuinely reference a location — do not pad with citations, and never invent an href that is not in the map. Use the natural-language label as the link text.",
      version: 4,
    },
  });

  await prisma.promptTemplate.upsert({
    where: { type: "section" },
    update: {
      content: "You are an expert literary analyst. The user is reading a book and wants to understand a specific section.\n\nBook title: {{title}}\nAuthor: {{author}}\nSection: {{section_title}}\n\nFor context, here is the full text of the book:\n---\n{{book_text}}\n---\n\nThe user wants to understand this specific section:\n---\n{{chosen_text}}\n---\n\nPlease provide a clear explanation of this section in {{target_language}}. Cover what happens or what is argued, why it matters in the context of the whole book, any important themes or symbols, and connections to other parts of the book. Do NOT simply summarize — explain and illuminate.\n\nThe book's chapter map:\n{{chapter_index}}\n\nWhen you reference where something occurs in the book (a chapter, section, or scene), cite it as a markdown link using ONLY hrefs that appear in the chapter map above, in the exact form [Chapter One](#ch:chapter1.xhtml). Cite only when you genuinely reference a location — do not pad with citations, and never invent an href that is not in the map. Use the natural-language label as the link text.",
      version: 3,
    },
    create: {
      type: "section",
      content: "You are an expert literary analyst. The user is reading a book and wants to understand a specific section.\n\nBook title: {{title}}\nAuthor: {{author}}\nSection: {{section_title}}\n\nFor context, here is the full text of the book:\n---\n{{book_text}}\n---\n\nThe user wants to understand this specific section:\n---\n{{chosen_text}}\n---\n\nPlease provide a clear explanation of this section in {{target_language}}. Cover what happens or what is argued, why it matters in the context of the whole book, any important themes or symbols, and connections to other parts of the book. Do NOT simply summarize — explain and illuminate.\n\nThe book's chapter map:\n{{chapter_index}}\n\nWhen you reference where something occurs in the book (a chapter, section, or scene), cite it as a markdown link using ONLY hrefs that appear in the chapter map above, in the exact form [Chapter One](#ch:chapter1.xhtml). Cite only when you genuinely reference a location — do not pad with citations, and never invent an href that is not in the map. Use the natural-language label as the link text.",
      version: 3,
    },
  });

  await prisma.promptTemplate.upsert({
    where: { type: "passage" },
    update: {
      content: "You are an expert literary assistant. Explain the following passage from the book \"{{title}}\" by {{author}} in {{target_language}}. Provide context, key concepts, and any difficult vocabulary.\n\nFor context, here is the full text of the book:\n---\n{{book_text}}\n---\n\nThe passage to explain:\n---\n{{chosen_text}}\n---\n\nThe book's chapter map:\n{{chapter_index}}\n\nWhen you reference where something occurs in the book (a chapter, section, or scene), cite it as a markdown link using ONLY hrefs that appear in the chapter map above, in the exact form [Chapter One](#ch:chapter1.xhtml). Cite only when you genuinely reference a location — do not pad with citations, and never invent an href that is not in the map. Use the natural-language label as the link text.",
      version: 3,
    },
    create: {
      type: "passage",
      content: "You are an expert literary assistant. Explain the following passage from the book \"{{title}}\" by {{author}} in {{target_language}}. Provide context, key concepts, and any difficult vocabulary.\n\nFor context, here is the full text of the book:\n---\n{{book_text}}\n---\n\nThe passage to explain:\n---\n{{chosen_text}}\n---\n\nThe book's chapter map:\n{{chapter_index}}\n\nWhen you reference where something occurs in the book (a chapter, section, or scene), cite it as a markdown link using ONLY hrefs that appear in the chapter map above, in the exact form [Chapter One](#ch:chapter1.xhtml). Cite only when you genuinely reference a location — do not pad with citations, and never invent an href that is not in the map. Use the natural-language label as the link text.",
      version: 3,
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
