import { requireAuth } from "@/lib/auth-guards";
import { getPersonalLibrary } from "@/server/services/library";
import { Bookshelf } from "@/components/library/bookshelf";
import { EmptyLibrary } from "@/components/library/empty-library";

export default async function MyLibraryPage() {
  const user = await requireAuth();
  const books = await getPersonalLibrary(user.id);

  const bookList = books.map((ba) => ({
    id: ba.book.id,
    title: ba.book.title,
    author: ba.book.author,
    language: ba.book.language,
    coverPath: ba.book.coverPath,
  }));

  if (bookList.length === 0) {
    return <EmptyLibrary />;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-slate-900">
          My Library
        </h1>
      </div>
      <Bookshelf books={bookList} />
    </div>
  );
}
