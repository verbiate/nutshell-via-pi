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
});
