import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { getExplainer, computeContentHash } from "@/server/services/explainer";
import { db } from "@/server/db";
import { storage } from "@/server/storage/local";
import { extractSectionText } from "@/server/services/section-extractor";

/**
 * GET /api/explainers?bookId=X&type=book|section|passage&lang=Y&tier=Z&sectionHref=H&passageText=T
 *
 * Check cache for an existing explainer. Returns cached content or 404.
 * POST /api/explainers is preferred for passage type to avoid URL length limits.
 */
export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get("bookId");
    const type = searchParams.get("type") as "book" | "section" | "passage";
    const language = searchParams.get("lang") || user.preferredLanguage || "en";
    const tier = user.role === "pro" ? "pro" : "regular";
    const sectionHref = searchParams.get("sectionHref");
    const passageText = searchParams.get("passageText");

    if (!bookId || !type) {
      return NextResponse.json(
        { error: "bookId and type are required" },
        { status: 400 }
      );
    }

    if (type !== "book" && type !== "section" && type !== "passage") {
      return NextResponse.json(
        { error: "type must be 'book', 'section', or 'passage'" },
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
    } else if (type === "section") {
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
    } else {
      // passage
      if (!passageText) {
        return NextResponse.json(
          { error: "passageText is required for passage type" },
          { status: 400 }
        );
      }
      sourceText = passageText;
      const template = await db.promptTemplate.findUnique({
        where: { type: "passage" },
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

/**
 * POST /api/explainers
 *
 * Check cache for passage-type explainers (passage text via body avoids URL length limits).
 * Body: { bookId, type, language, passageText }
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    let body: {
      bookId?: string;
      type?: "book" | "section" | "passage";
      language?: string;
      passageText?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { bookId, type, language, passageText } = body;
    if (!bookId || !type || !language) {
      return NextResponse.json(
        { error: "bookId, type, and language are required" },
        { status: 400 }
      );
    }

    if (type !== "passage") {
      return NextResponse.json(
        { error: "POST is only supported for passage type" },
        { status: 400 }
      );
    }

    if (!passageText) {
      return NextResponse.json(
        { error: "passageText is required for passage type" },
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

    const template = await db.promptTemplate.findUnique({
      where: { type: "passage" },
    });
    const promptVersion = template?.version ?? 1;
    const contentHash = computeContentHash(passageText, promptVersion, type);

    const existing = await getExplainer({
      contentHash,
      language,
      contentType: type,
      tier: user.role === "pro" ? "pro" : "regular",
    });

    if (existing) {
      return NextResponse.json({ cached: true, explainer: existing });
    }

    return NextResponse.json({ cached: false });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    console.error("[POST /api/explainers]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
