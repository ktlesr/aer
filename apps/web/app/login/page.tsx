import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthForm } from "@/components/auth-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — Agent Evidence Recorder" };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/runs");

  const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <AuthForm mode="login" googleEnabled={googleEnabled} />
    </main>
  );
}
