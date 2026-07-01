"use client";

import { useState } from "react";
import { Volume2, Loader2, Play, ChevronUp, ChevronDown, ListEnd } from "lucide-react";
import { useAudio } from "@/components/audio/audio-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Footer affordance on an assistant discussion reply: speak the message via
 * the shared TTS pipeline. Single always-visible button labeled "Read this
 * aloud". When nothing is playing, it starts immediately (Play now). When
 * something is already active (playing/paused), it opens a modal so the user
 * can choose Play now (interrupt) vs Play next / Play last (queue) — the same
 * three options the ToC and selection menus expose for book sections.
 *
 * ponytail: the track is identified by its text content. playText dedupes a
 * re-request for the same active text into a play/pause toggle, so there's no
 * need for a synthetic track id here.
 */
export function ReadAloudButton({
  text,
  label,
  disabled,
}: {
  text: string;
  label: string;
  disabled?: boolean;
}) {
  const { playText, playlistItems, activeItemId, playbackState } = useAudio();
  const [open, setOpen] = useState(false);

  const activeItem = activeItemId
    ? playlistItems.find((i) => i.id === activeItemId) ?? null
    : null;
  const isThisPlaying =
    activeItem?.kind === "text" && activeItem.text === text;
  const hasPlaylist = playlistItems.length > 0;
  // "Active" = audio currently playing or paused (or loading). When active,
  // interrupting vs queueing is a real choice → open the modal.
  const isActive =
    playbackState.state !== "IDLE" && playbackState.state !== "ENDED";
  // ponytail: non-clickable while this reply is the active audio track
  // (Reading…/Reading/spinner) OR its text is still streaming in from the LLM.
  const isDisabled = disabled || isThisPlaying;

  async function handlePrimary() {
    if (isActive) {
      setOpen(true);
      return;
    }
    await playText(text, label, "now");
  }

  async function handleMode(mode: "now" | "next" | "last") {
    setOpen(false);
    await playText(text, label, mode);
  }

  return (
    <>
      <div className="mt-1 flex items-center">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handlePrimary}
          disabled={isDisabled}
          className="h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
          aria-label="Read this aloud"
        >
          {isThisPlaying && playbackState.state === "GENERATING" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Volume2 className="h-3.5 w-3.5" />
          )}
          {isThisPlaying
            ? playbackState.state === "PLAYING"
              ? "Reading…"
              : "Reading"
            : "Read this aloud"}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Read this aloud</DialogTitle>
            <DialogDescription className="line-clamp-2">
              {label}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-1">
            <Button
              variant="default"
              onClick={() => handleMode("now")}
              className="justify-start"
            >
              <Play className="mr-2 h-4 w-4" />
              Play now
            </Button>
            {hasPlaylist && (
              <>
                <Button
                  variant="outline"
                  onClick={() => handleMode("next")}
                  className="justify-start"
                >
                  <ChevronUp className="mr-2 h-4 w-4" />
                  Play next
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleMode("last")}
                  className="justify-start"
                >
                  <ListEnd className="mr-2 h-4 w-4" />
                  Play last
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
