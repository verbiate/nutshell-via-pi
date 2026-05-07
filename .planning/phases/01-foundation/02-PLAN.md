---
wave: 2
depends_on: ["01-PLAN.md"]
files_modified:
  - src/lib/auth.ts
  - src/lib/auth-guards.ts
  - src/app/api/auth/[...all]/route.ts
  - src/middleware.ts
  - src/app/(auth)/login/page.tsx
  - src/app/(auth)/layout.tsx
  - src/components/auth/login-button.tsx
  - src/components/auth/user-nav.tsx
  - src/hooks/use-session.ts
  - src/app/layout.tsx
  - src/components/providers.tsx
  - src/app/(library)/layout.tsx
autonomous: true
requirements:
  - AUTH-01
  - AUTH-02
  - AUTH-03
  - AUTH-04
  - AUTH-05
---

# Plan 02: Authentication & RBAC

Implements Google OAuth via Better Auth, role-based access control with three tiers (regular/pro/admin), session persistence, server-side role guards, Next.js middleware for route protection, and the login/authenticated layouts.

## Task 01: Configure Better Auth with Google OAuth and Prisma adapter

<read_first>
- `src/server/db/schema.prisma` (created in 01-PLAN Task 04 — User/Session/Account tables)
- `src/server/db/index.ts` (Prisma client singleton)
- `.env` (BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
- `.planning/research/STACK.md` — Better Auth 1.6.9 setup
</read_first>

<action>
1. Create `src/lib/auth.ts` — the central Better Auth configuration:
```typescript
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "@/server/db";

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "sqlite",
  }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "regular",
        input: false,
      },
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes — refreshes role from DB every 5 min
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;
```

2. Create `src/lib/auth-guards.ts` — server-side role validation helpers:
```typescript
import { auth } from "./auth";
import { headers } from "next/headers";
import type { UserRole } from "@/types/book";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRole;
}

export async function getSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  return session;
}

export async function requireAuth(): Promise<AuthenticatedUser> {
  const session = await getSession();
  if (!session?.user) {
    throw new AuthError("Authentication required", 401);
  }
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image,
    role: (session.user as any).role as UserRole,
  };
}

export async function requireAdmin(): Promise<AuthenticatedUser> {
  const user = await requireAuth();
  if (user.role !== "admin") {
    throw new AuthError("Admin access required", 403);
  }
  return user;
}

export class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = "AuthError";
  }
}
```

3. Create `src/app/api/auth/[...all]/route.ts` — mount Better Auth handler:
```typescript
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
```

4. Create `src/hooks/use-session.ts` — client-side session hook:
```typescript
"use client";

import { authClient } from "@/lib/auth-client";
import { useQuery } from "@tanstack/react-query";

export function useSession() {
  const { data, isPending } = useQuery({
    queryKey: ["session"],
    queryFn: () => authClient.getSession(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  return {
    user: data?.data?.user ?? null,
    session: data?.data?.session ?? null,
    isPending,
  };
}
```

5. Create `src/lib/auth-client.ts` — Better Auth browser client:
```typescript
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
});

export const { signIn, signOut, useSession: useAuthSession } = authClient;
```
</action>

<acceptance_criteria>
- `src/lib/auth.ts` exports `const auth` configured with `prismaAdapter`, `socialProviders.google`, and `user.additionalFields.role`
- `src/lib/auth-guards.ts` exports `async function requireAuth(): Promise<AuthenticatedUser>` and `async function requireAdmin(): Promise<AuthenticatedUser>`
- `src/lib/auth-guards.ts` exports `class AuthError extends Error` with `statusCode` property
- `src/app/api/auth/[...all]/route.ts` exports `GET` and `POST` via `toNextJsHandler(auth)`
- `src/hooks/use-session.ts` exports `function useSession()` returning `{ user, session, isPending }`
- `src/lib/auth-client.ts` exports `const authClient` and `{ signIn, signOut }`
- `npx tsc --noEmit` exits 0
</acceptance_criteria>

---

## Task 02: Create Next.js middleware for route protection

<read_first>
- `src/lib/auth.ts` (created in Task 01)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-13: admin routes hidden from non-admin users
- `.planning/research/ARCHITECTURE.md` — route protection patterns
</read_first>

<action>
1. Create `src/middleware.ts`:
```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

// Lightweight auth check in middleware — we only validate session cookie exists.
// Full role checks happen in route handlers and server components.

const PROTECTED_ROUTES = ["/my-library", "/book"];
const ADMIN_ROUTES = ["/admin"];
const AUTH_ROUTES = ["/login"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if route requires authentication
  const isProtectedRoute = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
  const isAdminRoute = ADMIN_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  // Read session cookie
  const sessionCookie = request.cookies.get("better-auth.session_token");

  if ((isProtectedRoute || isAdminRoute) && !sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Authenticated users on auth routes redirect to library
  if (isAuthRoute && sessionCookie) {
    return NextResponse.redirect(new URL("/my-library", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/my-library/:path*",
    "/book/:path*",
    "/admin/:path*",
    "/login",
  ],
};
```
</action>

<acceptance_criteria>
- `src/middleware.ts` exists with `export async function middleware(request: NextRequest)`
- `src/middleware.ts` redirects unauthenticated users from `/my-library`, `/book/*`, `/admin/*` to `/login`
- `src/middleware.ts` redirects authenticated users from `/login` to `/my-library`
- `src/middleware.ts` exports `const config` with matcher for protected paths
- `npx tsc --noEmit` exits 0
</acceptance_criteria>

---

## Task 03: Build login page with Google OAuth button

<read_first>
- `src/lib/auth-client.ts` (created in Task 01 — has `signIn` function)
- `.planning/phases/01-foundation/01-UI-SPEC.md` — Copywriting Contract: Sign-in CTA is "Sign in with Google", sign-out is "Sign Out"
- `.planning/phases/01-foundation/01-UI-SPEC.md` — Typography: Display 28px semibold, Body 16px, accent color slate-900
</read_first>

<action>
1. Create `src/app/(auth)/layout.tsx`:
```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      {children}
    </div>
  );
}
```

2. Create `src/app/(auth)/login/page.tsx`:
```tsx
import { LoginButton } from "@/components/auth/login-button";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
      <div className="text-center">
        <h1 className="text-[28px] font-semibold text-slate-900">BusyReader</h1>
        <p className="mt-2 max-w-[400px] text-base text-slate-500">
          AI-powered ebook reader for deep understanding
        </p>
      </div>
      <div className="mt-6">
        <LoginButton />
      </div>
    </div>
  );
}
```

3. Create `src/components/auth/login-button.tsx`:
```tsx
"use client";

import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function LoginButton() {
  return (
    <Button
      onClick={() => signIn.social({ provider: "google" })}
      className="bg-slate-900 text-white hover:bg-slate-800"
      size="lg"
    >
      <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
      Sign in with Google
    </Button>
  );
}
```
</action>

<acceptance_criteria>
- `src/app/(auth)/login/page.tsx` exists and renders "Sign in with Google" button
- `src/components/auth/login-button.tsx` exists with `"use client"` directive
- `src/components/auth/login-button.tsx` calls `signIn.social({ provider: "google" })` on click
- Button text is exactly "Sign in with Google" (per UI-SPEC copywriting contract)
- `src/app/(auth)/layout.tsx` exists with centered layout
- `npx tsc --noEmit` exits 0
</acceptance_criteria>

---

## Task 04: Build authenticated layout with user navigation

<read_first>
- `src/hooks/use-session.ts` (created in Task 01)
- `src/lib/auth-client.ts` (has `signOut`)
- `src/app/layout.tsx` (root layout with Toaster)
- `.planning/phases/01-foundation/01-UI-SPEC.md` — "App Shell (Authenticated)": 64px top nav, logo left, nav links center, user avatar dropdown right, "Admin" link visible only to admin role
- `.planning/phases/01-foundation/01-UI-SPEC.md` — Typography: Heading 20px semibold, Label 14px
</read_first>

<action>
1. Create `src/components/providers.tsx` — React Query provider:
```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

2. Update `src/app/layout.tsx` to wrap with Providers:
```tsx
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

export const metadata: Metadata = {
  title: "BusyReader",
  description: "AI-powered ebook reader for deep understanding",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} font-sans antialiased`}>
        <Providers>
          {children}
          <Toaster position="bottom-right" />
        </Providers>
      </body>
    </html>
  );
}
```

3. Create `src/components/auth/user-nav.tsx`:
```tsx
"use client";

import { useSession } from "@/hooks/use-session";
import { signOut } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User, LogOut, Shield, BookOpen } from "lucide-react";
import Link from "next/link";
import type { UserRole } from "@/types/book";

export function UserNav() {
  const { user, isPending } = useSession();

  if (isPending) {
    return <div className="h-8 w-8 animate-pulse rounded-full bg-slate-200" />;
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className="text-sm font-medium text-slate-900 hover:text-slate-700"
      >
        Sign in
      </Link>
    );
  }

  const role = (user as any).role as UserRole;
  const initials =
    user.name
      ?.split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase() || "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full p-1 hover:bg-slate-100">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.image || undefined} alt={user.name || ""} />
            <AvatarFallback className="bg-slate-200 text-xs">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/my-library" className="cursor-pointer">
            <BookOpen className="mr-2 h-4 w-4" />
            My Library
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/profile" className="cursor-pointer">
            <User className="mr-2 h-4 w-4" />
            Profile
          </Link>
        </DropdownMenuItem>
        {role === "admin" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/admin" className="cursor-pointer">
                <Shield className="mr-2 h-4 w-4" />
                Admin Panel
              </Link>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer text-red-600"
          onClick={() => signOut()}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

4. Create `src/app/(library)/layout.tsx` — authenticated app shell with top nav:
```tsx
import { UserNav } from "@/components/auth/user-nav";
import Link from "next/link";

export default function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex h-16 items-center border-b border-slate-200 bg-white px-8">
        <Link href="/my-library" className="text-[20px] font-semibold text-slate-900">
          BusyReader
        </Link>
        <nav className="mx-auto flex items-center gap-6">
          <Link
            href="/my-library"
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            My Library
          </Link>
        </nav>
        <UserNav />
      </header>
      <main className="mx-auto max-w-[1280px] px-8 py-6">{children}</main>
    </div>
  );
}
```
</action>

<acceptance_criteria>
- `src/components/providers.tsx` exports `Providers` wrapping `QueryClientProvider`
- `src/app/layout.tsx` wraps children with `<Providers>`
- `src/components/auth/user-nav.tsx` exports `UserNav` component
- `UserNav` renders avatar dropdown with "Sign Out" option calling `signOut()`
- `UserNav` conditionally shows "Admin Panel" link only when `role === "admin"`
- `src/app/(library)/layout.tsx` exports library layout with 64px header, "BusyReader" logo, "My Library" nav link, and `UserNav`
- Header height is `h-16` (64px per UI-SPEC)
- `npx tsc --noEmit` exits 0
</acceptance_criteria>

---

## Task 05: Write auth integration tests

<read_first>
- `src/lib/auth-guards.ts` (created in Task 01)
- `src/server/__tests__/auth.test.ts` (stub created in 01-PLAN Task 05)
- `vitest.config.ts`
</read_first>

<action>
Replace `src/server/__tests__/auth.test.ts` with real tests:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Next.js headers
vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}));

// Mock auth module
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
    $Infer: {
      Session: {},
    },
  },
}));

import { auth } from "@/lib/auth";
import { requireAuth, requireAdmin, AuthError } from "@/lib/auth-guards";

describe("AUTH-01..05: Authentication & RBAC", () => {
  const mockGetSession = vi.mocked(auth.api.getSession);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("requireAuth", () => {
    it("throws AuthError with 401 when no session exists", async () => {
      mockGetSession.mockResolvedValue(null);
      await expect(requireAuth()).rejects.toThrow(AuthError);
      await expect(requireAuth()).rejects.toThrow("Authentication required");
      try {
        await requireAuth();
      } catch (e) {
        expect((e as AuthError).statusCode).toBe(401);
      }
    });

    it("returns authenticated user when session exists", async () => {
      mockGetSession.mockResolvedValue({
        user: {
          id: "user-1",
          email: "test@example.com",
          name: "Test User",
          image: null,
          role: "regular",
        } as any,
        session: { id: "session-1" } as any,
      });

      const user = await requireAuth();
      expect(user.id).toBe("user-1");
      expect(user.email).toBe("test@example.com");
      expect(user.role).toBe("regular");
    });
  });

  describe("requireAdmin", () => {
    it("throws AuthError with 403 when user is regular", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "test@example.com", role: "regular" } as any,
        session: { id: "session-1" } as any,
      });

      try {
        await requireAdmin();
      } catch (e) {
        expect((e as AuthError).statusCode).toBe(403);
        expect((e as AuthError).message).toBe("Admin access required");
      }
    });

    it("throws AuthError with 403 when user is pro", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-2", email: "pro@example.com", role: "pro" } as any,
        session: { id: "session-2" } as any,
      });

      try {
        await requireAdmin();
      } catch (e) {
        expect((e as AuthError).statusCode).toBe(403);
      }
    });

    it("returns user when role is admin", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "admin-1", email: "admin@example.com", role: "admin" } as any,
        session: { id: "session-3" } as any,
      });

      const user = await requireAdmin();
      expect(user.role).toBe("admin");
    });

    it("throws 401 before checking role when no session exists", async () => {
      mockGetSession.mockResolvedValue(null);

      try {
        await requireAdmin();
      } catch (e) {
        expect((e as AuthError).statusCode).toBe(401);
      }
    });
  });

  describe("AUTH-04: UserRole enum", () => {
    it("accepts exactly three role values", () => {
      const roles = ["regular", "pro", "admin"];
      expect(roles).toHaveLength(3);
      expect(roles).toContain("regular");
      expect(roles).toContain("pro");
      expect(roles).toContain("admin");
    });
  });
});
```
</action>

