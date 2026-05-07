---
wave: 1
depends_on: []
files_modified:
  - package.json
  - tsconfig.json
  - next.config.ts
  - src/app/layout.tsx
  - src/app/page.tsx
  - src/app/globals.css
  - src/server/db/schema.prisma
  - src/server/db/index.ts
  - src/lib/utils.ts
  - .env.example
  - .gitignore
  - vitest.config.ts
  - playwright.config.ts
  - postcss.config.mjs
  - components.json
  - src/components/ui/** (shadcn components)
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

# Plan 01: Project Scaffolding & Database Schema

Sets up the entire Next.js 16 project, configures all tooling, installs dependencies at pinned versions, defines the complete Prisma schema, runs the initial migration, and seeds default prompt templates.

## Task 01: Initialize Next.js 16 project with TypeScript strict and Tailwind CSS v4

<read_first>
- (greenfield — no existing files to read)
- `.planning/research/STACK.md` — exact version pins and installation commands
- `.planning/research/ARCHITECTURE.md` — project structure recommendation
</read_first>

<action>
1. Initialize Next.js 16 project in the current directory (not a subdirectory) using `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --turbopack` — accept defaults but ensure App Router and `src/` directory.
2. Verify `package.json` contains `"next": "16.2.5"`, `"react": "19.2.6"`, `"react-dom": "19.2.6"`, `"typescript": "6.0.3"`.
3. Replace the default `tsconfig.json` to ensure:
   - `"strict": true` is set
   - `"paths": { "@/*": ["./src/*"] }` is configured
   - `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`
4. Replace the default `src/app/globals.css` with Tailwind CSS v4 imports only:
   ```css
   @import "tailwindcss";
   ```
5. Create `.env.example` with these exact variables (empty values):
   ```
   DATABASE_URL="file:./dev.db"
   BETTER_AUTH_SECRET=""
   BETTER_AUTH_URL="http://localhost:3000"
   GOOGLE_CLIENT_ID=""
   GOOGLE_CLIENT_SECRET=""
   STORAGE_PATH="./data/uploads"
   ```
6. Create `.gitignore` entries for:
   - `node_modules/`
   - `.next/`
   - `.env`
   - `.env.local`
   - `*.db`
   - `*.db-journal`
   - `data/uploads/`
7. Create directory structure per ARCHITECTURE.md:
   - `src/app/(auth)/`
   - `src/app/(library)/`
   - `src/app/admin/`
   - `src/app/api/auth/[...all]/`
   - `src/app/api/books/`
   - `src/app/api/admin/users/`
   - `src/app/api/admin/books/`
   - `src/app/api/admin/prompts/`
   - `src/app/api/admin/audit/`
   - `src/server/db/`
   - `src/server/services/`
   - `src/server/storage/`
   - `src/server/__tests__/`
   - `src/lib/`
   - `src/components/ui/`
   - `src/components/library/`
   - `src/components/admin/`
   - `src/hooks/`
   - `src/types/`
   - `e2e/`
   - `data/uploads/epubs/`
   - `data/uploads/txts/`
   - `data/uploads/covers/`
</action>

<acceptance_criteria>
- `package.json` contains `"next": "16.2.5"`, `"react": "19.2.6"`, `"react-dom": "19.2.6"`
- `tsconfig.json` contains `"strict": true` and `"paths": { "@/*": ["./src/*"] }`
- `src/app/globals.css` contains `@import "tailwindcss";`
- `.env.example` exists with all 6 variables listed above
- `.gitignore` contains `node_modules/`, `.next/`, `.env`, `*.db`, `data/uploads/`
- All directories listed above exist (verified by `ls -d src/app/admin src/server/db src/server/services src/server/storage src/components/ui src/components/library src/components/admin e2e data/uploads/epubs data/uploads/txts data/uploads/covers`)
- `npx next build` exits 0 (or at minimum `npx tsc --noEmit` exits 0)
</acceptance_criteria>

---

## Task 02: Install pinned dependencies and configure PostCSS

<read_first>
- `package.json` (current state after Task 01)
- `.planning/research/STACK.md` — pinned versions and "What NOT to Use" section
</read_first>

<action>
1. Install core runtime dependencies with EXACT versions:
   ```bash
   npm install prisma@5.22.0 @prisma/client@5.22.0
   npm install better-auth@1.6.9
   npm install @likecoin/epub-ts@0.6.3 jszip@3.10.1
   npm install @tanstack/react-query@5.100.9 zustand@5.0.13
   npm install lucide-react@1.14.0 class-variance-authority@0.7.1 clsx@2.1.1 tailwind-merge@3.5.0
   npm install sonner@2.0.7 franc@6.2.0
   ```
2. Install dev dependencies:
   ```bash
   npm install -D @better-auth/cli vitest @vitejs/plugin-react tsx
   npm install -D @playwright/test
   ```
3. Verify `package.json` does NOT contain any version of `prisma` or `@prisma/client` above `5.22.0`.
4. Create `postcss.config.mjs` with:
   ```js
   /** @type {import('postcss-load-config').Config} */
   const config = {
     plugins: {
       "@tailwindcss/postcss": {},
     },
   };
   export default config;
   ```
5. Create `src/lib/utils.ts` with the standard shadcn utility:
   ```typescript
   import { clsx, type ClassValue } from "clsx";
   import { twMerge } from "tailwind-merge";

   export function cn(...inputs: ClassValue[]) {
     return twMerge(clsx(inputs));
   }
   ```
</action>

<acceptance_criteria>
- `package.json` contains `"prisma": "5.22.0"`, `"@prisma/client": "5.22.0"`, `"better-auth": "1.6.9"`
- `package.json` does NOT contain `"@prisma/client"` with version >= 7.0.0
- `postcss.config.mjs` exists and contains `"@tailwindcss/postcss"`
- `src/lib/utils.ts` exists and exports `function cn(...inputs: ClassValue[]): string`
- `npm ls prisma` shows only `prisma@5.22.0` (no 7.x)
</acceptance_criteria>

---

## Task 03: Initialize shadcn/ui with slate preset and install all components

<read_first>
- `src/lib/utils.ts` (must exist from Task 02)
- `.planning/phases/01-foundation/01-UI-SPEC.md` — "shadcn Initialization Notes" section listing exact components
</read_first>

<action>
1. Initialize shadcn/ui:
   ```bash
   npx shadcn@latest init --yes --template next --base-color slate
   ```
   This creates `components.json` and `src/components/ui/` directory.
2. Install all components listed in UI-SPEC.md:
   ```bash
   npx shadcn@latest add button card dialog table input label form badge skeleton tabs textarea dropdown-menu sidebar sheet command pagination select separator avatar tooltip scroll-area
   npx shadcn@latest add sonner
   ```
3. Verify `components.json` exists with `"baseColor": "slate"`.
4. Verify all component files exist in `src/components/ui/`:
   - `button.tsx`, `card.tsx`, `dialog.tsx`, `table.tsx`, `input.tsx`, `label.tsx`, `form.tsx`, `badge.tsx`, `skeleton.tsx`, `tabs.tsx`, `textarea.tsx`, `dropdown-menu.tsx`, `sidebar.tsx`, `sheet.tsx`, `command.tsx`, `pagination.tsx`, `select.tsx`, `separator.tsx`, `avatar.tsx`, `tooltip.tsx`, `scroll-area.tsx`, `sonner.tsx`
</action>

<acceptance_criteria>
- `components.json` exists and contains `"baseColor": "slate"`
- `src/components/ui/button.tsx` exists
- `src/components/ui/card.tsx` exists
- `src/components/ui/dialog.tsx` exists
- `src/components/ui/table.tsx` exists
- `src/components/ui/sidebar.tsx` exists
- `src/components/ui/sonner.tsx` exists
- All 22 component files listed above exist in `src/components/ui/`
- `npx tsc --noEmit` exits 0
</acceptance_criteria>

---

## Task 04: Define complete Prisma 5 schema with all Phase 1 tables

<read_first>
- `.planning/phases/01-foundation/01-RESEARCH.md` — Section 3.2 "Tier 1: Database Schema" with complete Prisma schema
- `.planning/research/ARCHITECTURE.md` — "Universal Library with Access Grants" pattern
- `.planning/REQUIREMENTS.md` — Phase 1 requirements for data model
</read_first>

<action>
1. Create `src/server/db/schema.prisma` with this exact content:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

enum UserRole {
  regular
  pro
  admin
}

model User {
  id            String          @id
  email         String          @unique
  name          String?
  image         String?
  role          UserRole        @default(regular)
  emailVerified Boolean         @default(false)
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  sessions      Session[]
  accounts      Account[]
  bookAccesses  UserBookAccess[]
  uploadedBooks EpubFile[]      @relation("UploadedBooks")
  auditLogs     AuditLog[]
}

model Session {
  id        String   @id
  userId    String
  token     String   @unique
  expiresAt DateTime
  ipAddress String?
  userAgent String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Account {
  id                    String    @id
  userId                String
  accountId             String
  providerId            String
  accessToken           String?
  refreshToken          String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  idToken               String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model EpubFile {
  id           String   @id @default(cuid())
  md5          String   @unique
  title        String
  author       String?
  language     String   @default("und")
  coverPath    String?
  epubPath     String
  txtPath      String
  tocJson      String?
  fileSize     Int
  uploadedById String?
  uploadedBy   User?    @relation("UploadedBooks", fields: [uploadedById], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  userAccesses UserBookAccess[]
}

model UserBookAccess {
  id        String   @id @default(cuid())
  userId    String
  bookId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  book      EpubFile @relation(fields: [bookId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@unique([userId, bookId])
}

model PromptTemplate {
  id        String   @id @default(cuid())
  type      String   @unique
  content   String
  version   Int      @default(1)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model AuditLog {
  id         String   @id @default(cuid())
  actorId    String
  action     String
  entityType String
  entityId   String
  oldValue   String?
  newValue   String?
  createdAt  DateTime @default(now())

  actor User @relation(fields: [actorId], references: [id])
}
```

