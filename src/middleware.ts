import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;

  // Protected routes
  const protectedPaths = ["/dashboard", "/settings", "/billing", "/scans"];
  const isProtected = protectedPaths.some((path) => pathname.startsWith(path));

  // Admin routes
  const isAdminPath = pathname.startsWith("/admin");

  // Auth pages (redirect if already logged in)
  const isAuthPage = pathname === "/login" || pathname === "/register";

  if (isProtected && !isLoggedIn) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAdminPath && !isLoggedIn) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (isAuthPage && isLoggedIn) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/settings/:path*",
    "/billing/:path*",
    "/scans/:path*",
    "/admin/:path*",
    "/login",
    "/register",
  ],
};
