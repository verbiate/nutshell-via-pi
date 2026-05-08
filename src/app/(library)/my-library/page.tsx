import { requireAuth } from "@/lib/auth-guards";
import { getPersonalLibrary } from "@/server/services/library";
import { Bookshelf } from "@/components/library/bookshelf";
import { EmptyLibrary } from "@/components/library/empty-library";
import { UploadDropzone } from "@/components/library/upload-dropzone";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";

export default async function MyLibraryPage() {
  const user = await requireAuth();
  const books = await getPersonalLibrary(user.id);

  if (books.length === 0) {
    return <EmptyLibrary />;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-slate-900">
          My Library
        </h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button className="bg-slate-900 text-white hover:bg-slate-800">
              <Upload className="mr-2 h-4 w-4" />
              Upload Book
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <UploadDropzone />
          </DialogContent>
        </Dialog>
      </div>
      <Bookshelf books={books} />
    </div>
  );
}
