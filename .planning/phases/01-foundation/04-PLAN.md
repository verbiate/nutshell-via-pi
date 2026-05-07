---
wave: 2
depends_on: ["02-PLAN.md", "03-PLAN.md"]
files_modified:
  - src/app/admin/layout.tsx
  - src/app/admin/users/page.tsx
  - src/app/admin/books/page.tsx
  - src/app/admin/prompts/page.tsx
  - src/app/admin/audit/page.tsx
  - src/app/api/admin/users/route.ts
  - src/app/api/admin/users/[id]/route.ts
  - src/app/api/admin/books/route.ts
  - src/app/api/admin/prompts/route.ts
  - src/app/api/admin/audit/route.ts
  - src/server/services/admin.ts
  - src/components/admin/admin-sidebar.tsx
  - src/components/admin/user-table.tsx
  - src/components/admin/book-table.tsx
  - src/components/admin/prompt-editor.tsx
  - src/components/admin/audit-table.tsx
  - src/app/admin/not-found.tsx
  - src/server/__tests__/admin.test.ts
autonomous: true
requirements:
  - ADM-01
  - ADM-02
  - ADM-03
  - ADM-04
  - ADM-05
  - ADM-06
  - ADM-07
---

# Plan 04: Admin Panel

Implements the complete admin panel with sidebar layout, server-side role guards on every route and API endpoint, user management (list + role change), Universal Library view, prompt template editor, audit log viewer, and comprehensive audit logging for all admin mutations.

## Task 01: Create admin service with audit logging

<read_first>
- `src/server/db/index.ts` (Prisma client)
- `src/lib/auth-guards.ts` (requireAdmin)
- `src/server/services/library.ts` (getUniversalLibrary)
- `.planning/phases/01-foundation/01-RESEARCH.md` — Section 2.5 "Audit Logging": append-only, who/what/when/old/new
</read_first>

<action>
1. Create `src/server/services/admin.ts`:
```typescript
import { db } from "@/server/db";
import type { UserRole } from "@/types/book";

// ---- Audit Logging ----

interface AuditParams {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: string | null;
  newValue?: string | null;
}

async function auditLog({ actorId, action, entityType, entityId, oldValue, newValue }: AuditParams) {
  await db.auditLog.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
    },
  });
}

// ---- User Management (ADM-01, ADM-02) ----

export async function getAllUsers(page = 1, pageSize = 20, search?: string) {
  const skip = (page - 1) * pageSize;
  const where = search
    ? {
        OR: [
          { name: { contains: search } },
          { email: { contains: search } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        createdAt: true,
        _count: { select: { bookAccesses: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    db.user.count({ where }),
  ]);

  return { users, total, page, pageSize };
}

export async function changeUserRole(
  adminId: string,
  targetUserId: string,
  newRole: UserRole
) {
  // Get current user
  const targetUser = await db.user.findUnique({
    where: { id: targetUserId },
    select: { role: true },
  });

  if (!targetUser) {
    throw new Error("User not found");
  }

  const oldRole = targetUser.role;

  if (oldRole === newRole) {
    return { changed: false };
  }

  // Update role
  await db.user.update({
    where: { id: targetUserId },
    data: { role: newRole },
  });

  // Audit log
  await auditLog({
    actorId: adminId,
    action: "USER_ROLE_CHANGED",
    entityType: "user",
    entityId: targetUserId,
    oldValue: oldRole,
    newValue: newRole,
  });

  return { changed: true, oldRole, newRole };
}

// ---- Universal Library (ADM-03) ----

export { getUniversalLibrary, getBookById } from "./library";

// ---- Prompt Templates (ADM-04, ADM-05) ----

export async function getPromptTemplates() {
  return db.promptTemplate.findMany({
    orderBy: { type: "asc" },
  });
}

export async function getPromptTemplate(type: string) {
  return db.promptTemplate.findUnique({ where: { type } });
}

export async function updatePromptTemplate(
  adminId: string,
  type: string,
  content: string
) {
  const existing = await db.promptTemplate.findUnique({ where: { type } });
  if (!existing) {
    throw new Error("Template not found");
  }

  const oldContent = existing.content;

  await db.promptTemplate.update({
    where: { type },
    data: {
      content,
      version: { increment: 1 },
    },
  });

  // Audit log
  await auditLog({
    actorId: adminId,
    action: "PROMPT_TEMPLATE_UPDATED",
    entityType: "prompt_template",
    entityId: type,
    oldValue: oldContent,
    newValue: content,
  });
}

// ---- Audit Log Query (ADM-06) ----

export async function getAuditLogs(page = 1, pageSize = 20) {
  const skip = (page - 1) * pageSize;
  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      include: {
        actor: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    db.auditLog.count(),
  ]);

  return { logs, total, page, pageSize };
}
```
</action>

