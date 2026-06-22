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
    update: {},
    create: {
      type: "book",
      content: "You are an expert literary analyst. The user has uploaded a book and wants to understand it deeply.\n\nBook title: {{title}}\nAuthor: {{author}}\nLanguage: {{language}}\n\nBelow is the full text of the book:\n---\n{{book_text}}\n---\n\nPlease provide a comprehensive explanation of this book in {{target_language}}. Cover the main themes, key arguments or plot points, important characters, and the author's style. Help the reader understand not just what happens, but why it matters. Do NOT simply summarize — explain and illuminate.",
      version: 3,
    },
  });

  await prisma.promptTemplate.upsert({
    where: { type: "section" },
    update: {},
    create: {
      type: "section",
      content: "You are an expert literary analyst. The user is reading a book and wants to understand a specific section.\n\nBook title: {{title}}\nAuthor: {{author}}\nSection: {{section_title}}\n\nFor context, here is the full text of the book:\n---\n{{book_text}}\n---\n\nThe user wants to understand this specific section:\n---\n{{chosen_text}}\n---\n\nPlease provide a clear explanation of this section in {{target_language}}. Cover what happens or what is argued, why it matters in the context of the whole book, any important themes or symbols, and connections to other parts of the book. Do NOT simply summarize — explain and illuminate.",
      version: 2,
    },
  });

  await prisma.promptTemplate.upsert({
    where: { type: "passage" },
    update: {},
    create: {
      type: "passage",
      content: "You are an expert literary assistant. Explain the following passage from the book \"{{title}}\" by {{author}} in {{target_language}}. Provide context, key concepts, and any difficult vocabulary.\n\nFor context, here is the full text of the book:\n---\n{{book_text}}\n---\n\nThe passage to explain:\n---\n{{chosen_text}}\n---",
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
