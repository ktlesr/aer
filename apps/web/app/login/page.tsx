import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthForm } from "@/components/auth-form";
import { SdkUsage } from "@/components/sdk-usage";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — Agent Evidence Recorder" };

const BASE_URL = process.env.AUTH_URL ?? "https://aer.ktlsr.com";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/runs");

  const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-10 px-6 py-16">
      <div className="flex justify-center">
        <AuthForm mode="login" googleEnabled={googleEnabled} />
      </div>
      <div className="border-t border-border/60 pt-8">
        <SdkUsage baseUrl={BASE_URL} />
      </div>
    </main>
  );
}