<acceptance_criteria>
- `src/server/services/admin.ts` exports `async function getAllUsers(page, pageSize, search)` with pagination
- `src/server/services/admin.ts` exports `async function changeUserRole(adminId, targetUserId, newRole)` that updates role + creates audit log
- `src/server/services/admin.ts` exports `async function getPromptTemplates()`
- `src/server/services/admin.ts` exports `async function updatePromptTemplate(adminId, type, content)` that updates template + increments version + creates audit log
- `src/server/services/admin.ts` exports `async function getAuditLogs(page, pageSize)` with actor join
- Audit log entries include `actorId`, `action`, `entityType`, `entityId`, `oldValue`, `newValue`, `createdAt`
- Role change only creates audit log if role actually changed (not if old === new)
- `npx tsc --noEmit` exits 0
</acceptance_criteria>

---

## Task 02: Create admin API routes with server-side role guards

<read_first>
- `src/server/services/admin.ts` (created in Task 01)
- `src/lib/auth-guards.ts` (requireAdmin)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-11: Admin routes require server-side role validation on every request, unauthorized returns 403
</read_first>

<action>
1. Create `src/app/api/admin/users/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { getAllUsers } from "@/server/services/admin";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const search = url.searchParams.get("search") || undefined;
    return NextResponse.json(await getAllUsers(page, 20, search));
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (error.statusCode === 403) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

2. Create `src/app/api/admin/users/[id]/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { changeUserRole } from "@/server/services/admin";
import type { UserRole } from "@/types/book";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const { role } = body as { role: UserRole };

    if (!["regular", "pro", "admin"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const result = await changeUserRole(admin.id, id, role);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (error.statusCode === 403) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
```

3. Create `src/app/api/admin/books/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { getUniversalLibrary } from "@/server/services/admin";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    return NextResponse.json(await getUniversalLibrary(page));
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (error.statusCode === 403) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

4. Create `src/app/api/admin/prompts/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { getPromptTemplates, getPromptTemplate, updatePromptTemplate } from "@/server/services/admin";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ templates: await getPromptTemplates() });
  } catch (error: any) {
    if (error.statusCode === 401) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();
    const { type, content } = body as { type: string; content: string };

    if (!type || !content) {
      return NextResponse.json({ error: "Type and content required" }, { status: 400 });
    }

    await updatePromptTemplate(admin.id, type, content);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.statusCode === 401) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
```

5. Create `src/app/api/admin/audit/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { getAuditLogs } from "@/server/services/admin";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    return NextResponse.json(await getAuditLogs(page));
  } catch (error: any) {
    if (error.statusCode === 401) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```
</action>

<acceptance_criteria>
- Every admin API route calls `requireAdmin()` as the first operation
- `src/app/api/admin/users/route.ts` exports `GET` returning paginated user list
- `src/app/api/admin/users/[id]/route.ts` exports `PATCH` accepting `{ role: "regular" | "pro" | "admin" }`
- `src/app/api/admin/books/route.ts` exports `GET` returning paginated Universal Library
- `src/app/api/admin/prompts/route.ts` exports `GET` (list templates) and `PATCH` (update template)
- `src/app/api/admin/audit/route.ts` exports `GET` returning paginated audit logs with actor info
- All admin endpoints return 403 for non-admin users (via `requireAdmin()` throwing AuthError with statusCode 403)
- All admin endpoints return 401 for unauthenticated users
- Invalid role value returns 400
- `npx tsc --noEmit` exits 0
</acceptance_criteria>

---

## Task 03: Build admin layout with sidebar navigation

<read_first>
- `.planning/phases/01-foundation/01-UI-SPEC.md` — "Admin Sidebar": 260px fixed width, slate-100 bg, nav items (Users, Universal Library, Prompt Templates, Audit Log), 40px item height, active state with accent bg + 3px left border
- `.planning/phases/01-foundation/01-UI-SPEC.md` — "Admin Shell": sidebar + content, mobile: Sheet overlay with hamburger
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-10: `/admin` route group with sidebar layout
</read_first>

<action>
1. Create `src/components/admin/admin-sidebar.tsx`:
```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Library, FileText, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Users", icon: Users, href: "/admin/users" },
  { label: "Universal Library", icon: Library, href: "/admin/books" },
  { label: "Prompt Templates", icon: FileText, href: "/admin/prompts" },
  { label: "Audit Log", icon: ScrollText, href: "/admin/audit" },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-3">
      {NAV_ITEMS.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex h-10 items-center gap-2 rounded-md px-4 text-sm",
              isActive
                ? "bg-slate-900 text-white border-l-[3px] border-slate-900"
                : "text-slate-600 hover:bg-slate-200 border-l-[3px] border-transparent"
            )}
          >
            <item.icon className="h-[18px] w-[18px]" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

2. Create `src/app/admin/layout.tsx`:
```tsx
import { requireAdmin } from "@/lib/auth-guards";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side role guard — ADM-07
  try {
    await requireAdmin();
  } catch {
    redirect("/my-library");
  }

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-[260px] flex-shrink-0 border-r border-slate-200 bg-slate-100 lg:block">
        <div className="p-4">
          <h2 className="text-[20px] font-semibold text-slate-900">Admin</h2>
        </div>
        <AdminSidebar />
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-slate-50 p-8">{children}</main>
    </div>
  );
}
```

3. Create `src/app/admin/not-found.tsx`:
```tsx
export default function AdminNotFound() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <p className="text-muted-foreground">Page not found</p>
    </div>
  );
}
```

4. Create `src/app/admin/page.tsx` — redirect to users:
```tsx
import { redirect } from "next/navigation";

