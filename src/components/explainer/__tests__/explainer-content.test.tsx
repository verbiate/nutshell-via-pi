import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExplainerContent } from "../explainer-content";

const spine = ["chapter1.xhtml", "chapter2.xhtml"];

describe("ExplainerContent", () => {
  it("renders a valid citation as a link that signals navigation", () => {
    const html = renderToStaticMarkup(
      <ExplainerContent
        content="See [Chapter One](#ch:chapter1.xhtml) for more."
        spineHrefs={spine}
        onNavigateToHref={() => {}}
      />
    );
    expect(html).toContain("Chapter One");
    expect(html).toContain("data-href=\"chapter1.xhtml\"");
    expect(html).toContain("role=\"button\"");
  });

  it("degrades an invalid citation href to plain text", () => {
    const html = renderToStaticMarkup(
      <ExplainerContent
        content="See [Ghost](#ch:ghost.xhtml)."
        spineHrefs={spine}
        onNavigateToHref={() => {}}
      />
    );
    expect(html).toContain("Ghost");
    expect(html).not.toContain("data-href");
    expect(html).not.toContain("role=\"button\"");
  });

  it("renders plain text unchanged when there are no citations", () => {
    const html = renderToStaticMarkup(
      <ExplainerContent content="just text" spineHrefs={spine} />
    );
    expect(html).toContain("just text");
  });

  it("renders markdown formatting (bold, heading, list)", () => {
    const html = renderToStaticMarkup(
      <ExplainerContent
        content={"# Title\n\n**bold** and *italic*\n\n- one\n- two"}
        spineHrefs={spine}
      />
    );
    expect(html).toContain("<h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("renders an external link as a new-tab anchor", () => {
    const html = renderToStaticMarkup(
      <ExplainerContent
        content="[ex](https://example.com)"
        spineHrefs={spine}
      />
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("still navigates a citation nested inside markdown formatting", () => {
    const html = renderToStaticMarkup(
      <ExplainerContent
        content="**See [Chapter One](#ch:chapter1.xhtml)** now."
        spineHrefs={spine}
        onNavigateToHref={() => {}}
      />
    );
    expect(html).toContain("data-href=\"chapter1.xhtml\"");
    expect(html).toContain("role=\"button\"");
    expect(html).toContain("<strong>");
  });
});
