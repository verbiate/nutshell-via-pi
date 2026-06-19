"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

      <TabsContent value="bookshelf">
        <div className="mt-8 grid gap-6 lg:grid-cols-[2fr_3fr]">
          <DailyDigest imageSrc={digestImage} />
          <Bookshelf books={books} />
        </div>
      </TabsContent>
      <TabsContent value="explainers" />
      <TabsContent value="find" />
    </Tabs>
  );
}