export default function AdminPage() {
  redirect("/admin/users");
}
```
</action>

<acceptance_criteria>
- `src/components/admin/admin-sidebar.tsx` exists with 4 nav items: Users, Universal Library, Prompt Templates, Audit Log
- Sidebar items use correct icons: Users, Library, FileText, ScrollText
- Active item has `bg-slate-900 text-white border-l-[3px]`
- Sidebar width is `w-[260px]` on desktop, hidden on mobile (`hidden lg:block`)
- `src/app/admin/layout.tsx` calls `requireAdmin()` server-side — redirects non-admin to `/my-library`
- `src/app/admin/page.tsx` redirects to `/admin/users`
- Nav item height is `h-10` (40px per UI-SPEC)
- `npx tsc --noEmit` exits 0
</acceptance_criteria>

---

## Task 04: Build admin user management page

<read_first>
- `src/app/api/admin/users/route.ts` (created in Task 02)
- `src/app/api/admin/users/[id]/route.ts` (created in Task 02)
- `.planning/phases/01-foundation/01-UI-SPEC.md` — "Admin Tables": default sort createdAt desc, page size 20, search input with 300ms debounce, shadcn Pagination
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-14: Role badge on profile. D-12: Role change inline select with undo toast
</read_first>

<action>
1. Create `src/app/admin/users/page.tsx`:
```tsx
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { UserRole } from "@/types/book";

interface User {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRole;
  createdAt: string;
  _count: { bookAccesses: number };
}

