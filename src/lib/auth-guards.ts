import { auth } from "./auth";
import { headers } from "next/headers";
import type { UserRole } from "@/types/book";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRole;
}

export async function getSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  return session;
}

export async function requireAuth(): Promise<AuthenticatedUser> {
  const session = await getSession();
  if (!session?.user) {
    throw new AuthError("Authentication required", 401);
  }
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
    role: (session.user as any).role as UserRole,
  };
}

export async function requireAdmin(): Promise<AuthenticatedUser> {
  const user = await requireAuth();
  if (user.role !== "admin") {
    throw new AuthError("Admin access required", 403);
  }
  return user;
}

export class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = "AuthError";
  }
}
