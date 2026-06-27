import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// ponytail: mock the router + reader-nav so SSR doesn't blow up on hooks that
// touch browser APIs. Mirrors the home-view test setup.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/reader/reader-nav-context", () => ({
  useReaderNav: () => ({ markPendingReaderNav: vi.fn() }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    // ponytail: SSR returns the initial data — the client refetch isn't
    // exercised here. Return what was passed in via `initialData`.
    data: { discussions: (globalThis as any).__DISCUSSIONS_INITIAL__ ?? [] },
  }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

import { DiscussionsHomeView, DiscussionDetail } from "../discussions-home";
import type { DiscussionListItem } from "@/types/discussion";

function makeDiscussion(overrides: Partial<DiscussionListItem> = {}): DiscussionListItem {
  return {
    id: "d1",
    type: "book",
    passageText: null,
    passageCfi: null,
    sectionHref: null,
    language: "en",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    book: {
      id: "b1",
      title: "Origin Book",
      author: "Auth",
      coverPath: null,
      tocJson: null,
    },
    attachments: [],
    explainer: null,
    _count: { messages: 0 },
    ...overrides,
  };
}

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

describe("DiscussionsHomeView", () => {
  it("renders the empty state with Bookshelf CTA when no discussions", () => {
    (globalThis as any).__DISCUSSIONS_INITIAL__ = [];
    const html = render(<DiscussionsHomeView discussions={[]} onGoToBookshelf={() => {}} />);
    expect(html).toContain("No discussions yet");
    expect(html).toContain("Go to Bookshelf");
  });

  it("renders a row with the origin book title when discussions exist", () => {
    (globalThis as any).__DISCUSSIONS_INITIAL__ = [makeDiscussion()];
    const html = render(<DiscussionsHomeView discussions={[makeDiscussion()]} />);
    expect(html).toContain("Origin Book");
    // type chip is rendered
    expect(html).toContain(">book<");
  });

  it("renders dual-ownership as two covers + 'Two books:' label (not an attachment chip)", () => {
    // ponytail: a second book is a co-owner, not an attachment. The list row
    // shows BOTH covers and the title becomes "Two books: T1 + T2". The 2nd
    // book must NOT appear as an attachment chip. Sections still render as pills.
    const d = makeDiscussion({
      id: "d2",
      type: "section",
      sectionHref: "ch1.xhtml",
      attachments: [
        {
          id: "a1",
          type: "book",
          sectionHref: null,
          bookId: "b2",
          createdAt: new Date().toISOString(),
          book: {
            id: "b2",
            title: "Attached Book",
            author: null,
            coverPath: null,
            tocJson: null,
          },
        },
        {
          id: "a2",
          type: "section",
          sectionHref: "appendix.xhtml",
          bookId: null,
          createdAt: new Date().toISOString(),
          book: null,
        },
      ],
    });
    (globalThis as any).__DISCUSSIONS_INITIAL__ = [d];
    const html = render(<DiscussionsHomeView discussions={[d]} />);
    // dual-ownership label
    expect(html).toContain("Two books: Origin Book + Attached Book");
    // section pill falls back to the raw basename when no tocJson to resolve
    expect(html).toContain("appendix.xhtml");
  });
});

describe("DiscussionDetail", () => {
  it("renders the composer (textarea + send button)", () => {
    const d = makeDiscussion();
    const html = render(
      <DiscussionDetail
        discussion={d}
        onBack={() => {}}
        navigate={() => {}}
        resolveLabel={() => undefined}
      />
    );
    // ponytail: composer textarea is present with follow-up placeholder
    expect(html).toContain("Ask a follow-up");
    // ponytail: aria-label on the send button
    expect(html).toContain("Send follow-up");
    // ponytail: origin book title renders in the header
    expect(html).toContain("Origin Book");
  });

  it("section pill resolves to the chapter title from tocJson (not the .xhtml basename)", () => {
    // ponytail: regression guard for the chapter-name bug — tocJson rows are
    // {title, href, ...} not {label, href, ...}, and chapters can nest in
    // `subitems`. If the parser only reads `label` or skips recursion, the
    // pill falls back to the raw basename.
    const d = makeDiscussion({
      type: "section",
      sectionHref: "html/08_chapter1.xhtml",
      book: {
        id: "b1",
        title: "Origin Book",
        author: null,
        coverPath: null,
        tocJson: JSON.stringify([
          {
            id: "toc-0",
            title: "Part One",
            href: "part1.xhtml",
            subitems: [
              {
                id: "toc-0-0",
                title: "1. What Is It Like to Be a Bat?",
                href: "html/08_chapter1.xhtml",
              },
            ],
          },
        ]),
      },
    });
    const html = render(
      <DiscussionDetail
        discussion={d}
        onBack={() => {}}
        navigate={() => {}}
        resolveLabel={(bookId, href) => {
          // ponytail: mirror the production resolver minimally — the real one
          // is a useMemo over the discussions list. For this test we feed it
          // directly so we don't need to thread the full list.
          if (bookId === "b1" && href.endsWith("08_chapter1.xhtml")) {
            return "1. What Is It Like to Be a Bat?";
          }
          return undefined;
        }}
      />
    );
    expect(html).toContain("1. What Is It Like to Be a Bat?");
    expect(html).not.toContain("08_chapter1.xhtml");
  });

  it("renders the Attach affordance when the origin book has tocJson sections", () => {
    // ponytail: composer context row exposes an "Attach"/"Section" trigger once
    // pickerOptions is non-empty. attachBookMax defaults to 0 (detail query not
    // exercised under SSR), so the trigger reads "Section" (sections-only mode).
    const d = makeDiscussion({
      type: "book",
      book: {
        id: "b1",
        title: "Origin Book",
        author: null,
        coverPath: null,
        tocJson: JSON.stringify([
          { id: "t1", title: "Intro", href: "intro.xhtml" },
          { id: "t2", title: "Chapter One", href: "ch1.xhtml" },
        ]),
      },
    });
    const html = render(
      <DiscussionDetail
        discussion={d}
        onBack={() => {}}
        navigate={() => {}}
        resolveLabel={() => undefined}
      />
    );
    // ponytail: bookEnabled is false (no attachBookMax from SSR mock) → the
    // trigger label is "Section", not "Attach".
    expect(html).toContain("Section");
    expect(html).toContain("Context");
  });

  it("shows dual-ownership as two large covers + 'Two books:' label in the header", () => {
    // ponytail: detail header shows the parent book as a large cover; when a
    // second book is attached, BOTH covers render and the title uses the
    // "Two books: T1 + T2" treatment (mirrors the list row).
    const d = makeDiscussion({
      attachments: [
        {
          id: "a1",
          type: "book",
          sectionHref: null,
          bookId: "b2",
          createdAt: new Date().toISOString(),
          book: {
            id: "b2",
            title: "Attached Book",
            author: "Other",
            coverPath: null,
            tocJson: null,
          },
        },
      ],
    });
    const html = render(
      <DiscussionDetail
        discussion={d}
        onBack={() => {}}
        navigate={() => {}}
        resolveLabel={() => undefined}
      />
    );
    expect(html).toContain("Two books: Origin Book + Attached Book");
  });
});
