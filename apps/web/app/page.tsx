import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { SealMark } from "@/components/brand";
import { HomeDashboard } from "@/components/home-dashboard";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.37.5 0 5.78 0 12.292c0 5.211 3.438 9.63 8.205 11.188.6.111.82-.254.82-.567 0-.28-.01-1.022-.015-2.005-3.338.711-4.042-1.582-4.042-1.582-.546-1.361-1.335-1.725-1.335-1.725-1.087-.731.084-.716.084-.716 1.205.082 1.838 1.215 1.838 1.215 1.07 1.803 2.809 1.282 3.495.981.108-.763.417-1.282.76-1.577-2.665-.295-5.466-1.309-5.466-5.827 0-1.287.465-2.339 1.235-3.164-.135-.298-.54-1.497.105-3.121 0 0 1.005-.316 3.3 1.209.96-.262 1.98-.392 3-.398 1.02.006 2.04.136 3 .398 2.28-1.525 3.285-1.209 3.285-1.209.645 1.624.24 2.823.12 3.121.765.825 1.23 1.877 1.23 3.164 0 4.53-2.805 5.527-5.475 5.817.42.354.81 1.077.81 2.171 0 1.567-.015 2.83-.015 3.214 0 .315.21.683.825.566C20.565 21.917 24 17.495 24 12.292 24 5.78 18.627.5 12 .5z" />
    </svg>
  );
}

export const metadata = {
  title: "Agent Evidence Recorder — audit-ready evidence for AI agent runs",
  description:
    "Turn every AI agent action — model calls, tool calls, approvals, redactions — into a chronological, hash-anchored evidence packet. Provable to an auditor, with no raw sensitive data stored.",
};

const PILLARS = [
  {
    title: "Provable",
    body: "A chronological timeline of every model call, tool call, approval and error.",
  },
  {
    title: "Redacted by default",
    body: "Sensitive values are never stored in the clear — only hashes and findings.",
  },
  {
    title: "Portable",
    body: "One JSON audit packet, anchored by a sha256 seal, reviewable outside the system.",
  },
];

export default async function Home() {
  const session = await auth();
  if (session?.user?.id) return <HomeDashboard />;

  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-2.5">
          <SealMark className="size-7" />
          <span className="font-display text-[0.98rem] font-semibold tracking-[-0.01em]">
            Agent Evidence Recorder
          </span>
        </div>
        <a
          href="https://github.com/ktlesr/aer"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub repository"
          className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground outline-none transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <GithubMark />
        </a>
      </header>

      <section className="animate-rise flex flex-1 flex-col justify-center py-16">
        <span className="eyebrow">Audit-ready evidence layer · v1</span>
        <h1 className="mt-4 text-balance font-display text-[clamp(2rem,6vw,3.6rem)] font-semibold leading-[1.05] tracking-[-0.03em]">
          Prove what your AI agents did — without storing what they saw.
        </h1>
        <p className="mt-5 max-w-xl text-pretty leading-relaxed text-muted-foreground">
          Agent Evidence Recorder turns every critical action an agent takes — model calls, tool
          calls, human approvals, redactions and errors — into a chronological, hash-anchored
          evidence packet a compliance, legal or security reviewer can trust.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Link
            href="/signup"
            className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-[var(--shadow-soft)] outline-none transition-all hover:-translate-y-px hover:opacity-95 focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-0 sm:w-auto"
          >
            Get started — it&apos;s free
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/login"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground outline-none transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-auto"
          >
            Sign in
          </Link>
          <a
            href="https://www.npmjs.com/package/@ktlsr/collector-js"
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg border border-border px-4 py-2.5 font-mono text-[0.78rem] text-muted-foreground outline-none transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-auto"
          >
            <span className="truncate">npm i @ktlsr/collector-js</span>
          </a>
        </div>

        <dl className="mt-14 grid gap-x-8 gap-y-7 border-t border-border/60 pt-8 sm:grid-cols-3">
          {PILLARS.map((p) => (
            <div key={p.title}>
              <dt className="flex items-center gap-2 font-display text-base font-medium">
                <ShieldCheck className="size-4" style={{ color: "var(--seal)" }} />
                {p.title}
              </dt>
              <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="flex flex-col gap-1 border-t border-border/60 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          Stored <span className="text-foreground">redacted</span> — raw sensitive values are never persisted.
        </span>
        <span className="font-mono">evidence packets are hash-anchored</span>
      </footer>
    </main>
  );
}
