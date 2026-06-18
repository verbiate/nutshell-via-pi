export interface ReaderTool {
  id: "reader" | "bookmark" | "pen" | "bulb" | "type";
  label: string;
  icon: "book-open" | "bookmark" | "pen-line" | "lightbulb" | "type";
}

export const READER_TOOLS: ReaderTool[] = [
  { id: "reader", label: "Reader", icon: "book-open" },
  { id: "bookmark", label: "Bookmarks", icon: "bookmark" },
  { id: "pen", label: "Highlights", icon: "pen-line" },
  { id: "bulb", label: "Explain", icon: "lightbulb" },
  { id: "type", label: "Text settings", icon: "type" },
];

// ponytail: tools map 1:1 to sections in screenshot order; lookup lives here so it's testable.
export function sectionNumberFor(id: ReaderTool["id"]): number {
  const idx = READER_TOOLS.findIndex((t) => t.id === id);
  return idx + 1;
}
