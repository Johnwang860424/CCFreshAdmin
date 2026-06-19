import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// 允許登入的 Google 帳號（逗號分隔）。留空則任何 Google 帳號皆可登入。
const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  // 無資料庫，使用 JWT session（與 Edge/Proxy 相容）
  session: { strategy: "jwt" },
  providers: [
    // 自動讀取 AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET 環境變數
    Google,
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // 登入時的白名單檢查
    signIn({ profile }) {
      if (!profile?.email || profile.email_verified !== true) return false;
      if (allowedEmails.length === 0) return false;

      const email = profile?.email?.toLowerCase();
      return Boolean(email && allowedEmails.includes(email));
    },
    // Proxy（中介層）的樂觀檢查：只讀 cookie 內的 JWT，不查 DB
    authorized({ auth, request }) {
      const isLoggedIn = Boolean(auth?.user);
      const { pathname } = request.nextUrl;

      // 登入頁永遠放行，避免無限轉址
      if (pathname === "/login") return true;

      // 其餘路由需登入；未登入會被導向 pages.signIn (/login)
      return isLoggedIn;
    },
  },
});
