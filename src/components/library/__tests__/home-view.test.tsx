import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeView } from "../home-view";

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

describe("HomeView", () => {
  it("renders the three shelf tab labels", () => {
    const html = render(
      <HomeView userName="Mary" books={[]} digestImage={null} />,
    );
    expect(html).toContain("Bookshelf");
    expect(html).toContain("Explainers");
    expect(html).toContain("Find more books");
  });
});
