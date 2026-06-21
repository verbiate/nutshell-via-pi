import { readdir } from "fs/promises";
import path from "path";
import { requireAuth } from "@/lib/auth-guards";
import { getBookForUser, getPersonalLibrary } from "@/server/services/library";
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
  const [book, librarySnapshot, digestImage] = await Promise.all([
    getBookForUser(id, session.id),
    getPersonalLibrary(session.id),
    pickRandomDigestImage(),
  ]);

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
      epubUrl={epubUrl}
      isAdmin={session.role === "admin"}
      bookCreatedAt={book.createdAt.toISOString()}
      librarySnapshot={librarySnapshot}
      libraryUserName={session.name}
      libraryDigestImage={digestImage}
    />
  );
}
