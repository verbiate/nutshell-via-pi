import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../upload-dropzone", () => ({ UploadDropzone: () => null }));

import { UploadBookDialog } from "../upload-book-dialog";

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

describe("UploadBookDialog trigger button", () => {
  it("is 46px tall", () => {
    const html = render(<UploadBookDialog />);
    expect(html).toContain("h-[46px]");
    expect(html).toContain("Add a book");
  });
});
