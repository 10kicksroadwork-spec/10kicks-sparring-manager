import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const needsAuth = path.startsWith("/dashboard") || path.startsWith("/athletes") || path.startsWith("/sessions");
  if (!needsAuth) return NextResponse.next();
  const hasSession =
    request.cookies.has("next-auth.session-token") ||
    request.cookies.has("__Secure-next-auth.session-token");
  const testCookie = process.env.NODE_ENV !== "production" && process.env.E2E_TEST_AUTH === "1" && request.cookies.has("sparring_test_user");
  if (!hasSession && !testCookie) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/athletes/:path*", "/sessions/:path*"],
};
