import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional shared-password gate (HTTP Basic over HTTPS). Off unless BASIC_AUTH_USER and
 * BASIC_AUTH_PASSWORD are both set. It restricts access to the site; it does NOT identify
 * individual reviewers, so review decisions remain "self-declared, unverified".
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !pass) return NextResponse.next();
  if (req.nextUrl.pathname === "/api/health") return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const [u, ...rest] = atob(header.slice(6)).split(":");
      if (safeEqual(u, user) && safeEqual(rest.join(":"), pass)) return NextResponse.next();
    } catch {
      /* malformed header */
    }
  }
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Freshroots Demand Planning", charset="UTF-8"' } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
