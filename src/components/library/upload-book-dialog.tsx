"use client";

import { Plus } from "lucide-react";
import { VisuallyHidden } from "radix-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { UploadDropzone } from "./upload-dropzone";

export function UploadBookDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Add a book
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <VisuallyHidden.Root>
          <DialogTitle>Upload a book</DialogTitle>
        </VisuallyHidden.Root>
        <UploadDropzone />
      </DialogContent>
    </Dialog>
  );
}
