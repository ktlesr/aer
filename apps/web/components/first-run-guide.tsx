import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { SdkUsage } from "@/components/sdk-usage";

function Step({
  n,
  title,
  done = false,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-medium tabular-nums"
        style={{
          color: "var(--seal)",
          borderColor: "color-mix(in oklch, var(--seal) 40%, transparent)",
          background: "color-mix(in oklch, var(--seal) 8%, transparent)",
        }}
        aria-hidden
      >
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-base font-medium leading-7">{title}</h3>
        <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

/** Activation guide shown on an empty /runs: get the user to their first recorded run. */
export function FirstRunGuide({ hasKey, baseUrl }: { hasKey: boolean; baseUrl: string }) {
  return (
    <ol className="animate-rise space-y-8" style={{ animationDelay: "90ms" }}>
        <Step n={1} title="Create an API key" done={hasKey}>
          {hasKey ? (
            <p>
              You already have a key.{" "}
              <Link
                href="/keys"
                className="rounded-sm text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Manage keys →
              </Link>
            </p>
          ) : (
            <>
              <p>Authenticate the collector SDK with a key bound to your workspace.</p>
              <Link
                href="/keys"
                className="group inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-[var(--shadow-soft)] outline-none transition-all hover:-translate-y-px hover:opacity-95 focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-0"
              >
                Create an API key
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </>
          )}
        </Step>

        <Step n={2} title="Connect the collector SDK">
          <p>Install it, set two environment variables, then drop a few calls into your agent.</p>
          <SdkUsage baseUrl={baseUrl} showHeading={false} />
        </Step>

        <Step n={3} title="Watch your first run land here">
          <p>
            Run your agent, then refresh this page. Your first run appears as a chronological,
            redacted, hash-anchored timeline — visible only to your workspace.
          </p>
        </Step>
    </ol>
  );
}