2. Create `src/server/db/index.ts` with Prisma client singleton:
```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
```

3. Run `npx prisma generate` to generate the client.
4. Run `npx prisma migrate dev --name init` to create the initial migration and SQLite database.
5. Create `prisma/seed.ts` that inserts default prompt templates:
```typescript
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  await prisma.promptTemplate.upsert({
    where: { type: "book" },
    update: {},
    create: {
      type: "book",
      content: "You are an expert literary analyst. The user has uploaded a book and wants to understand it deeply.\n\nBook title: {{title}}\nAuthor: {{author}}\nLanguage: {{language}}\n\nBelow is the full text of the book:\n---\n{{text}}\n---\n\nPlease provide a comprehensive explanation of this book in {{target_language}}. Cover the main themes, key arguments or plot points, important characters, and the author's style. Help the reader understand not just what happens, but why it matters. Do NOT simply summarize — explain and illuminate.",
      version: 1,
    },
  });

  await prisma.promptTemplate.upsert({
    where: { type: "section" },
    update: {},
    create: {
      type: "section",
      content: "You are an expert literary analyst. The user is reading a book and wants to understand a specific section.\n\nBook title: {{title}}\nAuthor: {{author}}\nSection: {{section_title}}\n\nBelow is the text of this section:\n---\n{{text}}\n---\n\nPlease provide a clear explanation of this section in {{target_language}}. Cover what happens or what is argued, why it matters in the context of the whole book, any important themes or symbols, and connections to other parts of the book. Do NOT simply summarize — explain and illuminate.",
      version: 1,
    },
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```
6. Add to `package.json`:
```json
"prisma": {
  "seed": "npx tsx prisma/seed.ts"
}
```
7. Run `npx prisma db seed` to insert the default templates.
</action>

