import { requireAuth } from "@/lib/auth-guards";
import { UserNav } from "@/components/auth/user-nav";
import { UploadBookDialog } from "@/components/library/upload-book-dialog";
import Link from "next/link";

export default async function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuth();

  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between bg-lav px-8">
        <Link
          href="/my-library"
          className="text-[20px] font-semibold tracking-tight text-white"
        >
          <span className="text-b-teal">(</span>
          nutshell<span className="text-white/80">)</span>
        </Link>
        <div className="flex items-center gap-3">
          <UploadBookDialog />
          <UserNav />
        </div>
      </header>
      <main className="mx-auto max-w-[1280px] px-8 py-8">{children}</main>
    </div>
  );
}
