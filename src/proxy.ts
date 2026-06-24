import { createMiddleware } from '@frontman-ai/nextjs';
import { type NextRequest, NextResponse } from 'next/server';

const frontman = createMiddleware({
  host: 'api.frontman.sh',
});

// Lightweight auth check — we only validate session cookie exists.
// Full role checks happen in route handlers and server components.

const PROTECTED_ROUTES = ['/my-library', '/book'];
const ADMIN_ROUTES = ['/admin'];
const AUTH_ROUTES = ['/login'];

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Frontman dev UI + tool calls (dev-only, not auth-gated).
  if (pathname === '/frontman' || pathname.startsWith('/frontman/')) {
    const response = await frontman(request);
    if (response) return response;
    return NextResponse.next();
  }

  const isProtectedRoute = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + '/')
  );
  const isAdminRoute = ADMIN_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + '/')
  );
  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + '/')
  );

  const sessionCookie = request.cookies.get('better-auth.session_token');

  if ((isProtectedRoute || isAdminRoute) && !sessionCookie) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (isAuthRoute && sessionCookie) {
    return NextResponse.redirect(new URL('/my-library', request.url));
  }

  if (pathname === '/' && sessionCookie) {
    return NextResponse.redirect(new URL('/my-library', request.url));
  }

  return NextResponse.next();
}

export const config = {
  runtime: 'nodejs',
  matcher: [
    // Auth-gated routes (was src/middleware.ts)
    '/',
    '/my-library/:path*',
    '/book/:path*',
    '/admin/:path*',
    '/login',
    // Frontman dev UI
    '/frontman',
    '/frontman/:path*',
    '/:path*/frontman',
    '/:path*/frontman/',
  ],
};
