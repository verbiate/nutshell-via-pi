"use client";

import { createContext, useContext } from "react";
import type { NavItem } from "@likecoin/epub-ts";
import type { EpubViewerHandle } from "@/components/reader/epub-viewer";
import type { EngineId } from "@/lib/tts/languages";
import type { TtsPlaybackState } from "@/hooks/use-tts-playback";
import type { CloudQuota } from "@/hooks/use-tts-cloud";
import type { UserRole } from "@/types/book";
import type { FlatSection, SpineItem } from "@/lib/reader/spine-playlist";
import type { PlaylistItem } from "@/types/playlist";
export type { FlatSection } from "@/lib/reader/spine-playlist";

export type BookAudioContext = {
  bookId: string;
  bookTitle?: string;
  bookAuthor?: string | null;
  bookCoverPath?: string | null;
  bookLanguage: string;
  toc: NavItem[];
  spineItems: SpineItem[];
  userRole: UserRole;
  currentHref: string;
  // ponytail: LLM-pinned last readable section href. When auto-advance is on,
  // playback stops after this section instead of continuing into back matter.
  readableEndSectionHref?: string | null;
  // ponytail: LLM-pinned first readable section href. The ghost jumps here
  // when the active item is in front matter (before the readable window).
  readableStartSectionHref?: string | null;
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
  // ponytail: null when no metadata row or no end anchor pinned.
  readableEndSectionHref?: string | null;
  // ponytail: null when no metadata row or no start anchor pinned.
  readableStartSectionHref?: string | null;
};

export type TtsStartPos = {
  /** Resolve this element id in the section DOM to find the start offset. */
  elementId?: string;
  /** When true, use the viewer's first visible block (current reading page). */
  useVisible?: boolean;
  /** Resolve this CFI range's start to a character offset, expanding a partial first word to the full word. */
  startCfi?: string;
};

export type AudioContextValue = {
  session: AudioSession | null;
  /**
   * bookId of the reader's currently-registered open book (null when the reader
   * hasn't registered one). Consumers gate position-sync on this matching their
   * own bookId so they never act on a stale outgoing book during a swap.
   */
  openBookId: string | null;
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
  ) => Promise<void>;
  /**
   * Navigate the registered viewer to the section currently being read and
   * highlight the chunk now being spoken. Used when the reader re-mounts while
   * playback is active (user left for the bookshelf, audio kept going, came
   * back) — without this the viewer lands on the stale saved position while
   * TTS reads a different section, so the live highlight never lands.
   * No-op when no session, no viewer, the open book differs from the session
   * book, or playback isn't active.
   * Returns true when the section (and chunk, if available) was successfully
   * highlighted; false if preconditions weren't met or the chunk highlight
   * failed and should be retried.
   */
  syncViewerToPlayback: () => Promise<boolean>;
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
  /** Reading speed multiplier (0.5–2). Owned by the provider, persisted via saveTtsPref. */
  voiceSpeed: number;
  setVoiceSpeed: (speed: number) => void;
  /** Open the unified Audio Settings modal. Two entrypoints: TtsPlayer gear icon and BookSettingsPanel button. */
  audioSettingsOpen: boolean;
  openAudioSettings: () => void;
  closeAudioSettings: () => void;
  /** Jump to a section by index in the session playlist. */
  jumpTo: (index: number) => void;

  /** User's persisted playlist items (history + active + upcoming). */
  playlistItems: PlaylistItem[];
  /** Whether the player should auto-advance to the next book section at the end of the queue. */
  autoAdvanceBook: boolean;
  /** Id of the currently active playlist item, if any. */
  activeItemId: string | null;
  /** Computed next readable segment of the active item's book, when
   *  autoAdvanceBook is on and a next readable segment exists. Ephemeral -
   *  not a persisted PlaylistItem until it promotes to active. */
  ghostItem: { sectionHref: string; sectionLabel: string } | null;
  /**
   * Start, queue, or add a book section to the playlist.
   * `now` = add after active (or as first) and start playing.
   * `next`/`last` = add to queue without changing playback.
   */
  playSection: (
    bookId: string,
    href: string,
    label: string,
    mode: "now" | "next" | "last",
    startPos?: TtsStartPos,
    bookMeta?: {
      bookTitle?: string;
      bookAuthor?: string | null;
      bookCoverPath?: string | null;
      bookLanguage?: string;
    },
  ) => Promise<void>;
  /** Jump the playhead to a playlist item and start playing it. */
  jumpToItem: (itemId: string) => Promise<void>;
  /** Remove a single playlist item. */
  removePlaylistItem: (itemId: string) => Promise<void>;
  /** Clear all items and stop, or clear only upcoming items. */
  clearPlaylist: (scope: "all" | "upcoming") => Promise<void>;
  /** Reorder upcoming playlist items. */
  reorderPlaylist: (orderedIds: string[]) => Promise<void>;
  /** Toggle auto-advance to the next book section. */
  setAutoAdvanceBook: (value: boolean) => Promise<void>;
};

export const AudioContext = createContext<AudioContextValue | null>(null);

export function useAudio(): AudioContextValue {
  const ctx = useContext(AudioContext);
  if (!ctx) {
    throw new Error("useAudio must be used within AudioProvider");
  }
  return ctx;
}
