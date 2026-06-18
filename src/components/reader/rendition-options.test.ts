import { describe, it, expect } from "vitest";
import { buildRenditionOptions } from "./rendition-options";

describe("buildRenditionOptions", () => {
  it("uses paginated flow", () => {
    expect(buildRenditionOptions().flow).toBe("paginated");
  });

  it("enables auto spreads so wide viewports show two pages", () => {
    expect(buildRenditionOptions().spread).toBe("auto");
  });

  it("sets a min spread width so phones stay single-column", () => {
    expect(buildRenditionOptions().minSpreadWidth).toBeGreaterThan(600);
  });

  it("fills the container", () => {
    const opts = buildRenditionOptions();
    expect(opts.width).toBe("100%");
    expect(opts.height).toBe("100%");
  });

  it("allows scripted content in the EPUB iframe", () => {
    expect(buildRenditionOptions().allowScriptedContent).toBe(true);
  });
});
