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
    <div className="min-h-screen pt-12">
      <header className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-8">
        <Link href="/my-library">
          <img
            src="/images/nutshell_logo_chocolate.svg"
            alt="Nutshell"
            className="h-8 w-auto"
          />
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
