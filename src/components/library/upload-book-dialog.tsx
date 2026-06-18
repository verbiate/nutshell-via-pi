"use client";

import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { UploadDropzone } from "./upload-dropzone";

export function UploadBookDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Upload className="mr-2 h-4 w-4" />
          Upload Book
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <UploadDropzone />
      </DialogContent>
    </Dialog>
  );
}
