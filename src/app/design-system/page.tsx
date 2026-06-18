"use client";

import * as React from "react";
import { AlignJustify, AlignLeft, Bookmark, Play, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

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
                  <Search className="size-4" />
                  <input
                    className="flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted-foreground/70"
                    placeholder="Search or ask your books…"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <footer className="mt-14 border-t border-line pt-5 text-xs text-muted-foreground">
          <b className="text-ink">Notes.</b> Tokens live as CSS custom properties on{" "}
          <code className="rounded border border-line bg-paper-deep px-1.5 py-0.5 font-mono text-[0.85em] text-espresso">
            :root
          </code>{" "}
          and map into the Tailwind theme. Hex values are estimates from the reference; swap in
          exact brand tokens when wired.
        </footer>
      </main>
    </div>
  );
}
