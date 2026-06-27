"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * ponytail: one-shot pending cross-book navigation, cloned from the TTS
 * player's `pendingReaderSyncBookId` pattern (audio-context.ts). The TTS path
 * pulls the target section from the live audio session after arrival; a
 * citation click knows its target at click time, so this carries the section
 * + discussion too.
 *
 * Flow: ExplainerContent click → reader-client marks pending + router.push →
 * destination reader mount effect consumes on book-ready → viewer navigates +
 * Discussions panel opens to the thread → clear.
 *
 * No Zustand — follows the codebase convention of React Context + local state
 * (discussions-panel.tsx:71).
 */
export type PendingReaderNav = {
  bookId: string;
  href?: string;
  discussionId?: string;
} | null;

export type ReaderNavContextValue = {
  pendingReaderNav: PendingReaderNav;
  markPendingReaderNav: (nav: NonNullable<PendingReaderNav>) => void;
  clearPendingReaderNav: () => void;
};

const ReaderNavContext = createContext<ReaderNavContextValue | null>(null);

export function useReaderNav(): ReaderNavContextValue {
  const ctx = useContext(ReaderNavContext);
  if (!ctx) {
    throw new Error("useReaderNav must be used within ReaderNavProvider");
  }
  return ctx;
}

export function ReaderNavProvider({ children }: { children: ReactNode }) {
  const [pendingReaderNav, setPendingReaderNav] = useState<PendingReaderNav>(null);
  return (
    <ReaderNavContext.Provider
      value={{
        pendingReaderNav,
        markPendingReaderNav: setPendingReaderNav,
        clearPendingReaderNav: () => setPendingReaderNav(null),
      }}
    >
      {children}
    </ReaderNavContext.Provider>
  );
}
