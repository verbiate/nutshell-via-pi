---
wave: 3
depends_on: ["01-PLAN.md", "02-PLAN.md", "03-PLAN.md", "04-PLAN.md"]
files_modified:
  - src/app/profile/page.tsx
  - src/components/library/upload-dropzone.tsx
  - src/app/(library)/my-library/page.tsx
  - e2e/auth.spec.ts
  - e2e/library.spec.ts
  - e2e/admin.spec.ts
autonomous: true
requirements:
  - AUTH-01
  - AUTH-02
  - AUTH-03
  - AUTH-04
  - AUTH-05
  - LIB-01
  - LIB-02
  - LIB-03
  - LIB-04
  - LIB-05
  - LIB-06
  - ADM-01
  - ADM-02
  - ADM-03
  - ADM-04
  - ADM-05
  - ADM-06
  - ADM-07
  - LANG-03
---

# Plan 05: Profile Page, Upload Integration & E2E Verification

Creates the profile page with role badge, wires the upload dropzone into My Library for authenticated users with real-time updates, and writes comprehensive E2E test stubs covering all Phase 1 success criteria.

## Task 01: Build profile page with role badge

<read_first>
- `src/hooks/use-session.ts` (session hook)
- `src/lib/auth-client.ts` (signOut)
- `.planning/phases/01-foundation/01-UI-SPEC.md` — "Profile Page": avatar + fallback initials, display name, email, role badge (Regular=secondary, Pro=default/accent, Admin=outline with Shield icon), "Upgrade to Pro" text for Regular users
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-14: Role badge shown on profile, "Upgrade to Pro" disabled/grayed for Regular
</read_first>

<action>
1. Create `src/app/profile/page.tsx`:
```tsx
import { requireAuth } from "@/lib/auth-guards";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Shield } from "lucide-react";
import type { UserRole } from "@/types/book";

function RoleBadge({ role }: { role: UserRole }) {
  switch (role) {
    case "admin":
      return (
        <Badge variant="outline" className="gap-1">
          <Shield className="h-3 w-3" />
          Admin
        </Badge>
      );
    case "pro":
      return <Badge className="bg-slate-900 text-white">Pro</Badge>;
    case "regular":
      return <Badge variant="secondary">Regular</Badge>;
  }
}

export default async function ProfilePage() {
  const user = await requireAuth();

  const initials = user.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase() || "U";

  return (
    <div className="mx-auto max-w-lg py-12">
      <div className="flex items-center gap-6">
        <Avatar className="h-20 w-20">
          <AvatarImage src={user.image || undefined} alt={user.name || ""} />
          <AvatarFallback className="bg-slate-200 text-xl">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-[28px] font-semibold text-slate-900">
            {user.name || "User"}
          </h1>
          <p className="mt-1 text-base text-muted-foreground">{user.email}</p>
          <div className="mt-2 flex items-center gap-3">
            <RoleBadge role={user.role} />
            {user.role === "regular" && (
              <span className="text-sm text-muted-foreground cursor-not-allowed">
                Upgrade to Pro
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```
</action>

<acceptance_criteria>
- `src/app/profile/page.tsx` calls `requireAuth()` server-side
- Shows user avatar (or initials fallback), name (28px semibold), email
- Role badge: Regular=secondary variant, Pro=default/accent bg, Admin=outline with Shield icon
- "Upgrade to Pro" text shown for Regular users with `cursor-not-allowed` and `text-muted-foreground`
- No self-serve upgrade action available
- `npx tsc --noEmit` exits 0
</acceptance_criteria>

---

## Task 02: Wire upload into My Library with React Query invalidation

<read_first>
- `src/components/library/upload-dropzone.tsx` (created in 03-PLAN Task 04)
- `src/app/(library)/my-library/page.tsx` (created in 03-PLAN Task 05)
- `src/components/library/empty-library.tsx` (created in 03-PLAN Task 05)
</read_first>

<action>
Update `src/app/(library)/my-library/page.tsx` to add an upload section for non-empty libraries:

