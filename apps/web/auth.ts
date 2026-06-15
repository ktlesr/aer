import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ensureWorkspace } from "@/lib/auth/workspace";

// Google is optional in local dev — only enabled when its credentials are present, so the app
// boots with email/password alone. In prod, set AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET.
const providers: NextAuthConfig["providers"] = [
  Credentials({
    credentials: { email: {}, password: {} },
    authorize: async (raw) => {
      const email = typeof raw?.email === "string" ? raw.email.trim().toLowerCase() : "";
      const password = typeof raw?.password === "string" ? raw.password : "";
      if (!email || !password) return null;

      const user = await prisma.user.findUnique({ where: { email } });
      // Google-only users have no passwordHash — reject credential login for them.
      if (!user?.passwordHash) return null;

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return null;
      return { id: user.id, email: user.email, name: user.name };
    },
  }),
];

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.unshift(Google);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // JWT sessions are required by the Credentials provider; the adapter still persists
  // users/accounts (for Google linking) — only the session lives in a cookie, not the DB.
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  providers,
  callbacks: {
    jwt: ({ token, user }) => {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session: ({ session, token }) => {
      if (token.uid && session.user) session.user.id = token.uid as string;
      return session;
    },
  },
  events: {
    // OAuth (Google) users are created by the adapter — provision their workspace on first sign-in.
    // Credentials users are provisioned in signUpWithPassword instead.
    createUser: async ({ user }) => {
      if (user.id) await ensureWorkspace(user.id, user.name ?? user.email);
    },
  },
});
