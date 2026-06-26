"use client";

import { useAudio } from "@/components/audio/audio-context";
import type { TtsStartPos } from "@/components/audio/audio-context";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Play } from "lucide-react";
import type { PlaylistBookMeta } from "@/types/playlist";

export interface PlaySectionMenuItemsProps {
  bookId: string;
  sectionHref: string;
  sectionLabel: string;
  bookMeta?: PlaylistBookMeta;
  startPos?: TtsStartPos;
}

export function PlaySectionMenuItems({
  bookId,
  sectionHref,
  sectionLabel,
  bookMeta,
  startPos,
}: PlaySectionMenuItemsProps) {
  const { playlistItems, playSection } = useAudio();
  const hasPlaylist = playlistItems.length > 0;

  async function handle(mode: "now" | "next" | "last") {
    await playSection(bookId, sectionHref, sectionLabel, mode, startPos, bookMeta);
  }

  return (
    <>
      <DropdownMenuItem onClick={() => handle("now")}>
        <Play className="mr-2 h-4 w-4" />
        {hasPlaylist ? "Play now" : "Start reading from here"}
      </DropdownMenuItem>
      {hasPlaylist && (
        <>
          <DropdownMenuItem onClick={() => handle("next")}>
            <Play className="mr-2 h-4 w-4" />
            Play next
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handle("last")}>
            <Play className="mr-2 h-4 w-4" />
            Play last
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}
