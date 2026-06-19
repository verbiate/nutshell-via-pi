import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth-guards", () => ({ requireAuth: vi.fn() }));
vi.mock("@/components/auth/user-nav", () => ({
  UserNav: () => <div data-testid="usernav" />,
}));
vi.mock("@/components/library/upload-book-dialog", () => ({
  UploadBookDialog: () => <div data-testid="upload" />,
}));

import { requireAuth } from "@/lib/auth-guards";
import LibraryLayout from "../layout";

vi.mocked(requireAuth).mockResolvedValue({
  id: "u1",
  email: "mary@example.com",
  name: "Mary",
  image: null,
  role: "regular",
  preferredLanguage: "en",
} as never);

describe("Library layout top bar", () => {
  it("renders the chocolate SVG logo linking to the library", async () => {
    const tree = await LibraryLayout({ children: <main>kids</main> });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('src="/images/nutshell_logo_chocolate.svg"');
    expect(html).toContain('href="/my-library"');
    expect(html).toContain('alt="Nutshell"');
  });

  it("does not use the lavender header background", async () => {
    const tree = await LibraryLayout({ children: <main>kids</main> });
    const html = renderToStaticMarkup(tree);
    expect(html).not.toContain("bg-lav");
  });

  // ponytail: structural proxy for "page is locked, only inner regions scroll" at lg.
  describe("app-shell scroll lock (lg+)", () => {
    it("locks the viewport at lg so the body itself does not scroll", async () => {
      const tree = await LibraryLayout({ children: <main>kids</main> });
      const html = renderToStaticMarkup(tree);
      expect(html).toContain("lg:h-screen");
      expect(html).toContain("lg:overflow-hidden");
    });

    it("makes main a flex container that passes height down to the tab shell", async () => {
      const tree = await LibraryLayout({ children: <main>kids</main> });
      const html = renderToStaticMarkup(tree);
      expect(html).toContain("flex-1");
      expect(html).toContain("min-h-0");
    });

    it("keeps the header from compressing so it stays pinned", async () => {
      const tree = await LibraryLayout({ children: <main>kids</main> });
      const html = renderToStaticMarkup(tree);
      expect(html).toContain("shrink-0");
    });
  });
});
