import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
export const dynamic = "force-dynamic";

// Indexable on purpose — see the note in app/login/page.tsx.
export const metadata: Metadata = {
  title: "Create account",
  alternates: { canonical: "/signup" },
};

export default async function SignupPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/runs");

  const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  return (
    <AuthShell>
      <AuthForm mode="signup" googleEnabled={googleEnabled} />
    </AuthShell>
  );
}
