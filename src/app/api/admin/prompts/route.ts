import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { getPromptTemplates, getPromptTemplate, updatePromptTemplate } from "@/server/services/admin";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ templates: await getPromptTemplates() });
  } catch (error: any) {
    if (error.statusCode === 401) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();
    const { type, content } = body as { type: string; content: string };

    if (!type || !content) {
      return NextResponse.json({ error: "Type and content required" }, { status: 400 });
    }

    await updatePromptTemplate(admin.id, type, content);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.statusCode === 401) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
