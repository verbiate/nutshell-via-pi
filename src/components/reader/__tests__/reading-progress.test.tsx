import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReadingProgress } from "../reading-progress";

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

function classOf(html: string, marker: string): string | null {
  const m = html.match(new RegExp(`class="([^"]*\\b${marker}\\b[^"]*)"`));
  return m ? m[1] : null;
}

describe("ReadingProgress: text label", () => {
  it("renders the completion percentage text", () => {
    const html = render(<ReadingProgress percentage={42} />);
    expect(html).toContain("42% complete");
  });

  it("clamps out-of-range percentages", () => {
    expect(render(<ReadingProgress percentage={-5} />)).toContain("0% complete");
    expect(render(<ReadingProgress percentage={105} />)).toContain("100% complete");
  });

  it("keeps progressbar role and aria attributes", () => {
    const html = render(<ReadingProgress percentage={42} />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('aria-label="Reading progress: 42% complete"');
  });

  it("uses tabular-nums to avoid layout shift", () => {
    const html = render(<ReadingProgress percentage={42} />);
    expect(classOf(html, "tabular-nums")).not.toBeNull();
  });
});

describe("ReadingProgress: hidden prop", () => {
  it("fades out and sets aria-hidden when hidden=true", () => {
    const html = render(<ReadingProgress percentage={42} hidden />);
    const root = html.match(/<div[^>]*role="progressbar"[^>]*>/)?.[0] ?? "";
    expect(root).toContain("opacity-0");
    expect(root).toContain("pointer-events-none");
    expect(root).toContain('aria-hidden="true"');
  });

  it("is visible when hidden is omitted", () => {
    const html = render(<ReadingProgress percentage={42} />);
    const root = html.match(/<div[^>]*role="progressbar"[^>]*>/)?.[0] ?? "";
    expect(root).not.toContain("opacity-0");
    expect(root).not.toContain("pointer-events-none");
    expect(root).not.toContain('aria-hidden="true"');
  });
});
