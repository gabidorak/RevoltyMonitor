import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/api/v1/ingest", "/api/v1/auth"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/"
  ) {
    return NextResponse.next();
  }

  // Protect /api/* routes (except public ones above)
  if (pathname.startsWith("/api/")) {
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    const session = await verifySessionToken(token);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Invalid or expired token" },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  // Protect all other pages (admin panel)
  const sessionCookie = request.cookies.get("revolty_session")?.value;
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const session = await verifySessionToken(sessionCookie);
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
