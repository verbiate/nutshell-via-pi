import { test, expect } from "@playwright/test";

test.describe("LIB-01..06, LANG-03: Library & Upload", () => {
  test.skip("LIB-01: User can upload EPUB via drag-and-drop", async ({ page }) => {
    test.skip(!process.env.E2E_AUTH_ENABLED, "Requires E2E_AUTH_ENABLED");

    await page.goto("/my-library");
    // Drop an EPUB file onto the upload zone
    // Assert processing indicator appears
    // Assert book appears in library after processing
  });

  test.skip("LIB-02/03: Same EPUB uploaded twice does not create duplicate", async ({ page }) => {
    test.skip(!process.env.E2E_AUTH_ENABLED, "Requires E2E_AUTH_ENABLED");
    // Upload same EPUB twice
    // Assert library shows book only once
    // Assert toast "[title] added to your library" on second upload
  });

  test.skip("LIB-04: New EPUB creates TXT and grants access", async ({ page }) => {
    test.skip(!process.env.E2E_AUTH_ENABLED, "Requires E2E_AUTH_ENABLED");
    // Upload new EPUB
    // Assert redirected to book detail page
    // Assert book shows metadata (title, author, language)
  });

  test.skip("LIB-05: User sees only books they have access to", async ({ page }) => {
    test.skip(!process.env.E2E_AUTH_ENABLED, "Requires E2E_AUTH_ENABLED");
    // User A uploads book
    // User B uploads different book
    // User A's library shows only their book
    // User B's library shows only their book
  });

  test("LIB-05: Empty state shows upload CTA", async ({ page }) => {
    test.skip(!process.env.E2E_AUTH_ENABLED, "Requires E2E_AUTH_ENABLED");

    await page.goto("/my-library");
    // New user should see empty state
    await expect(page.locator("text=Your library is empty")).toBeVisible();
    await expect(page.locator("text=Upload your first EPUB")).toBeVisible();
  });

  test("LIB-01: Upload rejects non-EPUB files client-side", async ({ page }) => {
    test.skip(!process.env.E2E_AUTH_ENABLED, "Requires E2E_AUTH_ENABLED");

    await page.goto("/my-library");
    // Attempt to upload a PDF
    // Assert error message "Only EPUB files are accepted"
  });
});