<acceptance_criteria>
- `src/server/db/schema.prisma` contains `model User` with `role UserRole @default(regular)` field
- `src/server/db/schema.prisma` contains `enum UserRole { regular pro admin }`
- `src/server/db/schema.prisma` contains `model EpubFile` with `md5 String @unique`
- `src/server/db/schema.prisma` contains `model UserBookAccess` with `@@unique([userId, bookId])`
- `src/server/db/schema.prisma` contains `model PromptTemplate` with `type String @unique`
- `src/server/db/schema.prisma` contains `model AuditLog` with `actorId`, `action`, `entityType`, `entityId`, `oldValue`, `newValue` fields
- `src/server/db/schema.prisma` contains `model Session`, `model Account`, `model Verification` (Better Auth tables)
- `src/server/db/index.ts` exports `db` as `PrismaClient` singleton
- `npx prisma generate` exits 0
- `prisma/dev.db` file exists (SQLite database created)
- `prisma/seed.ts` exists with both "book" and "section" prompt template seeds
- Running `npx tsx -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.promptTemplate.findMany().then(r=>{console.log(r.length);p.\$disconnect()})"` outputs `2` (both templates seeded)
</acceptance_criteria>

---

## Task 05: Configure vitest and create test stubs

<read_first>
- `.planning/phases/01-foundation/01-VALIDATION.md` — test infrastructure config and Wave 0 requirements
- `tsconfig.json` — path aliases
</read_first>

