import type { DefaultSession } from "next-auth";

// Expose the user id on the session and JWT (set in auth.ts callbacks).
declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
  }
}
