import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscussionLinksPanel } from "../discussion-links-panel";

const spine = [
  { href: "c1.xhtml", index: 0 },
  { href: "c2.xhtml", index: 5 },
  { href: "c3.xhtml", index: 2 },
];

describe("DiscussionLinksPanel", () => {
  it("renders deduped links in spine reading order", () => {
    const html = renderToStaticMarkup(
      <DiscussionLinksPanel
        texts={["[Gamma](#ch:c3.xhtml) [Beta](#ch:c2.xhtml)", "[dup](#ch:c2.xhtml)"]}
        spineItems={spine}
        onNavigateToHref={() => {}}
      />
    );
    // c3 (index 2) sorts before c2 (index 5); c2 deduped to one entry.
    // The panel renders each link's LABEL as the button text, in spine order.
    expect(html.indexOf("Gamma")).toBeLessThan(html.indexOf("Beta"));
    expect(html.match(/<button/g)).toHaveLength(2);
  });

  it("renders nothing when there are no valid citations", () => {
    const html = renderToStaticMarkup(
      <DiscussionLinksPanel texts={["no links", "[g](#ch:ghost.xhtml)"]} spineItems={spine} onNavigateToHref={() => {}} />
    );
    expect(html.trim()).toBe("");
  });
});