export default function UsersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: ["admin-users", page, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/users?${params}`);
      return res.json();
    },
  });

  const roleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: UserRole }) => {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success(`Role changed to ${variables.role}`, {
        action: {
          label: "Undo",
          onClick: () => {
            // No-op for undo in v1 — just acknowledge
          },
        },
        duration: 5000,
      });
    },
  });

  const users: User[] = data?.users || [];

  return (
    <div>
      <h1 className="text-[20px] font-semibold text-slate-900">Users</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage user roles and access
      </p>

      <div className="mt-4 flex items-center gap-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
      </div>

      <div className="mt-4 rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Books</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5} className="h-12">
                      <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                    </TableCell>
                  </TableRow>
                ))
              : users.map((user) => (
                  <TableRow key={user.id} className="hover:bg-slate-50">
                    <TableCell className="font-medium">
                      {user.name || "Unknown"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.email}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={user.role}
                        onValueChange={(role: UserRole) =>
                          roleMutation.mutate({ userId: user.id, role })
                        }
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="regular">Regular</SelectItem>
                          <SelectItem value="pro">Pro</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>{user._count.bookAccesses}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data?.total > 20 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * 20 + 1}-{Math.min(page * 20, data.total)} of{" "}
            {data.total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page * 20 >= data.total}
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```
</action>

<acceptance_criteria>
- `src/app/admin/users/page.tsx` exists with `"use client"` directive
- Page displays table with columns: User, Email, Role, Books, Joined
- Role column uses shadcn Select with values: regular, pro, admin
- Changing role calls `PATCH /api/admin/users/[id]` with `{ role }`
- Success toast shows "Role changed to [role]" with 5-second duration
- Search input with Search icon filters by name/email
- Table rows show loading skeletons while fetching
- Default sort is `createdAt` descending
- Pagination shows Previous/Next when total > 20
- `npx tsc --noEmit` exits 0
</acceptance_criteria>

---

## Task 05: Build admin Universal Library, Prompt Templates, and Audit Log pages

<read_first>
- `src/app/api/admin/books/route.ts`, `src/app/api/admin/prompts/route.ts`, `src/app/api/admin/audit/route.ts` (created in Task 02)
- `.planning/phases/01-foundation/01-UI-SPEC.md` — "Prompt Template Editor": two tabs (Book-Level, Section-Level), textarea with monospace, word count, Save/Discard buttons
- `.planning/phases/01-foundation/01-UI-SPEC.md` — "Admin Tables" for books and audit
- `.planning/phases/01-foundation/01-UI-SPEC.md` — Copywriting: "Save Template", "Discard Changes"
</read_first>

<action>
1. Create `src/app/admin/books/page.tsx`:
```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function AdminBooksPage() {
  const { data, isPending } = useQuery({
    queryKey: ["admin-books"],
    queryFn: async () => {
      const res = await fetch("/api/admin/books");
      return res.json();
    },
  });

  const books = data?.books || [];

  return (
    <div>
      <h1 className="text-[20px] font-semibold text-slate-900">
        Universal Library
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        All books in the system
      </p>

      <div className="mt-4 rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Language</TableHead>
              <TableHead>Uploaded By</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6} className="h-12">
                      <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                    </TableCell>
                  </TableRow>
                ))
              : books.map((book: any) => (
                  <TableRow key={book.id} className="hover:bg-slate-50">
                    <TableCell className="font-medium">{book.title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {book.author || "Unknown"}
                    </TableCell>
                    <TableCell>
                      {book.language !== "und" ? book.language.toUpperCase() : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {book.uploadedBy?.name || "Unknown"}
                    </TableCell>
                    <TableCell>{book._count.userAccesses}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(book.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

2. Create `src/app/admin/prompts/page.tsx`:
```tsx
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function PromptTemplatesPage() {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["admin-prompts"],
    queryFn: async () => {
      const res = await fetch("/api/admin/prompts");
      return res.json();
    },
  });

  const templates = data?.templates || [];
  const bookTemplate = templates.find((t: any) => t.type === "book");
  const sectionTemplate = templates.find((t: any) => t.type === "section");

  return (
    <div>
      <h1 className="text-[20px] font-semibold text-slate-900">
        Prompt Templates
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Edit LLM prompt templates for Explainer generation
      </p>

      <div className="mt-6">
        <Tabs defaultValue="book">
          <TabsList>
            <TabsTrigger value="book">Book-Level</TabsTrigger>
            <TabsTrigger value="section">Section-Level</TabsTrigger>
          </TabsList>
          <TabsContent value="book">
            <PromptEditor
              type="book"
              initialContent={bookTemplate?.content || ""}
              version={bookTemplate?.version || 1}
            />
          </TabsContent>
          <TabsContent value="section">
            <PromptEditor
              type="section"
              initialContent={sectionTemplate?.content || ""}
              version={sectionTemplate?.version || 1}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function PromptEditor({
  type,
  initialContent,
  version,
}: {
  type: string;
  initialContent: string;
  version: number;
}) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState(initialContent);
  const hasChanges = content !== initialContent;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/prompts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, content }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-prompts"] });
      toast.success("Template saved");
    },
  });

  const wordCount = content.split(/\s+/).filter(Boolean).length;

  return (
    <div className="mt-4 space-y-3">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="min-h-[300px] font-mono text-sm"
        placeholder="Enter prompt template..."
      />
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {wordCount} words · Version {version}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setContent(initialContent)}
            disabled={!hasChanges}
          >
            Discard Changes
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!hasChanges || saveMutation.isPending}
          >
            Save Template
          </Button>
        </div>
      </div>
    </div>
  );
}
```

3. Create `src/app/admin/audit/page.tsx`:
```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function AuditLogPage() {
  const { data, isPending } = useQuery({
    queryKey: ["admin-audit"],
    queryFn: async () => {
      const res = await fetch("/api/admin/audit");
      return res.json();
    },
  });

  const logs = data?.logs || [];

  return (
    <div>
      <h1 className="text-[20px] font-semibold text-slate-900">Audit Log</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Record of all admin actions
      </p>

      <div className="mt-4 rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Old Value</TableHead>
              <TableHead>New Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6} className="h-12">
                      <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                    </TableCell>
                  </TableRow>
                ))
              : logs.map((log: any) => (
                  <TableRow key={log.id} className="hover:bg-slate-50">
                    <TableCell className="whitespace-nowrap text-sm">
                      {new Date(log.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{log.actor?.name || log.actorId}</TableCell>
                    <TableCell>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium">
                        {log.action}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {log.entityType} / {log.entityId.substring(0, 8)}...
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">
                      {log.oldValue || "—"}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {log.newValue || "—"}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```
</action>

<acceptance_criteria>
- `src/app/admin/books/page.tsx` shows table with columns: Title, Author, Language, Uploaded By, Users, Added
- `src/app/admin/prompts/page.tsx` has two tabs: "Book-Level" and "Section-Level"
- Prompt editor uses Textarea with `font-mono text-sm` and min-height 300px
- Word count displayed below textarea
- "Save Template" button disabled when no changes, calls `PATCH /api/admin/prompts`
- "Discard Changes" button reverts textarea to saved content
- `src/app/admin/audit/page.tsx` shows table with columns: Time, Admin, Action, Entity, Old Value, New Value
- Action column shows styled badge (e.g., "USER_ROLE_CHANGED", "PROMPT_TEMPLATE_UPDATED")
- All three pages show loading skeletons while fetching
- `npx tsc --noEmit` exits 0
</acceptance_criteria>

---

## Task 06: Write admin integration tests

<read_first>
- `src/server/services/admin.ts` (created in Task 01)
- `src/server/__tests__/admin.test.ts` (stub from 01-PLAN)
</read_first>

<action>
Replace `src/server/__tests__/admin.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    promptTemplate: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: { getSession: vi.fn() },
    $Infer: { Session: {} },
  },
}));

