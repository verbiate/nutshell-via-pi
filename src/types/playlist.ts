export type PlaylistItemStatus = "upcoming" | "active" | "history";

export type PlaylistItem = {
  id: string;
  userId: string;
  bookId: string;
  sectionHref: string;
  sectionLabel: string;
  position: number;
  status: PlaylistItemStatus;
  bookTitle: string | null;
  bookAuthor: string | null;
  bookCoverPath: string | null;
  bookLanguage: string;
  addedAt: string;
  playedAt: string | null;
};

export type PlaylistBookMeta = {
  bookTitle?: string;
  bookAuthor?: string | null;
  bookCoverPath?: string | null;
  bookLanguage?: string;
};

export type PlaylistSnapshot = {
  items: PlaylistItem[];
  autoAdvanceBook: boolean;
};
