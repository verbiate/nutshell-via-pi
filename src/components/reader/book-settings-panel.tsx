"use client";

import { useCallback } from "react";
import { AlignJustify, AlignLeft, Settings } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

const THEME_SWATCHES: { id: ReaderThemeName; bg: string }[] = [
  { id: "light", bg: "#FEFBF5" },
  { id: "sepia", bg: "#f4ecd8" },
  { id: "dark", bg: "#1A130C" },
];

const FONT_FAMILY_OPTIONS: { value: FontFamilyChoice; label: string }[] = [
  { value: "serif", label: "Serif" },
  { value: "sans", label: "Sans" },
  { value: "publisher", label: "Publisher" },
];

// ponytail: inline line-stack icons for spacing toggles — lucide has none.
function LineSpacingIcon({ density }: { density: "tight" | "medium" | "relaxed" }) {
  const gap = density === "tight" ? 3 : density === "medium" ? 5 : 7;
  const y2 = 4 + gap + 2;
  const y3 = 4 + 2 * (gap + 2);
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <line x1="2" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1={y2} x2="14" y2={y2} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1={y3} x2="14" y2={y3} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
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
    <div className="flex flex-col gap-9">
      {/* PAGE ADJUSTMENTS */}
      <div className="px-12 flex flex-col gap-5">
        <SectionLabel>Page Adjustments</SectionLabel>

        {/* Theme swatches */}
        <div className="flex items-center gap-3">
          {THEME_SWATCHES.map((s) => {
            const active = theme === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onThemeChange(s.id)}
                aria-label={`Theme: ${s.id}`}
                aria-pressed={active}
                className={cn(
                  "relative h-11 w-11 rounded-full border-2 transition-shadow",
                  active
                    ? "border-lav ring-2 ring-lav/20"
                    : "border-line hover:border-lav-ring",
                )}
                style={{ backgroundColor: s.bg }}
              >
                {active && (
                  <span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-espresso" />
                )}
              </button>
            );
          })}
        </div>

        {/* Font size slider with T labels */}
        <div className="flex items-center gap-3">
          <span className="font-serif text-sm text-muted-foreground">T</span>
          <Slider
            value={[settings.fontSize]}
            min={BOOK_SETTINGS_MIN_FONT}
            max={BOOK_SETTINGS_MAX_FONT}
            step={1}
            onValueChange={handleFontSize}
            aria-label="Text size"
            className="flex-1"
          />
          <span className="font-serif text-2xl text-muted-foreground">T</span>
        </div>

        {/* Alignment */}
        <ToggleGroup
          type="single"
          value={settings.alignment}
          onValueChange={(v) => {
            if (v === "left" || v === "justify") onChange({ alignment: v });
          }}
          variant="outline"
        >
          <ToggleGroupItem value="left" aria-label="Align left">
            <AlignLeft className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="justify" aria-label="Justify">
            <AlignJustify className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>

        {/* Line spacing */}
        <ToggleGroup
          type="single"
          value={String(settings.lineSpacing)}
          onValueChange={(v) => {
            const n = parseFloat(v);
            if (n === 1.4 || n === 1.5 || n === 1.65) {
              onChange({ lineSpacing: n });
            }
          }}
          variant="outline"
        >
          <ToggleGroupItem value="1.4" aria-label="Tight spacing">
            <LineSpacingIcon density="tight" />
          </ToggleGroupItem>
          <ToggleGroupItem value="1.5" aria-label="Medium spacing">
            <LineSpacingIcon density="medium" />
          </ToggleGroupItem>
          <ToggleGroupItem value="1.65" aria-label="Relaxed spacing">
            <LineSpacingIcon density="relaxed" />
          </ToggleGroupItem>
        </ToggleGroup>

        {/* Font family */}
        <ToggleGroup
          type="single"
          value={settings.fontFamily}
          onValueChange={(v) => {
            if (v === "serif" || v === "sans" || v === "publisher") {
              onChange({ fontFamily: v });
            }
          }}
          variant="outline"
        >
          {FONT_FAMILY_OPTIONS.map((opt) => (
            <ToggleGroupItem key={opt.value} value={opt.value}>
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* AUDIO SETTINGS ENTRY */}
      <div className="px-12 flex flex-col gap-5">
        <SectionLabel>Audio</SectionLabel>
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
  );
}