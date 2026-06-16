"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { signUpWithPassword } from "@/lib/auth/signup";
import { requireDashboardAccess } from "@/lib/dashboard/access";
import { createApiKey, revokeApiKey } from "@/lib/auth/api-keys";
import { rateLimit } from "@/lib/rate-limit";

export interface FormState {
  error?: string;
}

/** Best-effort client IP for auth rate limiting (Dokploy/Traefik set x-forwarded-for). */
async function ipKey(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    "unknown");
}

/** Email/password sign-in. signIn throws a redirect on success — only AuthError is caught. */
export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // Brute-force guard: 10 attempts / 5 min / IP.
  if (!rateLimit(`login:${await ipKey()}`, 10, 300_000).ok) {
    return { error: "Too many attempts. Please try again in a few minutes." };
  }
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/runs",
    });
  } catch (error) {
    if (error instanceof AuthError) return { error: "Invalid email or password." };
    throw error; // NEXT_REDIRECT (success) and other errors must propagate.
  }
  return {};
}

/** Create an account, then sign the user in (the signIn redirect ends the request). */
export async function signupAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // Anti-abuse: 5 sign-ups / hour / IP.
  if (!rateLimit(`signup:${await ipKey()}`, 5, 3_600_000).ok) {
    return { error: "Too many sign-ups from this network. Please try again later." };
  }
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "");

  const result = await signUpWithPassword({ email, password, name });
  if (!result.ok) return { error: result.error };

  await signIn("credentials", { email, password, redirectTo: "/runs" });
  return {};
}

/** Begin the Google OAuth flow (redirects to Google). */
export async function googleAction(): Promise<void> {
  await signIn("google", { redirectTo: "/runs" });
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

export interface CreateKeyState {
  apiKey?: string;
  error?: string;
}

/** Mint a key for the logged-in user's workspace; returns the plaintext ONCE for display. */
export async function createKeyAction(
  _prev: CreateKeyState,
  formData: FormData,
): Promise<CreateKeyState> {
  const scope = await requireDashboardAccess();
  const { apiKey } = await createApiKey(scope, String(formData.get("name") ?? ""));
  revalidatePath("/keys");
  return { apiKey };
}

export async function revokeKeyAction(formData: FormData): Promise<void> {
  const scope = await requireDashboardAccess();
  await revokeApiKey(scope, String(formData.get("id") ?? ""));
  revalidatePath("/keys");
}
