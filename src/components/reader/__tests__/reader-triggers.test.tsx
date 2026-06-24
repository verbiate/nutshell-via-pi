import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchPanel } from "../search-panel";

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: () => null,
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => children,
  SheetTrigger: ({ children }: { children: React.ReactNode }) => children,
  SheetContent: () => null,
  SheetHeader: () => null,
  SheetTitle: () => null,
}));

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

describe("reader top-bar triggers match the 46px chrome height", () => {
  it("Search trigger button is 46px and fill-less", () => {
    const html = render(<SearchPanel bookId="b" onResultClick={() => {}} />);
    const btn = html.match(/<button[^>]*>/)?.[0];
    expect(btn, "Search trigger button should be present").toBeTruthy();
    expect(btn!).toContain("h-[46px]");
    expect(btn!).toContain("bg-transparent");
  });
});
