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
