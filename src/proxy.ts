import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Lightweight auth check in the proxy — we only validate session cookie exists.
// Full role checks happen in route handlers and server components.

const PROTECTED_ROUTES = ["/my-library", "/book"];
const ADMIN_ROUTES = ["/admin"];
const AUTH_ROUTES = ["/login"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if route requires authentication
  const isProtectedRoute = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
  const isAdminRoute = ADMIN_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  // Read session cookie
  const sessionCookie = request.cookies.get("better-auth.session_token");

  if ((isProtectedRoute || isAdminRoute) && !sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Authenticated users on auth routes redirect to library
  if (isAuthRoute && sessionCookie) {
    return NextResponse.redirect(new URL("/my-library", request.url));
  }

  // Authenticated users on the root landing page go straight to their home
  if (pathname === "/" && sessionCookie) {
    return NextResponse.redirect(new URL("/my-library", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/my-library/:path*",
    "/book/:path*",
    "/admin/:path*",
    "/login",
  ],
};
