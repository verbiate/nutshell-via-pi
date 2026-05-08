import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RoleBadge } from "../role-badge";

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

describe("POL-05: RoleBadge", () => {
  it("renders Pro badge for pro role", () => {
    const html = render(<RoleBadge role="pro" />);
    expect(html).toContain("Pro");
    expect(html).toContain("bg-slate-900");
  });

  it("renders Admin badge with Shield icon for admin role", () => {
    const html = render(<RoleBadge role="admin" />);
    expect(html).toContain("Admin");
    expect(html).toContain("lucide-shield"); // lucide-react adds this CSS class to the SVG
  });

  it("returns nothing for regular role", () => {
    const html = render(<RoleBadge role="regular" />);
    expect(html).toBe("");
  });
});
