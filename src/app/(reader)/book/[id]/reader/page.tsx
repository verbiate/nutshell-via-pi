import { requireAuth } from "@/lib/auth-guards";
import { getBookForUser } from "@/server/services/library";
import { redirect } from "next/navigation";
import { ReaderClient } from "@/components/reader/reader-client";

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
    />
  );
}
