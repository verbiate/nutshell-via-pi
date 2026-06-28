import { readdir } from "fs/promises";
import path from "path";
import { requireAuth } from "@/lib/auth-guards";
import { loadFreeBooksCatalog } from "@/lib/free-books";
import { getPersonalLibrary } from "@/server/services/library";
import { listAllDiscussionsForUser } from "@/server/services/discussions";
import { EmptyLibrary } from "@/components/library/empty-library";
import { HomeView } from "@/components/library/home-view";

const DIGEST_DIR = path.join(process.cwd(), "public/images/daily-digest");
const DIGEST_URL = "/images/daily-digest";
const IMAGE_RE = /\.(png|jpe?g|webp|avif|gif)$/i;

// ponytail: pick a random digest photo per page load; drop-in friendly (just add files)
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

export default async function MyLibraryPage() {
  const [user, digestImage, freeBooks] = await Promise.all([
    requireAuth(),
    pickRandomDigestImage(),
    loadFreeBooksCatalog(),
  ]);
  const [books, discussions] = await Promise.all([
    getPersonalLibrary(user.id),
    listAllDiscussionsForUser(user.id),
  ]);

  if (books.length === 0) {
    return <EmptyLibrary />;
  }

  // ponytail: precompute "added" state for each free book by matching md5
  // against the user's library. Cheap set lookup; avoids a round-trip per card.
  const addedMd5s = new Set(books.map((b) => b.md5));
  const freeBooksWithState = freeBooks.map((b) => ({
    ...b,
    added: addedMd5s.has(b.md5),
  }));

  return (
    <HomeView
      userName={user.name}
      books={books}
      digestImage={digestImage}
      freeBooks={freeBooksWithState}
      discussions={discussions as any}
    />
  );
}