import { db } from "@/server/db";
import { requireAdmin, AuthError } from "@/lib/auth-guards";
import { getAllUsers, changeUserRole, updatePromptTemplate, getAuditLogs } from "@/server/services/admin";

describe("ADM-01..07: Admin Panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ADM-01: User list", () => {
    it("returns paginated user list", async () => {
      vi.mocked(db.user.findMany).mockResolvedValue([]);
      vi.mocked(db.user.count).mockResolvedValue(0);

      const result = await getAllUsers(1, 20);
      expect(result).toEqual({ users: [], total: 0, page: 1, pageSize: 20 });
      expect(db.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: { createdAt: "desc" },
        })
      );
    });

    it("filters by search term", async () => {
      vi.mocked(db.user.findMany).mockResolvedValue([]);
      vi.mocked(db.user.count).mockResolvedValue(0);

      await getAllUsers(1, 20, "test");
      expect(db.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { name: { contains: "test" } },
              { email: { contains: "test" } },
            ],
          },
        })
      );
    });
  });

  describe("ADM-02: Role change", () => {
    it("updates user role and creates audit log", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        role: "regular",
      } as any);
      vi.mocked(db.user.update).mockResolvedValue({} as any);
      vi.mocked(db.auditLog.create).mockResolvedValue({} as any);

      const result = await changeUserRole("admin-1", "user-1", "pro");

      expect(result.changed).toBe(true);
      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { role: "pro" },
      });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: "admin-1",
          action: "USER_ROLE_CHANGED",
          entityType: "user",
          entityId: "user-1",
          oldValue: "regular",
          newValue: "pro",
        }),
      });
    });

    it("does nothing if role unchanged", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        role: "pro",
      } as any);

      const result = await changeUserRole("admin-1", "user-1", "pro");
      expect(result.changed).toBe(false);
      expect(db.user.update).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe("ADM-04/05: Prompt template update", () => {
    it("updates template content, increments version, and audits", async () => {
      vi.mocked(db.promptTemplate.findUnique).mockResolvedValue({
        type: "book",
        content: "old content",
        version: 1,
      } as any);
      vi.mocked(db.promptTemplate.update).mockResolvedValue({} as any);
      vi.mocked(db.auditLog.create).mockResolvedValue({} as any);

      await updatePromptTemplate("admin-1", "book", "new content");

      expect(db.promptTemplate.update).toHaveBeenCalledWith({
        where: { type: "book" },
        data: { content: "new content", version: { increment: 1 } },
      });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "PROMPT_TEMPLATE_UPDATED",
          oldValue: "old content",
          newValue: "new content",
        }),
      });
    });
  });

  describe("ADM-06: Audit log query", () => {
    it("returns paginated audit logs with actor info", async () => {
      vi.mocked(db.auditLog.findMany).mockResolvedValue([]);
      vi.mocked(db.auditLog.count).mockResolvedValue(0);

      const result = await getAuditLogs(1, 20);
      expect(result).toEqual({ logs: [], total: 0, page: 1, pageSize: 20 });
      expect(db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { actor: expect.any(Object) },
          orderBy: { createdAt: "desc" },
        })
      );
    });
  });

  describe("ADM-07: Server-side role guards", () => {
    it("requireAdmin throws 403 for regular users", async () => {
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "u1", role: "regular" } as any,
        session: {} as any,
      });

      await expect(requireAdmin()).rejects.toThrow(AuthError);
      try {
        await requireAdmin();
      } catch (e) {
        expect((e as AuthError).statusCode).toBe(403);
      }
    });
  });
});
```
</action>

<acceptance_criteria>
- `src/server/__tests__/admin.test.ts` tests user list with pagination and search
- `src/server/__tests__/admin.test.ts` tests role change with audit log creation
- `src/server/__tests__/admin.test.ts` tests that role change is skipped when role unchanged
- `src/server/__tests__/admin.test.ts` tests prompt template update with version increment and audit
- `src/server/__tests__/admin.test.ts` tests audit log query returns paginated results with actor
- `src/server/__tests__/admin.test.ts` tests requireAdmin throws 403 for regular users
- `npx vitest run src/server/__tests__/admin.test.ts` exits 0
</acceptance_criteria>

---

## Verification

```bash
# Type check
npx tsc --noEmit

