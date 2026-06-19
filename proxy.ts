import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Next.js 16：middleware 改名為 proxy。
// 用函式包裝 auth，統一處理頁面與 API：只讀 cookie JWT 的樂觀檢查。
export const proxy = auth((request) => {
  const { pathname } = request.nextUrl;
  const isLoggedIn = Boolean(request.auth?.user);

  // 登入頁永遠放行，避免無限轉址
  if (pathname === "/login") return NextResponse.next();

  if (!isLoggedIn) {
    // API 回 401 JSON；一般頁面導向登入頁
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
});

export const config = {
  // 排除 NextAuth 的 /api/auth、靜態資源與 favicon；
  // 其餘路由（含其他 /api/*）皆納入登入檢查
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