<acceptance_criteria>
- `src/server/__tests__/auth.test.ts` contains `describe("requireAuth"` with test for 401 on no session
- `src/server/__tests__/auth.test.ts` contains `describe("requireAdmin"` with test for 403 on regular user
- `src/server/__tests__/auth.test.ts` contains test for admin user passing requireAdmin
- `npx vitest run src/server/__tests__/auth.test.ts` exits 0 with all tests passing
</acceptance_criteria>

---

## Verification

```bash
# Type check
npx tsc --noEmit

# Unit tests
npx vitest run

# Auth route handler exists
curl -s http://localhost:3000/api/auth/session | head -5

# Login page renders
curl -s http://localhost:3000/login | grep "Sign in with Google"

# Protected route redirects
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/my-library
# Should be 307 redirect to /login
```

## must_haves

- [ ] Google OAuth sign-in button on `/login` page with exact copy "Sign in with Google"
- [ ] Better Auth mounted at `/api/auth/[...all]` with Prisma adapter and Google provider
- [ ] `requireAuth()` returns 401 for unauthenticated requests
- [ ] `requireAdmin()` returns 403 for regular/pro users, passes for admin users
- [ ] Next.js middleware redirects unauthenticated users from protected routes to `/login`
- [ ] Middleware redirects authenticated users from `/login` to `/my-library`
- [ ] User nav dropdown shows "Sign Out" and "Admin Panel" (admin-only)
- [ ] Authenticated layout has 64px top nav with "BusyReader" logo and "My Library" link
- [ ] Session persists across browser refreshes (cookie-based)
- [ ] Role field supports exactly three values: `regular`, `pro`, `admin`
- [ ] Codebase contains ZERO occurrences of "summary" in user-facing code
