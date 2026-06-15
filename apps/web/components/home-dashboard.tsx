import Link from "next/link";
import { ArrowRight, KeyRound } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { SdkUsage } from "@/components/sdk-usage";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const BASE_URL = process.env.AUTH_URL ?? "https://aer.ktlsr.com";

/** Authenticated home at `/`: welcome, quick links, and the SDK usage guide. */
export async function HomeDashboard() {
  const session = await auth();
  const org = session?.user?.id
    ? await prisma.organization.findUnique({
        where: { ownerUserId: session.user.id },
        select: { name: true },
      })
    : null;

  return (
    <div className="relative z-10 flex min-h-full flex-col">
      <AppHeader active="home" />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
        <header className="animate-rise mb-9">
          <p className="eyebrow">Workspace{org?.name ? ` · ${org.name}` : ""}</p>
          <h1 className="mt-2.5 font-display text-[2.4rem] font-semibold leading-[1.05] tracking-[-0.02em]">
            Welcome back
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Record your agent&apos;s runs and review them as audit-ready, redacted evidence packets —
            a chronological, hash-anchored timeline only you can see.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/runs"
              className="group inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-[var(--shadow-soft)] outline-none transition-all hover:-translate-y-px hover:opacity-95 focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-0"
            >
              View runs
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/keys"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground outline-none transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <KeyRound className="size-4" />
              API keys
            </Link>
          </div>
        </header>

        <div className="animate-rise border-t border-border/60 pt-8" style={{ animationDelay: "70ms" }}>
          <SdkUsage baseUrl={BASE_URL} />
        </div>
      </main>
    </div>
  );
}