<action>
1. Create `vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test-setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

2. Create `src/test-setup.ts`:
```typescript
// Test setup — extend as needed
process.env.DATABASE_URL = "file:./test.db";
process.env.BETTER_AUTH_SECRET = "test-secret-for-vitest-only";
process.env.STORAGE_PATH = "./test-uploads";
```

3. Create test stub files with placeholder tests:
   - `src/server/__tests__/auth.test.ts` — describe("AUTH-01..05", () => { it.todo("implements auth tests"); })
   - `src/server/__tests__/epub.test.ts` — describe("LIB-01..04: EPUB processing", () => { it.todo("implements epub tests"); })
   - `src/server/__tests__/upload.test.ts` — describe("Upload integration", () => { it.todo("implements upload tests"); })
   - `src/server/__tests__/admin.test.ts` — describe("ADM-01..07", () => { it.todo("implements admin tests"); })
   - `src/server/__tests__/lang.test.ts` — describe("LANG-03: Language detection", () => { it.todo("implements language tests"); })

4. Create `playwright.config.ts`:
```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
```

5. Create E2E test stubs:
   - `e2e/auth.spec.ts` — test.describe("Auth flow", () => { test.skip("E2E auth tests"); })
   - `e2e/library.spec.ts` — test.describe("Library views", () => { test.skip("E2E library tests"); })
   - `e2e/admin.spec.ts` — test.describe("Admin panel", () => { test.skip("E2E admin tests"); })
</action>

<acceptance_criteria>
- `vitest.config.ts` exists with `environment: "node"` and path alias `@` -> `./src`
- `playwright.config.ts` exists with `testDir: "./e2e"` and `baseURL: "http://localhost:3000"`
- `src/test-setup.ts` exists with `DATABASE_URL` and `BETTER_AUTH_SECRET` env vars
- `src/server/__tests__/auth.test.ts` exists and contains `describe("AUTH-01..05"`
- `src/server/__tests__/epub.test.ts` exists and contains `describe("LIB-01..04`
- `src/server/__tests__/upload.test.ts` exists
- `src/server/__tests__/admin.test.ts` exists and contains `describe("ADM-01..07`
- `src/server/__tests__/lang.test.ts` exists and contains `describe("LANG-03`
- `e2e/auth.spec.ts`, `e2e/library.spec.ts`, `e2e/admin.spec.ts` exist
- `npx vitest run` exits 0 (all stubs pass with todo/skip)
</acceptance_criteria>

---

## Task 06: Create file storage abstraction and .env file

<read_first>
- `.planning/research/ARCHITECTURE.md` — "server/storage/" pattern
- `.env.example` (created in Task 01)
</read_first>

<action>
1. Create `src/server/storage/types.ts`:
```typescript
export interface StorageProvider {
  write(path: string, data: Buffer | string | NodeJS.ReadableStream): Promise<string>;
  read(path: string): Promise<Buffer>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  getUrl(path: string): string;
}
```

2. Create `src/server/storage/local.ts`:
```typescript
import fs from "fs/promises";
import path from "path";
import { StorageProvider } from "./types";

const STORAGE_ROOT = process.env.STORAGE_PATH || "./data/uploads";

export class LocalStorage implements StorageProvider {
  async write(relativePath: string, data: Buffer | string | NodeJS.ReadableStream): Promise<string> {
    const fullPath = path.join(STORAGE_ROOT, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    if (typeof data === "string" || Buffer.isBuffer(data)) {
      await fs.writeFile(fullPath, data);
    } else {
      const stream = fs.createWriteStream(fullPath);
      await new Promise<void>((resolve, reject) => {
        data.pipe(stream);
        stream.on("finish", resolve);
        stream.on("error", reject);
      });
    }
    return fullPath;
  }

  async read(relativePath: string): Promise<Buffer> {
    const fullPath = path.join(STORAGE_ROOT, relativePath);
    return fs.readFile(fullPath);
  }

  async exists(relativePath: string): Promise<boolean> {
    const fullPath = path.join(STORAGE_ROOT, relativePath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async delete(relativePath: string): Promise<void> {
    const fullPath = path.join(STORAGE_ROOT, relativePath);
    await fs.unlink(fullPath).catch(() => {});
  }

  getUrl(relativePath: string): string {
    return `/api/files/${relativePath}`;
  }
}

export const storage = new LocalStorage();
```

3. Create `.env` by copying `.env.example` and filling in a random `BETTER_AUTH_SECRET`:
   ```
   DATABASE_URL="file:./prisma/dev.db"
   BETTER_AUTH_SECRET="dev-secret-change-in-production-min-32-chars"
   BETTER_AUTH_URL="http://localhost:3000"
   GOOGLE_CLIENT_ID=""
   GOOGLE_CLIENT_SECRET=""
   STORAGE_PATH="./data/uploads"
   ```

4. Create `data/uploads/.gitkeep` to ensure the uploads directory is tracked.
</action>

<acceptance_criteria>
- `src/server/storage/types.ts` exports `interface StorageProvider` with methods `write`, `read`, `exists`, `delete`, `getUrl`
- `src/server/storage/local.ts` exports `class LocalStorage implements StorageProvider`
- `src/server/storage/local.ts` exports `const storage: LocalStorage`
- `.env` exists with `DATABASE_URL`, `BETTER_AUTH_SECRET`, `STORAGE_PATH` populated
- `data/uploads/.gitkeep` exists
- `npx tsc --noEmit` exits 0
</acceptance_criteria>

---

## Task 07: Create root layout with Toaster, minimum viable home page

<read_first>
- `src/app/layout.tsx` (auto-generated by create-next-app)
- `src/app/globals.css` (created in Task 01)
- `.planning/phases/01-foundation/01-UI-SPEC.md` — "App Shell (Authenticated)" layout contract, typography scale, spacing scale
</read_first>

<action>
1. Replace `src/app/layout.tsx` with:
```tsx
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

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
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
```

2. Replace `src/app/page.tsx` with a minimal landing page:
```tsx
export default function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <h1 className="text-[28px] font-semibold text-slate-900">BusyReader</h1>
        <p className="mt-2 text-base text-slate-500">
          AI-powered ebook reader for deep understanding
        </p>
      </div>
    </div>
  );
}
```

3. Create `src/types/book.ts` with shared types:
```typescript
export interface Book {
  id: string;
  md5: string;
  title: string;
  author: string | null;
  language: string;
  coverPath: string | null;
  epubPath: string;
  txtPath: string;
  tocJson: string | null;
  fileSize: number;
  uploadedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BookWithAccess extends Book {
  accessGrantedAt: Date;
}

export type UserRole = "regular" | "pro" | "admin";
```
</action>

<acceptance_criteria>
- `src/app/layout.tsx` imports `Toaster` from `@/components/ui/sonner`
- `src/app/layout.tsx` uses `Geist` font from `next/font/google`
- `src/app/layout.tsx` renders `<Toaster position="bottom-right" />`
- `src/app/page.tsx` contains "BusyReader" text
- `src/types/book.ts` exports `interface Book`, `interface BookWithAccess`, `type UserRole`
- `npx tsc --noEmit` exits 0
- `npm run dev` starts without error (verify with `curl -s http://localhost:3000 | head -5` then kill)
</acceptance_criteria>

---

## Verification

```bash
# Type check passes
npx tsc --noEmit

# Tests pass (stubs)
npx vitest run

# Prisma client generates
npx prisma generate

# Database exists and has tables
npx prisma db push --accept-data-loss

# Seed templates exist
npx tsx -e "import{PrismaClient}from'@prisma/client';const p=new PrismaClient();const r=await p.promptTemplate.findMany();console.log(r.length);await p.\$disconnect()"

# Build succeeds
npm run build
```

## must_haves

- [ ] Next.js 16.2.5 project builds and runs without error
- [ ] Prisma 5.22.0 (NOT 7.x) is the only Prisma version installed
- [ ] SQLite database exists with all tables: User, Session, Account, Verification, EpubFile, UserBookAccess, PromptTemplate, AuditLog
- [ ] Default prompt templates seeded: one "book" type, one "section" type
- [ ] shadcn/ui initialized with slate preset, all 22 components installed
- [ ] Storage abstraction exists with LocalStorage implementation
- [ ] Test infrastructure configured: vitest + playwright with stubs
- [ ] `.env.example` documents all required environment variables
- [ ] Codebase contains ZERO occurrences of "summary" in user-facing code (only "Explainer")
