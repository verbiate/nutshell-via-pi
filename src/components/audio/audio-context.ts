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
  bookLanguage: string;
  flatToc: FlatSection[];
  userRole: UserRole;
  currentIndex: number;
  voiceSpeed: number;
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
  startFromHere: (overrideHref?: string, overrideLabel?: string) => void;
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
