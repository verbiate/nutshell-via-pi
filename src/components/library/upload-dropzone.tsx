"use client";

import { useCallback, useState, useRef } from "react";
import { Upload } from "lucide-react";
import { ProcessingIndicator } from "./processing-indicator";
import { toast } from "sonner";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

interface UploadDropzoneProps {
  onUploadComplete?: (book: { id: string; title: string; isNew: boolean }) => void;
}

export function UploadDropzone({ onUploadComplete }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [processingStep, setProcessingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      // Client-side validation
      if (!file.name.toLowerCase().endsWith(".epub")) {
        setError("Only EPUB files are accepted");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError("File size must be under 50MB");
        return;
      }

      setError(null);
      setIsUploading(true);
      setProcessingStep(0);

      try {
        const formData = new FormData();
        formData.append("file", file);

        // Step 1: Computing hash
        setProcessingStep(0);
        await new Promise((r) => setTimeout(r, 300));

        // Step 2: Checking library
        setProcessingStep(1);
        await new Promise((r) => setTimeout(r, 300));

        const response = await fetch("/api/books/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Upload failed");
        }

        // Step 3: Converting (server handles this, but we show the step)
        setProcessingStep(2);

        const data = await response.json();

        // Step 4: Done
        setProcessingStep(3);

        toast.success(`${data.book.title} added to your library`);

        onUploadComplete?.(data.book);
      } catch (err: any) {
        setError(err.message || "Something went wrong");
        toast.error(err.message || "Upload failed");
      } finally {
        setIsUploading(false);
        setProcessingStep(0);
      }
    },
    [onUploadComplete]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div className="w-full">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 px-6 py-8 transition-colors ${
          error
            ? "border-destructive bg-destructive/10"
            : isDragging
            ? "border-solid border-primary bg-muted"
            : "border-dashed border-border bg-card hover:border-lav-ring"
        } ${isUploading ? "pointer-events-none opacity-60" : ""}`}
      >
        {isUploading ? (
          <div className="flex flex-col items-center gap-4">
            <ProcessingIndicator currentStep={processingStep} />
          </div>
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div className="text-center">
              <p className="text-[20px] font-semibold text-foreground">
                Drag and drop your EPUB here
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                or click to browse files
              </p>
            </div>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".epub"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {error && (
        <p className="mt-2 text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
