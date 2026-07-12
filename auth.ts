import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email || allowedEmails.length === 0) return false;
  return allowedEmails.includes(email.trim().toLowerCase());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers: [Google],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    signIn({ profile }) {
      if (!profile?.email || profile.email_verified !== true) return false;
      return isAllowedEmail(profile.email);
    },
    authorized({ auth, request }) {
      const isAuthorized = Boolean(
        auth?.user && isAllowedEmail(auth.user.email),
      );
      const { pathname } = request.nextUrl;

      if (pathname === "/login") return true;

      return isAuthorized;
    },
  },
});
