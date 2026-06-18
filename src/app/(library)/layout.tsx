import { requireAuth } from "@/lib/auth-guards";
import { RoleBadge } from "@/components/auth/role-badge";
import { UserNav } from "@/components/auth/user-nav";
import Link from "next/link";

export default async function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-16 items-center border-b border-line bg-card px-8">
        <Link
          href="/my-library"
          className="text-[20px] font-semibold tracking-tight text-espresso"
        >
          <span className="text-b-teal">(</span>
          nutshell
          <span className="text-lav">)</span>
        </Link>
        <nav className="mx-auto flex items-center gap-6">
          <Link
            href="/my-library"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            My Library
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <RoleBadge role={user.role} />
          <UserNav />
        </div>
      </header>
      <main className="mx-auto max-w-[1280px] px-8 py-6">{children}</main>
    </div>
  );
}
