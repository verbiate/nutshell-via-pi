import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BookshopBanner() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-white p-6 shadow-book">
      <div className="flex items-center justify-between gap-6">
        <div className="max-w-[340px]">
          <h3 className="font-serif text-xl font-medium text-espresso">
            Support indie bookstores
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Nutshell supports books in the EPUB format. We recommend the indie
            bookstore Bookshop.org.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 gap-1.5 rounded-full bg-white"
            asChild
          >
            <a
              href="https://bookshop.org"
              target="_blank"
              rel="noopener noreferrer"
            >
              Visit Bookshop.org
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </Button>
        </div>

        {/* ponytail: decorative stacked covers for visual balance. CSS-only so
            the banner never blocks on real cover assets. */}
        <div className="hidden min-w-[140px] sm:block">
          <div className="relative h-[110px] w-[140px]">
            <div className="absolute left-[52px] top-0 h-[100px] w-[68px] rotate-[-12deg] rounded-sm bg-gradient-to-br from-amber-200 to-orange-300 shadow-book" />
            <div className="absolute left-[28px] top-2 h-[100px] w-[68px] rotate-[-6deg] rounded-sm bg-gradient-to-br from-teal-200 to-emerald-300 shadow-book" />
            <div className="absolute left-4 top-4 h-[100px] w-[68px] rotate-[6deg] rounded-sm bg-gradient-to-br from-indigo-200 to-violet-300 shadow-book" />
          </div>
        </div>
      </div>
    </div>
  );
}
