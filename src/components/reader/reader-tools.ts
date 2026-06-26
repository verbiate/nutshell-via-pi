export interface ReaderTool {
  id: "reader" | "bookmark" | "pen" | "bulb" | "type";
  label: string;
  description: string;
  icon: "book-open" | "bookmark" | "pen-line" | "lightbulb" | "type";
}

export const READER_TOOLS: ReaderTool[] = [
  {
    id: "reader",
    label: "Contents",
    description: "Jump to any chapter or section.",
    icon: "book-open",
  },
  {
    id: "bookmark",
    label: "Bookmarks",
    description: "Save and revisit your favorite passages.",
    icon: "bookmark",
  },
  {
    id: "pen",
    label: "Notes + Highlights",
    description: "Review your highlights and annotations.",
    icon: "pen-line",
  },
  {
    id: "bulb",
    label: "Discussions",
    description: "Ask questions about the book, a section, or a passage.",
    icon: "lightbulb",
  },
  {
    id: "type",
    label: "Book Settings",
    description: "Adjust typography, theme, and voice.",
    icon: "type",
  },
];
