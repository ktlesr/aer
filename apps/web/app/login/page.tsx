import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
export const dynamic = "force-dynamic";

// Indexable on purpose: the page holds no tenant data, and a sign-in page search engines can
// see reads as a real product. PRIVATE_PAGE stays for /runs and /keys.
export const metadata: Metadata = { title: "Sign in", alternates: { canonical: "/login" } };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/runs");

  const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  return (
    <AuthShell>
      <AuthForm mode="login" googleEnabled={googleEnabled} />
    </AuthShell>
  );
}
