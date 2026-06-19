import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssRaw = readFileSync(join(__dirname, "globals.css"), "utf8");

describe("globals.css design tokens", () => {
  it("defines the new Tan/Chocolate surface palette", () => {
    expect(cssRaw).toContain("--tan: #FEFBF5");
    expect(cssRaw).toContain("--tan-dark: #DDD8CD");
    expect(cssRaw).toContain("--chocolate: #402A08");
    expect(cssRaw).toContain("--chocolate-dark: #221805");
  });

  it("defines the new brand color palette", () => {
    expect(cssRaw).toContain("--peach: #FE8050");
    expect(cssRaw).toContain("--pink: #F168F5");
    expect(cssRaw).toContain("--purple: #A17FF0");
    expect(cssRaw).toContain("--blue: #18BDFD");
    expect(cssRaw).toContain("--teal: #34E1CD");
    expect(cssRaw).toContain("--lavender: #D9D6FF");
    expect(cssRaw).toContain("--red-warn: #F9241E");
    expect(cssRaw).toContain("--green-success: #4FDB27");
  });

  it("aligns --hl-* tokens with highlight-colors.ts", () => {
    expect(cssRaw).toContain("--hl-teal: var(--teal)");
    expect(cssRaw).toContain("--hl-yellow: #FEC405");
    expect(cssRaw).toContain("--hl-pink: var(--pink)");
  });

  it("routes status stops through the new brand tokens", () => {
    expect(cssRaw).toContain("--warn-from: var(--red-warn)");
    expect(cssRaw).toContain("--warn-to: var(--pink)");
    expect(cssRaw).toContain("--success-from: var(--blue)");
    expect(cssRaw).toContain("--success-to: var(--green-success)");
  });

  it("composes --warn and --success as OKLCH gradients from stop vars", () => {
    expect(cssRaw).toContain(
      "--warn: linear-gradient(in oklch, var(--warn-from), var(--warn-to))",
    );
    expect(cssRaw).toContain(
      "--success: linear-gradient(in oklch, var(--success-from), var(--success-to))",
    );
  });

  it("defines the three general-use OKLCH gradients", () => {
    expect(cssRaw).toContain(
      "--grad-peach-pink: linear-gradient(in oklch, var(--peach), var(--pink))",
    );
    expect(cssRaw).toContain(
      "--grad-purple-tan: linear-gradient(in oklch, var(--purple), var(--tan))",
    );
    expect(cssRaw).toContain(
      "--grad-teal-blue: linear-gradient(in oklch, var(--teal), var(--blue))",
    );
  });

  it("exposes gradient utilities for every gradient token", () => {
    expect(cssRaw).toContain("@utility bg-grad-peach-pink");
    expect(cssRaw).toContain("@utility bg-grad-purple-tan");
    expect(cssRaw).toContain("@utility bg-grad-teal-blue");
    expect(cssRaw).toContain("@utility bg-grad-warn");
    expect(cssRaw).toContain("@utility bg-grad-success");
  });
});
