import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssRaw = readFileSync(join(__dirname, "globals.css"), "utf8");

describe("globals.css design tokens", () => {
  it("aligns --hl-* tokens with highlight-colors.ts", () => {
    expect(cssRaw).toContain("--hl-teal: #19E1CA");
    expect(cssRaw).toContain("--hl-yellow: #FEC405");
    expect(cssRaw).toContain("--hl-pink: #F168F5");
  });

  it("exposes status gradient stop vars", () => {
    expect(cssRaw).toContain("--warn-from: #FF6A5E");
    expect(cssRaw).toContain("--warn-to: #FF2E7E");
    expect(cssRaw).toContain("--success-from: #4FD18B");
    expect(cssRaw).toContain("--success-to: #2FA86A");
  });

  it("composes --warn and --success from stop vars", () => {
    expect(cssRaw).toContain(
      "--warn: linear-gradient(90deg, var(--warn-from), var(--warn-to))",
    );
    expect(cssRaw).toContain(
      "--success: linear-gradient(90deg, var(--success-from), var(--success-to))",
    );
  });
});
