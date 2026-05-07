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
