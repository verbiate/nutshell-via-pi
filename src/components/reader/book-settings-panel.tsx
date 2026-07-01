"use client";

import { useCallback } from "react";
import { AlignJustify, AlignLeft, Settings } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SmoothScrollArea } from "@/components/library/smooth-scroll-area";
import type { ReaderThemeName } from "./themes";

// ponytail: typography stacks kept here so the panel is the single source for
// what "serif" / "sans" mean visually. Publisher = no override (book's own font).
export const SERIF_STACK = '"IBM Plex Serif", Georgia, "Times New Roman", serif';
export const SANS_STACK = '"DM Sans", system-ui, -apple-system, sans-serif';

export type FontFamilyChoice = "serif" | "sans" | "publisher";
export type AlignmentChoice = "left" | "justify";
export type LineSpacingChoice = 1.4 | 1.5 | 1.65;

export interface BookSettings {
  fontFamily: FontFamilyChoice;
  fontSize: number; // px, 14–24
  alignment: AlignmentChoice;
  lineSpacing: LineSpacingChoice;
}

export const DEFAULT_BOOK_SETTINGS: BookSettings = {
  fontFamily: "serif",
  fontSize: 18,
  alignment: "justify",
  lineSpacing: 1.5,
};

export const BOOK_SETTINGS_MIN_FONT = 14;
export const BOOK_SETTINGS_MAX_FONT = 24;

const CHOCOLATE = "#402A08";

const THEME_SWATCHES: { id: ReaderThemeName; bg: string }[] = [
  { id: "light", bg: "#FEFBF5" },
  { id: "sepia", bg: "#FFFFFF" },
  { id: "dark", bg: CHOCOLATE },
];

const FONT_FAMILY_OPTIONS: { value: FontFamilyChoice; label: string }[] = [
  { value: "serif", label: "Serif" },
  { value: "sans", label: "Sans" },
  { value: "publisher", label: "Publisher" },
];

// ponytail: segmented-control container + item styling matching Figma — a white
// rounded box with a tan-dark border, borderless items, selected item fills tan-dark.
const SEG_GROUP = "border border-line bg-white rounded-[12px] p-1.5";
const SEG_ITEM_SELECTED = "data-[state=on]:bg-tan-dark data-[state=on]:rounded-md";

// ponytail: inline line-stack icons for spacing toggles — lucide has none.
function LineSpacingIcon({ density }: { density: "tight" | "medium" | "relaxed" }) {
  const gap = density === "tight" ? 3 : density === "medium" ? 5 : 7;
  const y2 = 4 + gap + 2;
  const y3 = 4 + 2 * (gap + 2);
  return (
    <svg width="24" height="24" viewBox="0 0 16 16" fill="none" aria-hidden>
      <line x1="2" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1={y2} x2="14" y2={y2} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1={y3} x2="14" y2={y3} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-base font-medium uppercase tracking-wider text-foreground shrink-0">
        {children}
      </span>
      <span className="ml-1 h-px flex-1 bg-line" />
    </div>
  );
}

export interface BookSettingsPanelProps {
  theme: ReaderThemeName;
  onThemeChange: (theme: ReaderThemeName) => void;
  settings: BookSettings;
  onChange: (patch: Partial<BookSettings>) => void;
  onOpenAudioSettings: () => void;
}

