"use client";

import * as React from "react";
import { AlignJustify, AlignLeft, Bookmark, BookOpen, Copy, Highlighter, Lightbulb, Pause, Play, Plus, Search as SearchIcon, StickyNote, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BookCard } from "@/components/library/book-card";
import { DailyDigest } from "@/components/library/daily-digest";
import { ReaderChrome } from "@/components/reader/reader-chrome";
import { ReadingProgress } from "@/components/reader/reading-progress";
import { ReaderSidebar } from "@/components/reader/reader-sidebar";
import {
  BookSettingsPanel,
  DEFAULT_BOOK_SETTINGS,
  type BookSettings,
} from "@/components/reader/book-settings-panel";
import type { ReaderThemeName } from "@/components/reader/themes";

const SURFACES = [
  { name: "Paper", token: "bg-paper", hex: "#FBF7EC" },
  { name: "Paper deep", token: "bg-paper-deep", hex: "#F4EEDC" },
  { name: "Espresso", token: "bg-espresso", hex: "#2B1C11" },
  { name: "Lavender soft", token: "bg-lav-soft", hex: "#ECE8FB" },
  { name: "Lavender", token: "bg-lav", hex: "#7E70EA" },
];

const ACCENTS = [
  { name: "orange", cls: "bg-b-orange" },
  { name: "magenta", cls: "bg-b-magenta" },
  { name: "purple", cls: "bg-b-purple" },
  { name: "blue", cls: "bg-b-blue" },
  { name: "teal", cls: "bg-b-teal" },
];

function SectionLabel({ num, title }: { num: string; title: string }) {
  return (
    <div className="mb-5 flex items-baseline gap-3">
      <span className="text-xs font-bold tracking-wider text-muted-foreground">{num}</span>
      <h2 className="font-serif text-2xl font-medium text-espresso">{title}</h2>
      <span className="ml-1 h-px flex-1 bg-line" />
    </div>
  );
}

