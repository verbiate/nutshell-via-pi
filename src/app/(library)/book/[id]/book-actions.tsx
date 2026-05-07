"use client";

import { Button } from "@/components/ui/button";
import { ExplainerTrigger } from "@/components/explainer/explainer-trigger";
import Link from "next/link";
import { BookOpen } from "lucide-react";

interface BookActionsProps {
  bookId: string;
  initialLanguage: string;
}

export function BookActions({ bookId, initialLanguage }: BookActionsProps) {
  return (
    <div className="mt-6 flex flex-col gap-2 sm:flex-row">
      <Button asChild>
        <Link href={`/book/${bookId}/reader`}>
          <BookOpen className="mr-2 h-4 w-4" />
          Open Reader
        </Link>
      </Button>
      <ExplainerTrigger
        bookId={bookId}
        initialLanguage={initialLanguage}
      />
    </div>
  );
}