export function BookSettingsPanel({
  theme,
  onThemeChange,
  settings,
  onChange,
  onOpenAudioSettings,
}: BookSettingsPanelProps) {
  const handleFontSize = useCallback(
    (v: number[]) => onChange({ fontSize: v[0] }),
    [onChange],
  );

  return (
    // ponytail: no internal header/content split — it's all form fields.
    // Wrap the whole panel in SmoothScrollArea so the shared sidebar header
    // (title/description/icon) stays pinned above; pb-12 + pt-9 give the form
    // uniform margins matching the other panels.
    <SmoothScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-9 pb-12">
        {/* PAGE ADJUSTMENTS */}
        <div className="px-12 flex flex-col gap-5">
          <SectionLabel>Page Adjustments</SectionLabel>

        {/* Theme swatches — tan, white, chocolate. 56px, inner stroke via inset box-shadow. */}
        <div className="flex items-center gap-2.5">
          {THEME_SWATCHES.map((s) => {
            const active = theme === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onThemeChange(s.id)}
                aria-label={`Theme: ${s.id}`}
                aria-pressed={active}
                className="relative size-14 rounded-full transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-espresso/20"
                style={{
                  backgroundColor: s.bg,
                  boxShadow: `inset 0 0 0 ${active ? 2 : 1}px ${CHOCOLATE}`,
                }}
              >
                {active && (
                  <span className={cn(
                    "absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full",
                    s.id === "dark" ? "bg-white" : "bg-espresso",
                  )} />
                )}
              </button>
            );
          })}
        </div>

        {/* Font size slider with T labels */}
        <div className="flex items-center gap-3">
          <span className="font-serif text-2xl leading-none text-foreground">T</span>
          <Slider
            value={[settings.fontSize]}
            min={BOOK_SETTINGS_MIN_FONT}
            max={BOOK_SETTINGS_MAX_FONT}
            step={1}
            onValueChange={handleFontSize}
            aria-label="Text size"
            className="flex-1 [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-thumb]]:size-[22px] [&_[data-slot=slider-thumb]]:border [&_[data-slot=slider-thumb]]:shadow-[0_2px_2px_0_rgba(0,0,0,0.25),0_3px_8.5px_0_rgba(0,0,0,0.25)]"
          />
          <span className="font-serif text-[44px] font-light leading-none text-foreground">T</span>
        </div>

        {/* Alignment + line spacing, side by side */}
        <div className="flex items-center justify-between gap-3">
          <ToggleGroup
            type="single"
            value={settings.alignment}
            onValueChange={(v) => {
              if (v === "left" || v === "justify") onChange({ alignment: v });
            }}
            variant="default"
            className={SEG_GROUP}
          >
            <ToggleGroupItem
              value="left"
              aria-label="Align left"
              className={cn("h-12 px-4 [&_svg]:size-6", SEG_ITEM_SELECTED)}
            >
              <AlignLeft />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="justify"
              aria-label="Justify"
              className={cn("h-12 px-4 [&_svg]:size-6", SEG_ITEM_SELECTED)}
            >
              <AlignJustify />
            </ToggleGroupItem>
          </ToggleGroup>

          <ToggleGroup
            type="single"
            value={String(settings.lineSpacing)}
            onValueChange={(v) => {
              const n = parseFloat(v);
              if (n === 1.4 || n === 1.5 || n === 1.65) {
                onChange({ lineSpacing: n });
              }
            }}
            variant="default"
            className={SEG_GROUP}
          >
            <ToggleGroupItem
              value="1.4"
              aria-label="Tight spacing"
              className={cn("h-12 px-4", SEG_ITEM_SELECTED)}
            >
              <LineSpacingIcon density="tight" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="1.5"
              aria-label="Medium spacing"
              className={cn("h-12 px-4", SEG_ITEM_SELECTED)}
            >
              <LineSpacingIcon density="medium" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="1.65"
              aria-label="Relaxed spacing"
              className={cn("h-12 px-4", SEG_ITEM_SELECTED)}
            >
              <LineSpacingIcon density="relaxed" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* Font family */}
        <ToggleGroup
          type="single"
          value={settings.fontFamily}
          onValueChange={(v) => {
            if (v === "serif" || v === "sans" || v === "publisher") {
              onChange({ fontFamily: v });
            }
          }}
          variant="default"
          className={cn(SEG_GROUP, "w-full")}
        >
          {FONT_FAMILY_OPTIONS.map((opt) => (
            <ToggleGroupItem
              key={opt.value}
              value={opt.value}
              className={cn(
                "h-12 flex-1 text-[20px] tracking-[-0.5px]",
                SEG_ITEM_SELECTED,
              )}
              style={{
                fontFamily:
                  opt.value === "serif"
                    ? SERIF_STACK
                    : opt.value === "sans"
                      ? SANS_STACK
                      : undefined,
              }}
            >
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* AUDIO SETTINGS ENTRY */}
      <div className="px-12 flex flex-col gap-5">
        <SectionLabel>Voice adjustments</SectionLabel>
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={onOpenAudioSettings}
          aria-label="Open audio settings"
        >
          <Settings className="h-3.5 w-3.5" />
          Open audio settings
        </Button>
      </div>
      </div>
    </SmoothScrollArea>
  );
}
