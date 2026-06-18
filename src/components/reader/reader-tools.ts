export interface ReaderTool {
  id: "reader" | "bookmark" | "pen" | "bulb" | "type";
  label: string;
  icon: "book-open" | "bookmark" | "pen-line" | "lightbulb" | "type";
}

export const READER_TOOLS: ReaderTool[] = [
  { id: "reader", label: "Contents", icon: "book-open" },
  { id: "bookmark", label: "Bookmarks", icon: "bookmark" },
  { id: "pen", label: "Notes + Highlights", icon: "pen-line" },
  { id: "bulb", label: "Explainers", icon: "lightbulb" },
  { id: "type", label: "Book Settings", icon: "type" },
];
