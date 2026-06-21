import { auth } from "@/auth";
import { NextResponse } from "next/server";

export const proxy = auth((request) => {
  const { pathname } = request.nextUrl;
  const isLoggedIn = Boolean(request.auth?.user);

  // 登入頁永遠放行，避免無限轉址
  if (pathname === "/login") return NextResponse.next();

  if (!isLoggedIn) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
});

export const config = {
  // 其餘路由（含其他 /api/*）皆納入登入檢查
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
