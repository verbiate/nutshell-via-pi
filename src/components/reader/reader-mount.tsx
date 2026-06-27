"use client";

import { useParams } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ReaderClient } from "@/components/reader/reader-client";
import type { LibraryBook } from "@/types/book";

// ponytail: ReaderMount lives in the (reader) layout so ReaderClient PERSISTS
// across [id] param changes. Without this, Next.js remounts the page subtree on
// every book change (prevBookIdRef resets to null, swap choreography never
// fires). With this, the layout stays mounted; only the bookId prop changes →
// ReaderClient's swap effect fires in place.
//
// keepPreviousData seeds the new fetch with the old book's props so Phase 1's
// outgoing snapshot and the sidebar's frozen panel have real data to show
// during the close slide. When the new data resolves, epubUrl changes →
// EpubViewer reloads → isLoaded → Phase 2 reopen.

interface BookDetailResponse {
  book: {
    id: string;
    title: string;
    author: string | null;
    coverPath: string | null;
    language: string;
    epubPath: string;
    createdAt: string;
    txtTokens: number | null;
    bookMetadata: {
      title: string | null;
      subtitle: string | null;
      description: string | null;
      isNarrative: boolean | null;
    } | null;
  };
  contextWindow: number;
  isAdmin: boolean;
  userName: string | null;
  attachBookMax: number;
}

export function ReaderMount() {
  const params = useParams();
  const bookId = params.id as string;

  const { data } = useQuery({
    queryKey: ["book-detail", bookId],
    queryFn: async () => {
      const res = await fetch(`/api/books/${bookId}`);
      if (!res.ok) throw new Error(`Failed to load book: ${res.status}`);
      return (await res.json()) as BookDetailResponse;
    },
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });

  // ponytail: library snapshot for back-nav. ReaderClient.handleBack re-fetches
  // fresh data before navigating, so the initial value only seeds the off-screen
  // BookshelfSnapshot. Empty array is a safe placeholder.
  const { data: libraryData } = useQuery({
    queryKey: ["library"],
    queryFn: async () => {
      const res = await fetch("/api/books");
      if (!res.ok) throw new Error("Failed to load library");
      return (await res.json()) as { books: LibraryBook[] };
    },
    staleTime: 30_000,
  });

  const b = data?.book;

  return (
    <ReaderClient
      key="reader"
      bookId={bookId}
      bookTitle={b?.title}
      bookAuthor={b?.author}
      bookCoverPath={b?.coverPath}
      bookLanguage={b?.language}
      bookMetadataTitle={b?.bookMetadata?.title ?? null}
      bookSubtitle={b?.bookMetadata?.subtitle ?? null}
      bookDescription={b?.bookMetadata?.description ?? null}
      bookIsNarrative={b?.bookMetadata?.isNarrative ?? null}
      epubUrl={b ? `/api/files/${b.epubPath}` : undefined}
      isAdmin={data?.isAdmin}
      bookCreatedAt={b?.createdAt}
      bookTxtTokens={b?.txtTokens}
      contextWindow={data?.contextWindow}
      attachBookMax={data?.attachBookMax ?? 0}
      librarySnapshot={libraryData?.books ?? []}
      libraryUserName={data?.userName ?? null}
      libraryDigestImage={null}
    />
  );
}
