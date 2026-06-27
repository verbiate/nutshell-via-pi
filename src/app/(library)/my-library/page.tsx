import { readdir } from "fs/promises";
import path from "path";
import { requireAuth } from "@/lib/auth-guards";
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
  const [user, digestImage] = await Promise.all([
    requireAuth(),
    pickRandomDigestImage(),
  ]);
  const [books, discussions] = await Promise.all([
    getPersonalLibrary(user.id),
    listAllDiscussionsForUser(user.id),
  ]);

  if (books.length === 0) {
    return <EmptyLibrary />;
  }

  return (
    <HomeView
      userName={user.name}
      books={books}
      digestImage={digestImage}
      discussions={discussions as any}
    />
  );
}
