import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import {
  processAndUploadBook,
  validateEpub,
  UploadBlockedError,
} from "@/server/services/epub-processor";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const validationError = validateEpub(file);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const result = await processAndUploadBook(file, user.id, user.role);

    return NextResponse.json({
      book: {
        id: result.book.id,
        title: result.book.title,
        author: result.book.author,
        language: result.book.language,
        coverPath: result.book.coverPath,
        isNew: result.isNew,
      },
    });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    // ponytail: UploadBlockedError carries statusCode 413; surface its friendly
    // message verbatim (no token jargon).
    if (error instanceof UploadBlockedError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error.message || "Upload failed" },
      { status: 500 }
    );
  }
}
