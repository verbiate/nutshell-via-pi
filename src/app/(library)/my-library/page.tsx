import { requireAuth } from "@/lib/auth-guards";
import { getPersonalLibrary } from "@/server/services/library";
import { Bookshelf } from "@/components/library/bookshelf";
import { EmptyLibrary } from "@/components/library/empty-library";
import { UploadBookDialog } from "@/components/library/upload-book-dialog";

export default async function MyLibraryPage() {
  const user = await requireAuth();
  const books = await getPersonalLibrary(user.id);

  if (books.length === 0) {
    return <EmptyLibrary />;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-serif text-2xl font-medium text-espresso">
          My Library
        </h1>
        <UploadBookDialog />
      </div>
      <Bookshelf books={books} />
    </div>
  );
}
