import { test, expect } from "@playwright/test";

test.describe("AUTH-01..05: Authentication", () => {
  test.skip("AUTH-01: New user can sign in with Google and land on dashboard within 5 seconds", async ({ page }) => {
    // Manual test — requires real Google OAuth credentials
    // 1. Navigate to /login
    // 2. Click "Sign in with Google"
    // 3. Complete Google OAuth flow
    // 4. Assert redirected to /my-library
    // 5. Assert page loads within 5 seconds
  });

  test("AUTH-02: Session persists across browser refresh", async ({ page }) => {
    // This test requires a valid session cookie — skip in CI without real auth
    test.skip(!process.env.E2E_AUTH_ENABLED, "Requires E2E_AUTH_ENABLED");

    await page.goto("/my-library");
    await page.reload();
    // Should still be on /my-library, not redirected to /login
    await expect(page).toHaveURL(/\/my-library/);
  });

  test("AUTH-03: User can log out from any page", async ({ page }) => {
    test.skip(!process.env.E2E_AUTH_ENABLED, "Requires E2E_AUTH_ENABLED");

    await page.goto("/my-library");
    // Click avatar dropdown
    await page.click("[data-testid='user-nav']");
    // Click "Sign Out"
    await page.click("text=Sign Out");
    // Should be redirected to /login
    await expect(page).toHaveURL(/\/login/);
  });

  test("AUTH-04: Users have role field in session", async ({ page }) => {
    test.skip(!process.env.E2E_AUTH_ENABLED, "Requires E2E_AUTH_ENABLED");

    await page.goto("/profile");
    // Should see role badge
    await expect(
      page.locator("text=Regular").or(page.locator("text=Pro")).or(page.locator("text=Admin"))
    ).toBeVisible();
  });

  test("Unauthenticated users are redirected to /login from protected routes", async ({ page }) => {
    await page.goto("/my-library");
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/book/some-id");
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/login/);
  });
});
