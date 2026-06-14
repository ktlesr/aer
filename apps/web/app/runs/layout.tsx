import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

export default function RunsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-10 flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div
          className="h-px w-full"
          style={{ background: "linear-gradient(90deg, transparent, var(--seal), transparent)" }}
        />
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/runs" className="transition-opacity hover:opacity-80">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden eyebrow sm:inline">Evidence Ledger</span>
            <span
              className="rounded-full border px-2.5 py-1 font-mono text-[0.6rem] font-medium uppercase tracking-wider"
              style={{
                color: "var(--seal)",
                borderColor: "color-mix(in oklch, var(--seal) 35%, transparent)",
                background: "color-mix(in oklch, var(--seal) 8%, transparent)",
              }}
            >
              demo
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-7 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            Stored <span className="text-foreground">redacted</span> — raw sensitive values are never
            persisted.
          </span>
          <span className="font-mono">v1 · evidence packets are hash-anchored</span>
        </div>
      </footer>
    </div>
  );
}
