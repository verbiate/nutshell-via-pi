"use client";

// ponytail: resolves spine hrefs for the books cited in a shelf discussion's
// messages (#ch:<bookId>:<basename> deep links). Shelf discussions have no
// attachments, so ExplainerContent's attachedBookHrefs is otherwise empty and
// every #ch: link degrades to plain text. This hook parses cited bookIds from
// the message content, batch-fetches their spine hrefs via POST /api/books/hrefs
// (which access-checks each book), and returns the Record<string,string[]>
// ExplainerContent validates against. Returns {} when nothing is cited — a
// no-op so it's safe to call unconditionally (hook rules), gated by `enabled`.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseCitations, parseBookRef } from "@/lib/explainer/citations";

export function useShelfCitedHrefs(
  messages: { role: string; content: string }[]
): Record<string, string[]> {
  const bookIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) {
      if (!m.content) continue;
      for (const c of parseCitations(m.content)) {
        const { bookId } = parseBookRef(c.href);
        if (bookId) set.add(bookId);
      }
    }
    return Array.from(set).sort();
  }, [messages]);

  const { data } = useQuery({
    queryKey: ["book-hrefs", bookIds],
    queryFn: async () => {
      const res = await fetch("/api/books/hrefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookIds }),
      });
      if (!res.ok) return {} as Record<string, string[]>;
      return (await res.json()) as Record<string, string[]>;
    },
    enabled: bookIds.length > 0,
  });

  return data ?? {};
}
