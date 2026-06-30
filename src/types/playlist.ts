export type PlaylistItemStatus = "upcoming" | "active" | "history";

/** Discriminator: a section track reads from a book chapter; a text track
 *  speaks arbitrary text (e.g. a discussion reply). */
export type PlaylistItemKind = "section" | "text";

export type PlaylistItem = {
  id: string;
  userId: string;
  kind: PlaylistItemKind;
  bookId: string | null;
  sectionHref: string | null;
  sectionLabel: string | null;
  /** Full text to speak when kind === "text". Null for section tracks. */
  text: string | null;
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
