"use client";

import { createContext, useContext } from "react";
import type { NavItem } from "@likecoin/epub-ts";
import type { EpubViewerHandle } from "@/components/reader/epub-viewer";
import type { EngineId } from "@/lib/tts/languages";
import type { TtsPlaybackState } from "@/hooks/use-tts-playback";
import type { CloudQuota } from "@/hooks/use-tts-cloud";
import type { UserRole } from "@/types/book";

export type FlatSection = {
  label: string;
  href: string;
  index: number;
};

export type BookAudioContext = {
  bookId: string;
  bookTitle?: string;
  bookAuthor?: string | null;
  bookCoverPath?: string | null;
  bookLanguage: string;
  toc: NavItem[];
  userRole: UserRole;
  currentHref: string;
  voiceSpeed: number;
};

export type AudioSession = {
  bookId: string;
  bookTitle?: string;
  bookAuthor?: string | null;
  bookCoverPath?: string | null;
  bookLanguage: string;
  flatToc: FlatSection[];
  userRole: UserRole;
  currentIndex: number;
  voiceSpeed: number;
};

export type TtsStartPos = {
  /** Resolve this element id in the section DOM to find the start offset. */
  elementId?: string;
  /** When true, use the viewer's first visible block (current reading page). */
  useVisible?: boolean;
};

export type AudioContextValue = {
  session: AudioSession | null;
  playbackState: TtsPlaybackState;
  /** Engine actually in use (after any browser fallback). */
  activeEngineId: EngineId;
  loadPct: number;
  cloudQuota: CloudQuota | null;
  isCloud: boolean;
  canScrub: boolean;
  /** True when the reader is mounted and has registered its viewer. */
  onReader: boolean;
  /**
   * Reader pushes its chrome-hidden flag so the floating card mirrors
   * on-reader controls (chrome/progress/rail) instead of tracking pointer
   * idle itself. Default false → card stays visible off-reader.
   */
  setReaderControlsHidden: (hidden: boolean) => void;
  /** Register the currently open book (reader mount / section change). */
  registerBook: (ctx: BookAudioContext) => void;
  /** Register the live EPUB viewer for highlight-follow-along. */
  registerViewer: (ref: React.RefObject<EpubViewerHandle | null>) => void;
  /** Unregister the viewer when the reader unmounts (does not stop audio). */
  unregisterViewer: () => void;
  /** Start playing from the open book's current section, or from the given section. */
  startFromHere: (
    overrideHref?: string,
    overrideLabel?: string,
    startPos?: TtsStartPos,
  ) => void;
  /**
   * Navigate the registered viewer to the section currently being read and
   * highlight the chunk now being spoken. Used when the reader re-mounts while
   * playback is active (user left for the bookshelf, audio kept going, came
   * back) — without this the viewer lands on the stale saved position while
   * TTS reads a different section, so the live highlight never lands.
   * No-op when no session, no viewer, the open book differs from the session
   * book, or playback isn't active.
   */
  syncViewerToPlayback: () => Promise<void>;
  /**
   * Re-apply the TTS highlight to the chunk currently being spoken, without
   * navigating. Called by the reader when epub.js recreates a section's iframe
   * (the `rendered` event, which fires on every chapter swap) — the imperative
   * <mark class="tts-chunk"> injected into the old iframe is destroyed with it,
   * so a manual page-flip across a section boundary leaves the playing chunk
   * unhighlighted when the user pages back. No-op unless a viewer is registered,
   * playback is active for THIS book, and renderedHref matches the section
   * currently being read.
   */
  rehighlightCurrentChunk: (renderedHref?: string) => Promise<void>;
  /** Open the book-details sidebar (no-op when reader hasn't registered a handler). */
  openBookDetails: () => void;
  /** ReaderClient registers this so the persistent player can open its sidebar. */
  registerDetailsOpener: (fn: () => void) => void;
  /**
   * Set when the floating player's book thumbnail is clicked off-reader. The
   * reader consumes it on mount to syncViewerToPlayback even when playback is
   * paused/idle (the normal ttsLiveForBook auto-sync only fires while actively
   * PLAYING/LOADING). Null once consumed. ponytail: ref-backed one-shot, no re-render needed.
   */
  pendingReaderSyncBookId: string | null;
  /** Record that the next mount of this book's reader should sync to the TTS position. */
  markPendingReaderSync: (bookId: string) => void;
  /** Reader calls this once it has consumed the pending flag. */
  clearPendingReaderSync: () => void;
  playPause: () => void;
  stop: () => void;
  scrub: (time: number) => void;
  setEngine: (id: EngineId) => void;
  setVoice: (id: string) => void;
  /** Jump to a section by index in the session playlist. */
  jumpTo: (index: number) => void;
};

export const AudioContext = createContext<AudioContextValue | null>(null);

export function useAudio(): AudioContextValue {
  const ctx = useContext(AudioContext);
  if (!ctx) {
    throw new Error("useAudio must be used within AudioProvider");
  }
  return ctx;
}