export default function DesignSystemPage() {
  const [sliderVal, setSliderVal] = React.useState<number[]>([62]);
  const [progressVal, setProgressVal] = React.useState<number[]>([38]);
  const [ttsPlaying, setTtsPlaying] = React.useState(false);
  const [activeTool, setActiveTool] = React.useState<"reader" | "bookmark" | "pen" | "bulb" | "type" | null>("reader");
  const [bookSettings, setBookSettings] = React.useState<BookSettings>(DEFAULT_BOOK_SETTINGS);
  const [readerTheme, setReaderTheme] = React.useState<ReaderThemeName>("light");

  const panels = {
    reader: (
      <div className="px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sample TOC</p>
        <ul className="mt-2 space-y-1 text-sm">
          <li className="rounded-md bg-lav-soft px-3 py-2 font-medium text-foreground">Chapter 1 · The Beginning</li>
          <li className="px-3 py-2 text-foreground">Chapter 2 · The Middle</li>
          <li className="px-3 py-2 text-foreground">Chapter 3 · The End</li>
        </ul>
      </div>
    ),
    bookmark: (
      <div className="px-5 py-4 space-y-3">
        <button className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm font-medium text-foreground">+ Add bookmark</button>
        <div className="rounded-md bg-paper-deep px-3 py-2">
          <p className="truncate text-sm text-foreground">"It was the best of times…"</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">2m ago</p>
        </div>
      </div>
    ),
    pen: (
      <div className="px-5 py-4 space-y-2">
        <div className="flex gap-2">
          <div className="w-1 shrink-0 self-stretch rounded-full" style={{ backgroundColor: "#19E1CA" }} />
          <div>
            <p className="line-clamp-3 text-sm text-foreground">A highlighted passage from chapter one that runs to three lines max.</p>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">Paragraph 4</p>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="w-1 shrink-0 self-stretch rounded-full" style={{ backgroundColor: "#FEC405" }} />
          <div>
            <p className="line-clamp-3 text-sm text-foreground">Another highlight, this time in yellow.</p>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">Paragraph 12</p>
            <button className="mt-1.5 flex w-full items-start gap-1.5 rounded-md bg-paper-deep px-2 py-1.5 text-left text-xs text-foreground">
              <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <span>A short note attached to the highlight.</span>
            </button>
          </div>
        </div>
      </div>
    ),
    bulb: (
      <div className="flex flex-col items-center justify-center gap-3 px-5 py-16 text-center">
        <Lightbulb className="h-10 w-10 text-muted-foreground/40" />
        <div>
          <p className="text-sm font-medium text-foreground">No explainers yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Click "Explain this to me" while reading to generate one.</p>
        </div>
      </div>
    ),
    type: (
      <BookSettingsPanel
        theme={readerTheme}
        onThemeChange={setReaderTheme}
        settings={bookSettings}
        onChange={(patch) => setBookSettings((s) => ({ ...s, ...patch }))}
      />
    ),
  };

  return (
    <div className="min-h-screen text-ink">
      <main className="mx-auto max-w-5xl px-7 py-14">
        <header className="mb-14">
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Component Gallery · Nutshell
          </p>
          <h1 className="mt-1 font-serif text-4xl font-medium leading-tight text-espresso">
            A reading surface with a quiet voice
          </h1>
          <p className="mt-3 max-w-[60ch] text-[15.5px] text-ink/80">
            Warm paper, espresso ink, a coral-to-magenta accent reserved for primary action and
            progress, and a lavender ring for the active tool. UI text is <b>DM Sans</b>; headlines
            and book copy are <b>IBM Plex Serif</b>.
          </p>
        </header>

        {/* 01 Foundations */}
        <section className="mb-14">
          <SectionLabel num="01" title="Foundations" />
          <div className="grid gap-5 md:grid-cols-2">
            <Card className="shadow-card">
              <CardHeader>
                <CardDescription>Surfaces &amp; ink</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4">
                  {SURFACES.map((s) => (
                    <div key={s.name} className="flex flex-col items-start gap-2">
                      <div className={`h-14 w-[74px] rounded-lg border border-black/5 ${s.token}`} />
                      <b className="text-xs font-semibold text-ink">{s.name}</b>
                      <small className="font-mono text-[11px] text-muted-foreground">{s.hex}</small>
                    </div>
                  ))}
                </div>
                <p className="mt-6 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Brand accents
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {ACCENTS.map((a) => (
                    <span key={a.name} className={`size-8 rounded-full ${a.cls}`} title={a.name} />
                  ))}
                  <span className="h-8 w-24 rounded-full bg-grad" />
                </div>

                <p className="mt-6 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Highlighters
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {[
                    { name: "Teal", hex: "#19E1CA" },
                    { name: "Yellow", hex: "#FEC405" },
                    { name: "Pink", hex: "#F168F5" },
                  ].map((h) => (
                    <div key={h.name} className="flex flex-col items-center gap-1">
                      <span className="size-7 rounded-full ring-1 ring-black/5" style={{ backgroundColor: h.hex }} />
                      <small className="font-mono text-[10px] text-muted-foreground">{h.hex}</small>
                    </div>
                  ))}
                </div>

                <p className="mt-6 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Gradient stops
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {[
                    { label: "g1", hex: "#FF7A4D" },
                    { label: "g2", hex: "#FF4E8C" },
                    { label: "g3", hex: "#C932A6" },
                  ].map((g) => (
                    <div key={g.label} className="flex items-center gap-2">
                      <span className="size-7 rounded-full" style={{ backgroundColor: g.hex }} />
                      <div className="flex flex-col">
                        <b className="text-[11px] text-ink">{g.label}</b>
                        <small className="font-mono text-[10px] text-muted-foreground">{g.hex}</small>
                      </div>
                    </div>
                  ))}
                  <span className="h-7 w-20 rounded-full bg-grad" />
                </div>

                <p className="mt-6 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Status gradients
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="rounded-full px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundImage: "linear-gradient(90deg, #FF6A5E, #FF2E7E)" }}>Warn</span>
                  <span className="rounded-full px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundImage: "linear-gradient(90deg, #4FD18B, #2FA86A)" }}>Success</span>
                </div>

                <p className="mt-6 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Radii tokens
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-4">
                  {[
                    { name: "--r-sm", px: "10px", cls: "rounded-[10px]" },
                    { name: "--r-md", px: "16px", cls: "rounded-[16px]" },
                    { name: "--r-lg", px: "22px", cls: "rounded-[22px]" },
                    { name: "--r-pill", px: "999px", cls: "rounded-full" },
                  ].map((r) => (
                    <div key={r.name} className="flex flex-col items-center gap-1">
                      <div className={`h-10 w-16 bg-paper-deep border border-line ${r.cls}`} />
                      <small className="font-mono text-[10px] text-muted-foreground">{r.px}</small>
                    </div>
                  ))}
                </div>

                <p className="mt-6 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Reader geometry
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    "--reader-rail-w: 94px",
                    "--reader-sidebar-w: 400px",
                    "--reader-dur: 250ms",
                  ].map((t) => (
                    <span key={t} className="rounded-md border border-line bg-paper-deep px-2.5 py-1 font-mono text-[11px] text-espresso">
                      {t}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader>
                <CardDescription>Type — IBM Plex Serif &amp; DM Sans</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-baseline gap-4 border-dashed border-line border-b pb-3">
                  <span className="w-28 text-[11px] text-muted-foreground">Display / Serif</span>
                  <span className="font-serif text-3xl text-espresso">The Beginning</span>
                </div>
                <div className="flex items-baseline gap-4 border-dashed border-line border-b pb-3">
                  <span className="w-28 text-[11px] text-muted-foreground">UI label / Sans</span>
                  <span className="text-base font-semibold text-ink">Listen from here</span>
                </div>
                <div className="flex items-baseline gap-4 pb-1">
                  <span className="w-28 text-[11px] text-muted-foreground">Reading / Serif</span>
                  <span className="font-serif text-base text-ink">
                    Quid latine dictum sit, <span className="italic">altum videtur.</span>
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* 02 Actions */}
        <section className="mb-14">
          <SectionLabel num="02" title="Actions" />
          <Card className="shadow-card">
            <CardContent className="space-y-6">
              <div>
                <p className="mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Buttons
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button>
                    <Play /> Listen from here
                  </Button>
                  <Button variant="gradient">
                    <Play /> Listen now
                  </Button>
                  <Button variant="outline">
                    <Bookmark /> Add bookmark
                  </Button>
                  <Button variant="secondary">
                    <Plus /> Add a book
                  </Button>
                  <Button variant="ghost">Ghost</Button>
                </div>
              </div>
              <div>
                <p className="mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Icon buttons
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="icon" aria-label="Play">
                    <Play />
                  </Button>
                  <Button size="icon" variant="outline" aria-label="Bookmark">
                    <Bookmark />
                  </Button>
                  <Button size="icon" variant="gradient" aria-label="Add">
                    <Plus />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* 03 Navigation */}
        <section className="mb-14">
          <SectionLabel num="03" title="Navigation" />
          <div className="grid gap-5 md:grid-cols-2">
            <Card className="shadow-card">
              <CardHeader>
                <CardDescription>Segmented — shelf tabs</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="shelf">
                  <TabsList variant="default">
                    <TabsTrigger value="shelf">Bookshelf</TabsTrigger>
                    <TabsTrigger value="explainers">Explainers</TabsTrigger>
                    <TabsTrigger value="find">Find more books</TabsTrigger>
                  </TabsList>
                  <TabsContent value="shelf" className="mt-3 text-sm text-muted-foreground">
                    Bookshelf content.
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
            <Card className="shadow-card">
              <CardHeader>
                <CardDescription>Sort — underline tabs</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="date">
                  <TabsList variant="line">
                    <TabsTrigger value="date">Date</TabsTrigger>
                    <TabsTrigger value="chapter">Chapter</TabsTrigger>
                    <TabsTrigger value="color">Color</TabsTrigger>
                  </TabsList>
                  <TabsContent value="date" className="mt-3 text-sm text-muted-foreground">
                    Sorted by date.
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* 04 Book Settings */}
        <section className="mb-14">
          <SectionLabel num="04" title="Book Settings" />
          <div className="grid gap-5 md:grid-cols-2">
            <Card className="shadow-card">
              <CardHeader>
                <CardDescription>Text size · gradient slider</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-4">
                  <span className="font-serif text-sm text-muted-foreground">T</span>
                  <Slider
                    value={sliderVal}
                    onValueChange={setSliderVal}
                    max={100}
                    step={1}
                    aria-label="Text size"
                  />
                  <span className="font-serif text-2xl text-muted-foreground">T</span>
                </div>
                <p className="text-xs text-muted-foreground">Value: {sliderVal[0]}%</p>
              </CardContent>
            </Card>
            <Card className="shadow-card">
              <CardHeader>
                <CardDescription>Page color &amp; alignment</CardDescription>
              </CardHeader>
              <CardContent>
                <RadioGroup defaultValue="cream" className="flex gap-4">
                  {[
                    { id: "cream", label: "Cream", cls: "bg-paper" },
                    { id: "white", label: "White", cls: "bg-white" },
                    { id: "dark", label: "Dark", cls: "bg-espresso" },
                  ].map((opt) => (
                    <div key={opt.id} className="flex items-center gap-2">
                      <RadioGroupItem value={opt.id} id={`pc-${opt.id}`} />
                      <Label htmlFor={`pc-${opt.id}`} className="flex items-center gap-2">
                        <span className={`size-6 rounded-full border border-line ${opt.cls}`} />
                        {opt.label}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
                <p className="mt-6 mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Alignment
                </p>
                <ToggleGroup type="single" defaultValue="left" variant="outline">
                  <ToggleGroupItem value="left" aria-label="Align left">
                    <AlignLeft />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="justify" aria-label="Justify">
                    <AlignJustify />
                  </ToggleGroupItem>
                </ToggleGroup>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* 05 Progress & Search */}
        <section className="mb-14">
          <SectionLabel num="05" title="Progress & Search" />
          <Card className="shadow-card">
            <CardContent className="space-y-5">
              <div>
                <p className="mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Page scrubber (gradient fill)
                </p>
                <Slider defaultValue={[38]} max={100} aria-label="Page" />
              </div>
              <div>
                <p className="mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Ask bar
                </p>
                <div className="flex items-center gap-3 rounded-full border border-line bg-white px-5 py-3.5 text-muted-foreground shadow-float">
                  <SearchIcon className="size-4" />
                  <input
                    className="flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted-foreground/70"
                    placeholder="Search or ask your books…"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* 06 Library */}
        <section className="mb-14">
          <SectionLabel num="06" title="Library" />
          <div className="grid gap-5">
            <Card className="shadow-card">
              <CardHeader>
                <CardDescription>BookCard · shadow-book + hover lift + progress slot</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] items-end gap-x-5 gap-y-6">
                  {/* ponytail: placeholder variant exercises the built-in fallback when there is no cover image. */}
                  <BookCard id="demo-0" title="The Rustic Drawer" author="Nutra Vell" coverPath={null} />
                  {/* ponytail: demo-cover variants inline — BookCard's coverPath routes through /api/files/, which a public asset can't satisfy. Mirrors BookCard's classes verbatim so the shadow reads identically. */}
                  <a href="/book/demo-1/reader" className="group block rounded-md">
                    <div className="transition-transform duration-200 ease-out group-hover:-translate-y-[1%]">
                      <div className="overflow-hidden rounded-md bg-paper-deep shadow-book transition-[filter] duration-200 ease-out group-hover:shadow-book-lifted">
                        <img src="/demo-cover.svg" alt="The Sample Book" className="block h-auto w-full scale-[1.02]" />
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 w-full" />
                  </a>

                  <a href="/book/demo-2/reader" className="group block rounded-md">
                    <div className="transition-transform duration-200 ease-out group-hover:-translate-y-[1%]">
                      <div className="overflow-hidden rounded-md bg-paper-deep shadow-book transition-[filter] duration-200 ease-out group-hover:shadow-book-lifted">
                        <img src="/demo-cover.svg" alt="The Sample Book" className="block h-auto w-full scale-[1.02]" />
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 w-full">
                      <div className="h-full w-full overflow-hidden rounded-full bg-black/10" role="progressbar" aria-valuenow={62} aria-valuemin={0} aria-valuemax={100} aria-label="Reading progress: 62%">
                        <div className="h-full rounded-full bg-grad transition-all duration-300" style={{ width: "62%" }} />
                      </div>
                    </div>
                  </a>
                </div>
                <p className="mt-4 text-[11px] text-muted-foreground">
                  Hover any cover to lift it: <code className="font-mono">group-hover:-translate-y-[1%]</code> on the
                  outer wrapper, <code className="font-mono">group-hover:shadow-book-lifted</code> on the inner.
                  The progress slot is a fixed <code className="font-mono">h-1.5</code> whether filled or not, so
                  covers share a common baseline.
                </p>
              </CardContent>
            </Card>

            <div className="grid gap-5 md:grid-cols-2">
              <Card className="shadow-card">
                <CardHeader>
                  <CardDescription>DailyDigest · espresso card with badge + orange CTA</CardDescription>
                </CardHeader>
                <CardContent>
                  {/* ponytail: imageSrc=null uses the espresso fallback — real component. */}
                  <DailyDigest imageSrc={null} />
                </CardContent>
              </Card>

              <Card className="shadow-card">
                <CardHeader>
                  <CardDescription>Empty-state pattern · icon + serif headline + subtext</CardDescription>
                </CardHeader>
                <CardContent>
                  {/* ponytail: shared empty-state pattern reused by EmptyLibrary and the Explainers/Find tabs. */}
                  <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
                    <BookOpen className="h-16 w-16 text-muted-foreground" />
                    <h3 className="mt-4 font-serif text-[28px] font-medium text-espresso">
                      Your library is empty
                    </h3>
                    <p className="mt-2 max-w-[400px] text-base text-muted-foreground">
                      Upload your first EPUB to start reading with AI-powered explanations.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* 07 Reader chrome */}
        <section className="mb-14">
          <SectionLabel num="07" title="Reader chrome" />
          <Card className="shadow-card">
            <CardHeader>
              <CardDescription>ReaderChrome + ReadingProgress + TtsPlayer mirror · all in a contained frame</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* ponytail: relative frame so absolute-positioned children anchor here, not the viewport. */}
              <div className="relative h-[460px] overflow-hidden rounded-xl border border-line bg-paper">
                <ReaderChrome
                  onBack={() => {}}
                  searchTrigger={
                    <button aria-label="Search in book" className="flex h-[46px] w-[46px] items-center justify-center bg-transparent text-foreground">
                      <SearchIcon className="h-4 w-4" />
                    </button>
                  }
                  ttsTrigger={
                    <button aria-label="Read aloud" className="flex h-[46px] w-[46px] items-center justify-center bg-transparent text-foreground">
                      <Volume2 className="h-4 w-4" />
                    </button>
                  }
                  sidebarOpen={false}
                />
                <ReadingProgress percentage={progressVal[0]} />

                {/* ponytail: demo mirror — original TtsPlayer uses `fixed bottom-0` bound to reader viewport; mirrored here with relative so the showcase frame contains it. */}
                <div
                  className="absolute bottom-0 left-0 right-0 flex h-16 items-center gap-3 border-t border-border bg-background/95 px-4 backdrop-blur-sm"
                  role="region"
                  aria-label="Audio player (demo mirror)"
                >
                  <button
                    type="button"
                    onClick={() => setTtsPlaying((p) => !p)}
                    aria-label={ttsPlaying ? "Pause" : "Play"}
                    className="flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-accent"
                  >
                    {ttsPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <span className="truncate text-sm font-medium text-foreground">Section 1 · The Beginning</span>
                  <div className="flex-1" />
                  <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">0:00 / 4:12</span>
                </div>
              </div>

              <div>
                <p className="mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Scrub the progress bar
                </p>
                <Slider value={progressVal} onValueChange={setProgressVal} max={100} aria-label="Progress" />
              </div>
            </CardContent>
          </Card>
        </section>

        {/* 08 Reader sidebar */}
        <section className="mb-14">
          <SectionLabel num="08" title="Reader sidebar" />
          <Card className="shadow-card">
            <CardHeader>
              <CardDescription>ReaderSidebar · rail toggle swaps the panel content</CardDescription>
            </CardHeader>
            <CardContent>
              {/* ponytail: relative frame sized to the sidebar geometry so the absolute rail+panel sit correctly. */}
              <div className="relative h-[560px] overflow-hidden rounded-xl border border-line bg-paper">
                <ReaderSidebar activeTool={activeTool} onToolClick={(id) => setActiveTool(id)} panels={panels} />
                {/* ponytail: spacer text to show the "book" surface the sidebar slides over. */}
                <div className="flex h-full items-center justify-center pr-[calc(var(--reader-rail-w)+var(--reader-sidebar-w))]">
                  <p className="font-serif text-lg text-muted-foreground/50">Book content sits here</p>
                </div>
              </div>
              <p className="mt-4 text-[11px] text-muted-foreground">
                Click any rail button. The active button gets <code className="font-mono">border-lav bg-lav-soft</code> with
                a <code className="font-mono">0_0_0_4px_rgba(126,112,234,0.12)</code> ring.
              </p>

              {/*
                ponytail: ReaderSidebar only mounts panels[displayedTool], so at SSR with the
                default "reader" tool the Book Settings panel would be invisible. Rendering it
                standalone here makes the settings tool visible without a click — same pattern
                Task 5 uses. The panels.type slot above stays live for the interactive rail.
              */}
              <div className="mt-6">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Book Settings panel · always visible
                </p>
                <div className="rounded-xl border border-line bg-paper">
                  <BookSettingsPanel
                    theme={readerTheme}
                    onThemeChange={setReaderTheme}
                    settings={bookSettings}
                    onChange={(patch) => setBookSettings((s) => ({ ...s, ...patch }))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* 09 Selection & settings */}
        <section className="mb-14">
          <SectionLabel num="09" title="Selection & settings" />
          <Card className="shadow-card">
            <CardHeader>
              <CardDescription>FloatingToolbar mirror · Ask / Copy / highlight swatches</CardDescription>
            </CardHeader>
            <CardContent>
              {/* ponytail: relative frame positions the toolbar statically above the paragraph. The real FloatingToolbar uses createPortal to document.body and fixed positioning bound to the reader viewport. */}
              <div className="relative rounded-lg border border-line bg-paper p-8 pt-20">
                <div
                  className="absolute left-1/2 top-4 z-10 flex w-[220px] -translate-x-1/2 flex-col rounded-xl border border-border bg-popover p-1.5 shadow-[0_8px_30px_-6px_rgba(43,28,17,0.25)]"
                  role="toolbar"
                  aria-label="Text selection actions (demo mirror)"
                >
                  <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-accent">
                    <Lightbulb className="h-4 w-4 text-lav" />
                    Ask about this
                  </button>
                  <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-accent">
                    <Copy className="h-4 w-4" />
                    Copy
                  </button>
                  <div className="my-1 h-px bg-border" />
                  <div className="flex items-center gap-2 px-3 pb-1.5 pt-0.5">
                    <Highlighter className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Create a note:</span>
                  </div>
                  <div className="mx-auto mb-1 flex items-center gap-4 rounded-full border border-border/60 bg-background/40 px-4 py-2">
                    {["#19E1CA", "#FEC405", "#F168F5"].map((c) => (
                      <span key={c} className="size-6 rounded-full ring-1 ring-black/5" style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
                <p className="font-serif text-base leading-relaxed text-ink">
                  It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of
                  foolishness, it was the epoch of belief, it was the epoch of incredulity…
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <footer className="mt-14 border-t border-line pt-5 text-xs text-muted-foreground">
          <b className="text-ink">Notes.</b> Sections 01–05 cover primitives; 06–09 showcase composite app components.
          Tokens live as CSS custom properties on{" "}
          <code className="rounded border border-line bg-paper-deep px-1.5 py-0.5 font-mono text-[0.85em] text-espresso">
            :root
          </code>{" "}
          and map into the Tailwind theme. Components are imported from{" "}
          <code className="rounded border border-line bg-paper-deep px-1.5 py-0.5 font-mono text-[0.85em] text-espresso">
            @/components
          </code>{" "}
          so this page tracks the real implementations.
        </footer>
      </main>
    </div>
  );
}