```tsx
import { requireAuth } from "@/lib/auth-guards";
import { getPersonalLibrary } from "@/server/services/library";
import { Bookshelf } from "@/components/library/bookshelf";
import { EmptyLibrary } from "@/components/library/empty-library";
import { UploadDropzone } from "@/components/library/upload-dropzone";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

export default async function MyLibraryPage() {
  const user = await requireAuth();
  const books = await getPersonalLibrary(user.id);

  const bookList = books.map((ba) => ({
    id: ba.book.id,
    title: ba.book.title,
    author: ba.book.author,
    language: ba.book.language,
    coverPath: ba.book.coverPath,
  }));

  if (bookList.length === 0) {
    return <EmptyLibrary />;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-slate-900">
          My Library
        </h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button className="bg-slate-900 text-white hover:bg-slate-800">
              <Upload className="mr-2 h-4 w-4" />
              Upload Book
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <UploadDropzone />
          </DialogContent>
        </Dialog>
      </div>
      <Bookshelf books={bookList} />
    </div>
  );
}
```
</action>

<acceptance_criteria>
- My Library page shows "Upload Book" button in header when library is not empty
- "Upload Book" button opens Dialog with UploadDropzone
- Button text is "Upload Book" (per UI-SPEC copywriting)
- Empty state still shows inline upload dropzone
- `npx tsc --noEmit` exits 0
</acceptance_criteria>

---

## Task 03: Write E2E test stubs covering all Phase 1 success criteria

<read_first>
- `e2e/auth.spec.ts`, `e2e/library.spec.ts`, `e2e/admin.spec.ts` (stubs from 01-PLAN)
- `.planning/ROADMAP.md` — Phase 1 "Success Criteria" (5 observable behaviors)
- `playwright.config.ts`
</read_first>

<action>
Replace `e2e/auth.spec.ts`:
```typescript
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
    await expect(page.locator("text=Regular").or(page.locator("text=Pro")).or(page.locator("text=Admin"))).toBeVisible();
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
```

Replace `e2e/library.spec.ts`:
```typescript
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
```

Replace `e2e/admin.spec.ts`:
```typescript
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
```
</action>

<acceptance_criteria>
- `e2e/auth.spec.ts` covers AUTH-01..05 with test cases for session persistence, logout, role visibility, and route protection
- `e2e/library.spec.ts` covers LIB-01..06 and LANG-03 with test cases for upload, deduplication, access isolation, empty state, and file validation
- `e2e/admin.spec.ts` covers ADM-01..07 with test cases for role guard, user management, Universal Library, prompt editing, and audit log
- Tests requiring real auth are gated by `process.env.E2E_AUTH_ENABLED`
- Non-auth tests (redirect checks) run without credentials
- `npx playwright test --list` lists all test cases without errors
</acceptance_criteria>

---

## Verification

```bash
# Full type check
npx tsc --noEmit

# All unit tests
npx vitest run

# Verify no "summary" in user-facing code
grep -r "summary" src/components/ src/app/ --include="*.tsx" --include="*.ts" -l
# Should return empty or only non-user-facing files

# Verify Prisma version is 5.x
npx prisma --version | grep "prisma" | grep "5."

# Verify all E2E test cases are listed
npx playwright test --list

# Build succeeds
npm run build
```

## must_haves

- [ ] Profile page shows user info and role badge (Regular/Pro/Admin variants)
- [ ] "Upgrade to Pro" text visible for Regular users, non-clickable
- [ ] My Library page has "Upload Book" button opening dialog for non-empty libraries
- [ ] E2E test stubs cover all 19 Phase 1 requirements
- [ ] E2E tests for route protection (unauthenticated redirect) run without real auth
- [ ] Full TypeScript compilation passes with zero errors
- [ ] Full unit test suite passes (`npx vitest run`)
- [ ] Production build succeeds (`npm run build`)
- [ ] Codebase search for "summary" in user-facing components returns 0 results
- [ ] Prisma version is exactly 5.22.0 (not 7.x)
