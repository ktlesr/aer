import { AppHeader } from "@/components/app-header";

export default function RunsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-10 flex min-h-full flex-col">
      <AppHeader active="runs" />

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
