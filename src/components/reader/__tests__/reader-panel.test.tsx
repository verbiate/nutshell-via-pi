import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReaderPanel } from "../reader-panel";

vi.mock("@/components/explainer/explainer-panel", () => ({
  ExplainerPanel: () => null,
}));

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

const baseProps = {
  bookId: "b1",
  bookTitle: "T",
  toc: [],
  currentHref: "",
  onNavigate: () => {},
  initialLanguage: "en",
  onListenFromHere: () => {},
};

describe("ReaderPanel: admin-gated uploaded date", () => {
  it("renders uploaded date for admin when bookCreatedAt is provided", () => {
    const iso = "2024-01-15T00:00:00.000Z";
    const html = render(<ReaderPanel {...baseProps} isAdmin bookCreatedAt={iso} />);
    expect(html).toContain("Uploaded");
    expect(html).toContain(new Date(iso).toLocaleDateString());
  });

  it("does not render uploaded date for non-admin", () => {
    const iso = "2024-01-15T00:00:00.000Z";
    const html = render(
      <ReaderPanel {...baseProps} isAdmin={false} bookCreatedAt={iso} />
    );
    expect(html).not.toContain("Uploaded");
  });

  it("does not render uploaded date when bookCreatedAt is missing even for admin", () => {
    const html = render(<ReaderPanel {...baseProps} isAdmin />);
    expect(html).not.toContain("Uploaded");
  });
});
