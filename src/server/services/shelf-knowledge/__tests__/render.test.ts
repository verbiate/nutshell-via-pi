import { describe, it, expect } from "vitest";
import {
  slug,
  conceptRelPath,
  conceptToMarkdown,
  themeToMarkdown,
  buildIndex,
} from "../render";
import type { OkfConcept, OkfClusterTheme } from "../types";

const concept = (overrides: Partial<OkfConcept> = {}): OkfConcept => ({
  conceptType: "character",
  title: "Elizabeth Bennet",
  bodyFields: {
    gist: "Witty, proud observer.",
    arc: "Learns to reconsider her first impressions.",
  },
  relatedConceptNames: [],
  sourceBookId: "pride-prejudice",
  topic: "marriage",
  form: "narrative",
  ...overrides,
});

const theme = (overrides: Partial<OkfClusterTheme> = {}): OkfClusterTheme => ({
  topic: "grief",
  title: "The shape of loss",
  summary: "Across books, loss reframes what characters want.",
  relatedConceptIds: [],
  ...overrides,
});

describe("slug", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slug("Elizabeth Bennet")).toBe("elizabeth-bennet");
  });

  it("replaces non-alphanumerics with hyphens", () => {
    expect(slug("Book 1: A Memoir!")).toBe("book-1-a-memoir");
  });

  it("collapses repeated separators and trims ends", () => {
    expect(slug("  A   --- B  ")).toBe("a-b");
  });

  it("is deterministic: same input → same output", () => {
    expect(slug("Same Input")).toBe(slug("Same Input"));
  });

  it("returns empty string when there are no alphanumerics", () => {
    expect(slug("!!! ???")).toBe("");
  });
});

describe("conceptRelPath (single source of truth)", () => {
  it("derives concepts/<sourceBookId>/<slug(title)>.md", () => {
    expect(
      conceptRelPath(
        concept({ title: "Elizabeth Bennet", sourceBookId: "pride-prejudice" }),
      ),
    ).toBe("concepts/pride-prejudice/elizabeth-bennet.md");
  });
});

describe("conceptToMarkdown", () => {
  it("returns relPath via conceptRelPath", () => {
    expect(conceptToMarkdown(concept()).relPath).toBe(
      "concepts/pride-prejudice/elizabeth-bennet.md",
    );
  });

  it("emits YAML frontmatter with type/title/sourceBookId/topic", () => {
    const { body } = conceptToMarkdown(concept());
    expect(body.startsWith("---\n")).toBe(true);
    const fm = body.split("---\n")[1];
    expect(fm).toContain('type: "character"');
    expect(fm).toContain('title: "Elizabeth Bennet"');
    expect(fm).toContain('sourceBookId: "pride-prejudice"');
    expect(fm).toContain('topic: "marriage"');
  });

  it("renders the title as H1 and each bodyField as a section", () => {
    const { body } = conceptToMarkdown(concept());
    expect(body).toContain("# Elizabeth Bennet");
    expect(body).toContain("## gist");
    expect(body).toContain("Witty, proud observer.");
    expect(body).toContain("## arc");
    expect(body).toContain("Learns to reconsider her first impressions.");
  });

  it("escapes double quotes in frontmatter values", () => {
    const { body } = conceptToMarkdown(concept({ title: 'She said "hi"' }));
    expect(body).toContain('title: "She said \\"hi\\""');
  });
});

describe("themeToMarkdown", () => {
  const present = "concepts/pride-prejudice/elizabeth-bennet.md";
  const missing = "concepts/some-book/never-compiled.md";
  const known = new Set<string>([present]);

  it("returns relPath = themes/<slug(topic)>.md", () => {
    expect(themeToMarkdown(theme(), known).relPath).toBe("themes/grief.md");
  });

  it("renders title as H1 and the summary in the body", () => {
    const { body } = themeToMarkdown(theme(), known);
    expect(body).toContain("# The shape of loss");
    expect(body).toContain("Across books, loss reframes what characters want.");
  });

  it("renders a relative markdown link for concepts in knownConceptRelPaths", () => {
    const { body } = themeToMarkdown(theme({ relatedConceptIds: [present] }), known);
    // themes/x.md → ../concepts/...
    expect(body).toContain("](../concepts/pride-prejudice/elizabeth-bennet.md)");
  });

  it("NEVER emits a markdown link to a concept NOT in knownConceptRelPaths (the safety property)", () => {
    const { body } = themeToMarkdown(
      theme({ relatedConceptIds: [present, missing] }),
      known,
    );
    const linkTargets = [...body.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
    // the present concept is linked
    expect(linkTargets).toContain("../concepts/pride-prejudice/elizabeth-bennet.md");
    // no link target references the missing concept
    expect(linkTargets.some((t) => t.includes("never-compiled"))).toBe(false);
  });

  it("degrades a missing concept to plain text (no link rendered at all)", () => {
    const { body } = themeToMarkdown(theme({ relatedConceptIds: [missing] }), known);
    expect(body).not.toMatch(/\]\(/);
    // the derived label still appears as plain text
    expect(body).toContain("never-compiled");
  });
});

describe("buildIndex", () => {
  it("returns relPath = index.md", () => {
    expect(buildIndex({ concepts: [], themes: [] }).relPath).toBe("index.md");
  });

  it("only ever links relPaths the renderer computes from the passed wiki", () => {
    const c = concept();
    const th = theme();
    const { body } = buildIndex({ concepts: [c], themes: [th] });
    const linkTargets = [...body.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
    const computed = new Set<string>([
      conceptRelPath(c),
      `themes/${slug(th.topic)}.md`,
    ]);
    for (const target of linkTargets) {
      expect(computed.has(target)).toBe(true);
    }
    expect(linkTargets).toContain("concepts/pride-prejudice/elizabeth-bennet.md");
    expect(linkTargets).toContain("themes/grief.md");
  });

  it("groups concepts under their topic, then by book", () => {
    const c1 = concept({ title: "A", sourceBookId: "book-1", topic: "t1" });
    const c2 = concept({ title: "B", sourceBookId: "book-2", topic: "t1" });
    const { body } = buildIndex({ concepts: [c1, c2], themes: [] });
    expect(body).toContain("## t1");
    expect(body).toContain("](concepts/book-1/a.md)");
    expect(body).toContain("](concepts/book-2/b.md)");
  });

  it("emits no concept links when the wiki has no concepts", () => {
    const { body } = buildIndex({ concepts: [], themes: [] });
    expect(body).not.toMatch(/\]\(concepts\//);
  });
});
