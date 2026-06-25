import { requireAuth } from "@/lib/auth-guards";
import { getBookForUser } from "@/server/services/library";
import { redirect } from "next/navigation";

// ponytail: page.tsx now only does server-side auth + book-existence check +
// redirect. The actual reader UI is rendered by ReaderMount (a client component
// in the layout) so ReaderClient persists across [id] param changes and the
// swap choreography can fire in place. Data fetch happens client-side via
// /api/books/[id] in ReaderMount.
export default async function ReaderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireAuth();
  const book = await getBookForUser(id, session.id);

  if (!book) {
    redirect("/my-library");
  }

  return null;
}
