import { test, expect } from "@playwright/test";

test.describe("ADM-01..07: Admin Panel", () => {
  test("ADM-07: Admin routes require admin role", async ({ page }) => {
    // Unauthenticated: redirect to /login
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/login/);
  });

  test.skip("ADM-07: Non-admin authenticated users get 403/redirect from /admin", async ({ page }) => {
    test.skip(!process.env.E2E_AUTH_ENABLED, "Requires E2E_AUTH_ENABLED");
    // Sign in as regular user
    // Navigate to /admin/users
    // Assert redirected to /my-library (not admin)
  });

  test.skip("ADM-01: Admin can view list of all users", async ({ page }) => {
    test.skip(!process.env.E2E_AUTH_ENABLED, "Requires E2E_AUTH_ENABLED");
    // Sign in as admin
    // Navigate to /admin/users
    // Assert user table is visible
    // Assert table has columns: User, Email, Role, Books, Joined
  });

  test.skip("ADM-02: Admin can change user role", async ({ page }) => {
    test.skip(!process.env.E2E_AUTH_ENABLED, "Requires E2E_AUTH_ENABLED");
    // Sign in as admin
    // Navigate to /admin/users
    // Change a user's role from Regular to Pro
    // Assert toast "Role changed to pro"
  });

  test.skip("ADM-03: Admin can view Universal Library", async ({ page }) => {
    test.skip(!process.env.E2E_AUTH_ENABLED, "Requires E2E_AUTH_ENABLED");
    // Sign in as admin
    // Navigate to /admin/books
    // Assert all books are visible
    // Assert table has uploader info
  });

  test.skip("ADM-04/05: Admin can edit prompt templates", async ({ page }) => {
    test.skip(!process.env.E2E_AUTH_ENABLED, "Requires E2E_AUTH_ENABLED");
    // Sign in as admin
    // Navigate to /admin/prompts
    // Edit book-level template
    // Click "Save Template"
    // Assert success toast
  });

  test.skip("ADM-06: Admin can view audit log", async ({ page }) => {
    test.skip(!process.env.E2E_AUTH_ENABLED, "Requires E2E_AUTH_ENABLED");
    // Sign in as admin
    // Navigate to /admin/audit
    // Assert audit table is visible
    // Assert recent actions (role changes, template edits) are listed
  });
});
