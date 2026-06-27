// ponytail: shape of a discussion row in the homepage Discussions tab.
// Mirrors listAllDiscussionsForUser's Prisma include — every field the UI
// needs to render a row + clickable context chips, without a follow-up
// fetch unless the user opens the detail view (which hits
// GET /api/discussions/<id> for the full message thread).
export type DiscussionListItem = {
  id: string;
  type: "passage" | "section" | "book";
  passageText: string | null;
  passageCfi: string | null;
  sectionHref: string | null;
  language: string;
  createdAt: string;
  updatedAt: string;
  book: {
    id: string;
    title: string;
    author: string | null;
    coverPath: string | null;
    tocJson: string | null;
  };
  attachments: {
    id: string;
    type: string;
    sectionHref: string | null;
    bookId: string | null;
    createdAt: string;
    book: {
      id: string;
      title: string;
      author: string | null;
      coverPath: string | null;
      tocJson: string | null;
    } | null;
  }[];
  explainer: { id: string; content: string; modelId: string } | null;
  _count: { messages: number };
};
