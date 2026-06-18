import { BookOpen } from "lucide-react";
import { UploadDropzone } from "./upload-dropzone";

export function EmptyLibrary() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center">
      <BookOpen className="h-16 w-16 text-muted-foreground" />
      <h2 className="mt-4 font-serif text-[28px] font-medium text-espresso">
        Your library is empty
      </h2>
      <p className="mt-2 max-w-[400px] text-center text-base text-muted-foreground">
        Upload your first EPUB to start reading with AI-powered explanations.
      </p>
      <div className="mt-6 w-full max-w-md">
        <UploadDropzone />
      </div>
    </div>
  );
}
