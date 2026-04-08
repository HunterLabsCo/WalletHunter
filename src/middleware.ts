import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, verifyAdminToken } from "@/lib/admin/session";

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;

  // Protected user routes
  const protectedPaths = [
    "/dashboard",
    "/settings",
    "/billing",
    "/scans",
    "/watchlist",
    "/wallet",
  ];
  const isProtected = protectedPaths.some((path) => pathname.startsWith(path));

  // Admin routes — completely separate from user auth
  const isAdminPath = pathname.startsWith("/admin");
  const isAdminLoginPage = pathname === "/admin/login";

  // Auth pages (redirect if already logged in)
  const isAuthPage = pathname === "/login" || pathname === "/register";

  if (isProtected && !isLoggedIn) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAdminPath && !isAdminLoginPage) {
    const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    const adminSession = await verifyAdminToken(token);
    if (!adminSession) {
      return NextResponse.redirect(new URL("/admin/login", req.url));
    }
  }

  if (isAdminLoginPage) {
    // If already a valid admin, skip straight to dashboard
    const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    const adminSession = await verifyAdminToken(token);
    if (adminSession) {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
  }

  if (isAuthPage && isLoggedIn) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  const response = NextResponse.next();

  // Security headers
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );

  return response;
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/settings/:path*",
    "/billing/:path*",
    "/scans/:path*",
    "/watchlist/:path*",
    "/wallet/:path*",
    "/admin/:path*",
    "/login",
    "/register",
  ],
};
