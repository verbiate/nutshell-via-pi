import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyDigest } from "../daily-digest";

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

describe("DailyDigest", () => {
  it("shows the white nutshell badge", () => {
    const html = render(<DailyDigest imageSrc={null} />);
    expect(html).toContain('src="/images/nutshell_badge_white.svg"');
  });

  it("no longer renders the old text logo", () => {
    const html = render(<DailyDigest imageSrc={null} />);
    expect(html).not.toContain("(nutshell)");
  });

  it("still renders the Listen now button and headline", () => {
    const html = render(<DailyDigest imageSrc="/x.png" />);
    expect(html).toContain("Listen now");
  });
});
