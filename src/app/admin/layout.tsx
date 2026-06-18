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
      <aside className="hidden w-[260px] flex-shrink-0 border-r border-border bg-muted lg:block">
        <div className="p-4">
          <h2 className="text-[20px] font-semibold text-foreground">Admin</h2>
        </div>
        <AdminSidebar />
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-background p-8">{children}</main>
    </div>
  );
}
