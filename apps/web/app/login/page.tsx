import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — Agent Evidence Recorder" };

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
