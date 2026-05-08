import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { getPersonalLibrary } from "@/server/services/library";

export async function GET() {
  try {
    const user = await requireAuth();
    const books = await getPersonalLibrary(user.id);

    return NextResponse.json({ books });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to load library" }, { status: 500 });
  }
}
