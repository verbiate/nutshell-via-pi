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
