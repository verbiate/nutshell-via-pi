"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Compass, Search } from "lucide-react";
import { DailyDigest } from "./daily-digest";
import { Bookshelf } from "./bookshelf";
import type { LibraryBook } from "@/types/book";

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

interface HomeViewProps {
  userName: string | null;
  books: LibraryBook[];
  digestImage: string | null;
}

export function HomeView({ userName, books, digestImage }: HomeViewProps) {
  // ponytail: greeting computed on mount to respect the viewer's local timezone
  const [greeting, setGreeting] = useState("Hello");
  useEffect(() => {
    setGreeting(timeGreeting());
  }, []);

  const first = userName?.split(" ")[0] || "reader";

  return (
    <Tabs defaultValue="bookshelf" className="w-full">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-[34px] font-medium leading-tight text-espresso">
            {greeting}, {first}
          </h1>
          <p className="text-base text-muted-foreground">
            What will we learn today?
          </p>
        </div>
        <TabsList>
          <TabsTrigger value="bookshelf">Bookshelf</TabsTrigger>
          <TabsTrigger value="explainers">Explainers</TabsTrigger>
          <TabsTrigger value="find">Find more books</TabsTrigger>
        </TabsList>
      </div>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[2fr_3fr]">
        <DailyDigest imageSrc={digestImage} />
        <div>
          <TabsContent value="bookshelf">
            <div className="pb-[138px]">
              <Bookshelf books={books} />
            </div>
            <div className="fixed inset-x-0 bottom-0 h-[138px] backdrop-blur-[14px] bg-paper/60">
              <div className="mx-auto flex h-full max-w-[1280px] items-center px-8">
                {/* ponytail: mirror the 2fr/3fr page grid so the bar centers over the book column */}
                <div className="hidden lg:block lg:flex-[2]" aria-hidden />
                <div className="flex flex-[3] justify-center">
                  <div className="flex w-full max-w-[520px] items-center gap-3 rounded-full border border-line bg-white px-5 py-3.5 shadow-float">
                    <Search className="size-4 shrink-0 text-muted-foreground" />
                    <input
                      type="search"
                      aria-label="Search books"
                      placeholder="Search or ask your books…"
                      className="flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted-foreground/70"
                    />
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="explainers">
            <div className="flex min-h-[50vh] flex-col items-center justify-center">
              <Sparkles className="h-16 w-16 text-muted-foreground" />
              <h2 className="mt-4 font-serif text-[28px] font-medium text-espresso">
                Explainers are brewing
              </h2>
              <p className="mt-2 max-w-[400px] text-center text-base text-muted-foreground">
                Your saved explainers will live here, ready to revisit anytime.
              </p>
            </div>
          </TabsContent>
          <TabsContent value="find">
            <div className="flex min-h-[50vh] flex-col items-center justify-center">
              <Compass className="h-16 w-16 text-muted-foreground" />
              <h2 className="mt-4 font-serif text-[28px] font-medium text-espresso">
                Find your next read
              </h2>
              <p className="mt-2 max-w-[400px] text-center text-base text-muted-foreground">
                Discover and add new books to your shelf from here.
              </p>
            </div>
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}
