import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReadingProgress } from "../reading-progress";

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

// ponytail: inline helper, not worth a shared util
function classOf(html: string, marker: string): string | null {
  const m = html.match(new RegExp(`class="([^"]*\\b${marker}\\b[^"]*)"`));
  return m ? m[1] : null;
}

describe("ReadingProgress: pill slides with fill", () => {
  const html = render(<ReadingProgress percentage={42} />);

  it("pill has transition covering left", () => {
    const pill = classOf(html, "tabular-nums");
    expect(pill).not.toBeNull();
    expect(pill!).toMatch(/transition-\[left\]|transition-all/);
  });

  it("pill duration matches fill duration", () => {
    const fill = classOf(html, "bg-grad");
    const pill = classOf(html, "tabular-nums");
    expect(fill).not.toBeNull();
    expect(pill).not.toBeNull();
    expect(fill!).toContain("duration-300");
    expect(pill!).toContain("duration-300");
  });
});

describe("ReadingProgress: hidden prop fades the bar", () => {
  it("root has opacity-0, pointer-events-none and aria-hidden when hidden=true", () => {
    const html = render(<ReadingProgress percentage={42} hidden />);
    const root = html.match(/<div[^>]*role="progressbar"[^>]*>/)?.[0] ?? "";
    expect(root).toContain("opacity-0");
    expect(root).toContain("pointer-events-none");
    expect(root).toContain('aria-hidden="true"');
  });

  it("root has no fade classes and no aria-hidden when hidden is omitted", () => {
    const html = render(<ReadingProgress percentage={42} />);
    const root = html.match(/<div[^>]*role="progressbar"[^>]*>/)?.[0] ?? "";
    expect(root).not.toContain("opacity-0");
    expect(root).not.toContain("pointer-events-none");
    expect(root).not.toContain('aria-hidden="true"');
  });
});
