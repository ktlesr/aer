import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ensureWorkspace } from "./workspace";

export interface SignUpInput {
  email: string;
  password: string;
  name?: string;
}

export type SignUpResult =
  | { ok: true; userId: string }
  | { ok: false; error: string };

/**
 * Create an email/password user + their personal workspace. The plaintext password is hashed with
 * bcrypt and never stored or returned. Returns a typed result instead of throwing so UI actions can
 * surface a friendly message.
 */
export async function signUpWithPassword(input: SignUpInput): Promise<SignUpResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (input.password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Don't reveal whether it's a Google-only account; keep the message generic.
    return { ok: false, error: "An account with this email already exists." };
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: { email, name: input.name?.trim() || null, passwordHash },
  });

  await ensureWorkspace(user.id, input.name ?? email);
  return { ok: true, userId: user.id };
}