# All unit tests
npx vitest run

# Admin routes require auth (returns redirect to /login for unauthenticated)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin/users
# Should be 307 redirect

# Admin API requires admin role
curl -s http://localhost:3000/api/admin/users | grep 401

# Admin sidebar has 4 nav items
grep -c "Users\|Universal Library\|Prompt Templates\|Audit Log" src/components/admin/admin-sidebar.tsx
```

## must_haves

- [ ] Admin layout calls `requireAdmin()` server-side on every page load — redirects non-admin to `/my-library`
- [ ] Every admin API endpoint calls `requireAdmin()` as first operation — returns 403 for non-admin
- [ ] Admin sidebar has exactly 4 items: Users, Universal Library, Prompt Templates, Audit Log
- [ ] User management page shows paginated table with role change via inline Select
- [ ] Role change creates audit log entry with old/new values
- [ ] Universal Library page shows all books with uploader info and user count
- [ ] Prompt template editor has two tabs (Book-Level, Section-Level) with monospace textarea
- [ ] Prompt template saves increment version number and create audit log
- [ ] Audit log page shows all admin actions with who/what/when/old/new
- [ ] Audit log is append-only — no edit or delete operations
- [ ] No admin routes or nav items visible to non-admin users
- [ ] No client-side-only role checks for security decisions
- [ ] Codebase search for "summary" in user-facing code returns 0 results
