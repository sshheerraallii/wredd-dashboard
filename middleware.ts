// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Notes:
 * - Avoid redirecting forbidden users to "/app" because "/app" auto-redirects by role
 *   and can create redirect loops.
 * - Always redirect forbidden to a "stable" page like "/app/projects".
 * - Support legacy "BD" and current "BUSINESS_DEVELOPER" roles.
 */

type Role =
  | "SUPER_ADMIN"
  | "MANAGER"
  | "BUSINESS_DEVELOPER"
  | "BD" // legacy
  | "REMOTE_WORKER"
  | "ONSITE_EMPLOYEE";

const PUBLIC_PREFIXES = [
  "/api/auth", // NextAuth endpoints
  "/login",
  "/archived",
  "/_next",
  "/favicon.ico",
  "/public",
  "/announcements", // allow banner assets
];

// Where to send logged-in users when they hit forbidden routes.
// Must NOT be "/app" to avoid role-landing redirect loops.
const FORBIDDEN_FALLBACK = "/app/projects?err=forbidden";

function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function redirectTo(req: NextRequest, path: string) {
  const url = req.nextUrl.clone();
  url.pathname = path;
  // Keep search unless caller already provided query params in path
  // (e.g. "/app/projects?err=forbidden" would be lost if set via pathname only).
  // So: if path contains "?", treat it as full path+search.
  if (path.includes("?")) {
    const [pn, qs] = path.split("?");
    url.pathname = pn || "/";
    url.search = qs ? `?${qs}` : "";
  }
  return NextResponse.redirect(url);
}

function hasRole(role: unknown): role is Role {
  return (
    role === "SUPER_ADMIN" ||
    role === "MANAGER" ||
    role === "BUSINESS_DEVELOPER" ||
    role === "BD" ||
    role === "REMOTE_WORKER" ||
    role === "ONSITE_EMPLOYEE"
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public paths: pass through
  if (isPublicPath(pathname)) return NextResponse.next();

  // Auth
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return redirectTo(req, "/login");

  // Optional archived hard-block at middleware layer (faster than layout)
  // If you prefer DB-aware behavior only, keep this off.
  // If you enable it, make sure token is refreshed with archivedAt.
  if ((token as any)?.archivedAt) {
    return redirectTo(req, "/archived");
  }

  const rawRole = (token as any)?.role;
  const role: Role | undefined = hasRole(rawRole) ? rawRole : undefined;

  // If role missing/unknown, do not loop through "/app" role-router
  if (!role) return redirectTo(req, FORBIDDEN_FALLBACK);

  // Role gating: /app/* only
  if (pathname.startsWith("/app/admin")) {
    if (role !== "SUPER_ADMIN" && role !== "MANAGER") {
      return redirectTo(req, FORBIDDEN_FALLBACK);
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/app/bd")) {
    if (
      role !== "SUPER_ADMIN" &&
      role !== "MANAGER" &&
      role !== "BUSINESS_DEVELOPER" &&
      role !== "BD" // legacy
    ) {
      return redirectTo(req, FORBIDDEN_FALLBACK);
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/app/worker")) {
    if (role !== "REMOTE_WORKER" && role !== "ONSITE_EMPLOYEE") {
      return redirectTo(req, FORBIDDEN_FALLBACK);
    }
    return NextResponse.next();
  }

  // Everything else: allow (other pages may do their own auth)
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};