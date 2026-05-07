import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { getExplainer, computeContentHash } from "@/server/services/explainer";
import { db } from "@/server/db";
import { storage } from "@/server/storage/local";
import { extractSectionText } from "@/server/services/section-extractor";

/**
 * GET /api/explainers?bookId=X&type=book|section&lang=Y&tier=Z&sectionHref=H
 *
 * Check cache for an existing explainer. Returns cached content or 404.
 */
export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get("bookId");
    const type = searchParams.get("type") as "book" | "section";
    const language = searchParams.get("lang") || user.preferredLanguage || "en";
    const tier = user.role === "pro" ? "pro" : "regular";
    const sectionHref = searchParams.get("sectionHref");

    if (!bookId || !type) {
      return NextResponse.json(
        { error: "bookId and type are required" },
        { status: 400 }
      );
    }

    if (type !== "book" && type !== "section") {
      return NextResponse.json(
        { error: "type must be 'book' or 'section'" },
        { status: 400 }
      );
    }

    const hasAccess = await verifyBookAccess(user.id, bookId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: "You do not have access to this book" },
        { status: 403 }
      );
    }

    const book = await db.epubFile.findUnique({ where: { id: bookId } });
    if (!book) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }

    // Compute content hash
    let sourceText: string;
    let promptVersion: number;

    if (type === "book") {
      const txtBuffer = await storage.read(book.txtPath);
      sourceText = txtBuffer.toString("utf-8");
      const template = await db.promptTemplate.findUnique({
        where: { type: "book" },
      });
      promptVersion = template?.version ?? 1;
    } else {
      if (!sectionHref) {
        return NextResponse.json(
          { error: "sectionHref is required for section type" },
          { status: 400 }
        );
      }
      sourceText = await extractSectionText(book.epubPath, sectionHref);
      const template = await db.promptTemplate.findUnique({
        where: { type: "section" },
      });
      promptVersion = template?.version ?? 1;
    }

    const contentHash = computeContentHash(sourceText, promptVersion, type);
    const explainer = await getExplainer({
      contentHash,
      language,
      contentType: type,
      tier,
    });

    if (!explainer) {
      return NextResponse.json({ cached: false }, { status: 404 });
    }

    return NextResponse.json({
      cached: true,
      content: explainer.content,
      modelId: explainer.modelId,
      createdAt: explainer.createdAt,
    });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    console.error("[GET /api/explainers]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
