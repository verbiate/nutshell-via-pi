import { readdir } from "fs/promises";
import path from "path";
import { requireAuth } from "@/lib/auth-guards";
import { getBookForUser, getPersonalLibrary } from "@/server/services/library";
import { getOpenRouterConfig } from "@/server/services/openrouter";
import { getContextWindow } from "@/server/services/model-info";
import { redirect } from "next/navigation";
import { ReaderClient } from "@/components/reader/reader-client";

// ponytail: duplicated from (library)/my-library/page.tsx — two callers, not
// worth extracting yet. If a third appears, lift to src/lib/digest.ts.
const DIGEST_DIR = path.join(process.cwd(), "public/images/daily-digest");
const DIGEST_URL = "/images/daily-digest";
const IMAGE_RE = /\.(png|jpe?g|webp|avif|gif)$/i;

async function pickRandomDigestImage(): Promise<string | null> {
  try {
    const files = await readdir(DIGEST_DIR);
    const images = files.filter((f) => IMAGE_RE.test(f));
    if (images.length === 0) return null;
    const pick = images[Math.floor(Math.random() * images.length)];
    return `${DIGEST_URL}/${pick}`;
  } catch {
    return null;
  }
}

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireAuth();
  // ponytail: resolve the user's tier model + its context window alongside
  // the book and library fetches so the Explainer panel can show an "X% full"
  // indicator without a separate roundtrip. Both are cheap: getOpenRouterConfig
  // is one PK lookup, getContextWindow hits a 24h process cache.
  const [{ model }, book, librarySnapshot, digestImage] = await Promise.all([
    getOpenRouterConfig(session.role),
    getBookForUser(id, session.id),
    getPersonalLibrary(session.id),
    pickRandomDigestImage(),
  ]);
  const { contextLength: contextWindow } = await getContextWindow(model);

  if (!book) {
    redirect("/my-library");
  }

  const epubUrl = `/api/files/${book.epubPath}`;

  return (
    <ReaderClient
      bookId={book.id}
      bookTitle={book.title}
      bookAuthor={book.author}
      bookCoverPath={book.coverPath}
      bookLanguage={book.language}
      bookMetadataTitle={book.bookMetadata?.title ?? null}
      bookSubtitle={book.bookMetadata?.subtitle ?? null}
      bookDescription={book.bookMetadata?.description ?? null}
      bookIsNarrative={book.bookMetadata?.isNarrative ?? null}
      epubUrl={epubUrl}
      isAdmin={session.role === "admin"}
      bookCreatedAt={book.createdAt.toISOString()}
      librarySnapshot={librarySnapshot}
      libraryUserName={session.name}
      libraryDigestImage={digestImage}
      bookTxtTokens={book.txtTokens}
      contextWindow={contextWindow}
    />
  );
}
