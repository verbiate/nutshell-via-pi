import path from "node:path";
import type { OkfConcept, OkfClusterTheme } from "./types";

export interface Rendered {
  relPath: string;
  body: string;
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ponytail: single source of truth for "what is concept X's file path".
// conceptToMarkdown, themeToMarkdown link targets, and buildIndex all route
// through here — so a concept's canonical ID can never drift from its path.
export function conceptRelPath(c: OkfConcept): string {
  return `concepts/${c.sourceBookId}/${slug(c.title)}.md`;
}

const yamlStr = (v: string): string =>
  `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// ponytail: relative path from the linking file's directory to a wiki relPath.
// themes/x.md → concepts/... uses "../"; index.md → anything uses no prefix.
const relLink = (fromDir: string, targetRelPath: string): string =>
  path.posix.relative(fromDir, targetRelPath);

const labelFromRelPath = (relPath: string): string => {
  const base = relPath.split("/").pop() ?? relPath;
  return base.replace(/\.md$/, "");
};

const truncate = (s: string, n = 100): string =>
  s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;

export function conceptToMarkdown(c: OkfConcept): Rendered {
  const fm = [
    "---",
    `type: ${yamlStr(c.conceptType)}`,
    `title: ${yamlStr(c.title)}`,
    `sourceBookId: ${yamlStr(c.sourceBookId)}`,
    `topic: ${yamlStr(c.topic)}`,
    "---",
  ].join("\n");
  const sections = Object.entries(c.bodyFields)
    .map(([k, v]) => `## ${k}\n\n${v}`)
    .join("\n\n");
  const body = `${fm}\n\n# ${c.title}\n\n${sections}\n`;
  return { relPath: conceptRelPath(c), body };
}

export function themeToMarkdown(
  t: OkfClusterTheme,
  knownConceptRelPaths: Set<string>,
): Rendered {
  const relPath = `themes/${slug(t.topic)}.md`;
  const entries = t.relatedConceptIds.map((id) => {
    const label = labelFromRelPath(id);
    // THE SAFETY PROPERTY: render a markdown link ONLY when the caller has
    // validated this id as a real concept relPath. Otherwise plain text —
    // never a link that could dangle.
    return knownConceptRelPaths.has(id)
      ? `- [${label}](${relLink("themes", id)})`
      : `- ${label}`;
  });
  const related = entries.length
    ? `## Related concepts\n\n${entries.join("\n")}\n\n`
    : "";
  const body = `# ${t.title}\n\n${t.summary}\n\n${related}`.replace(/\s+$/, "\n");
  return { relPath, body };
}

export function buildIndex(wiki: {
  concepts: OkfConcept[];
  themes: OkfClusterTheme[];
}): Rendered {
  const topics = new Set<string>();
  for (const c of wiki.concepts) topics.add(c.topic);
  for (const t of wiki.themes) topics.add(t.topic);

  const lines: string[] = ["# Shelf Wiki", ""];
  if (topics.size === 0) {
    lines.push("_(No topics yet.)_", "");
  }
  for (const topic of [...topics].sort()) {
    lines.push(`## ${topic}`, "");

    const themes = wiki.themes
      .filter((t) => t.topic === topic)
      .sort((a, b) => a.title.localeCompare(b.title));
    if (themes.length) {
      lines.push("### Themes", "");
      for (const th of themes) {
        const p = `themes/${slug(th.topic)}.md`;
        lines.push(`- [${th.title}](${relLink(".", p)}) — ${truncate(th.summary)}`);
      }
      lines.push("");
    }

    const concepts = wiki.concepts.filter((c) => c.topic === topic);
    if (concepts.length) {
      lines.push("### Concepts", "");
      const byBook = new Map<string, OkfConcept[]>();
      for (const c of concepts) {
        if (!byBook.has(c.sourceBookId)) byBook.set(c.sourceBookId, []);
        byBook.get(c.sourceBookId)!.push(c);
      }
      for (const bookId of [...byBook.keys()].sort()) {
        lines.push(`- **${bookId}**`);
        const sorted = byBook
          .get(bookId)!
          .sort((a, b) => a.title.localeCompare(b.title));
        for (const c of sorted) {
          const desc = Object.values(c.bodyFields)[0] ?? c.conceptType;
          lines.push(
            `  - [${c.title}](${relLink(".", conceptRelPath(c))}) — ${truncate(desc)}`,
          );
        }
      }
      lines.push("");
    }
  }
  return { relPath: "index.md", body: `${lines.join("\n")}\n` };
}
