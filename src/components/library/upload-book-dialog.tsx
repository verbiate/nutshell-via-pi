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
        <Button className="bg-white text-espresso hover:bg-white/90">
          <Upload className="mr-2 h-4 w-4" />
          Add a book
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <UploadDropzone />
      </DialogContent>
    </Dialog>
  );
}
