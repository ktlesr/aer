import Link from "next/link";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { RiskBadge } from "@/components/risk-badge";
import { FirstRunGuide } from "@/components/first-run-guide";
import { listRuns, getRunStats } from "@/lib/dashboard/queries";
import { requireDashboardAccess } from "@/lib/dashboard/access";
import { listApiKeys } from "@/lib/auth/api-keys";
import { formatCost, formatDateTime, formatDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

const BASE_URL = process.env.AUTH_URL ?? "https://aer.ktlsr.com";

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const scope = await requireDashboardAccess();
  const requestedPage = Math.max(1, parseInt((await searchParams).page ?? "1", 10) || 1);
  const [{ runs, page, totalPages }, stats, keys] = await Promise.all([
    listRuns(scope, requestedPage),
    getRunStats(scope),
    listApiKeys(scope),
  ]);

  // First-run activation: empty workspace gets a guide, not a blank table.
  if (stats.total === 0) {
    const hasKey = keys.some((k) => k.revokedAt === null);
    return (
      <main className="mx-auto max-w-3xl px-6 py-14">
        <header className="animate-rise mb-9">
          <p className="eyebrow">Evidence Ledger</p>
          <h1 className="mt-2.5 font-display text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.02em]">
            Record your first run
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Your agent runs will appear here — each a chronological, redacted, hash-anchored evidence
            packet. Three steps to your first one.
          </p>
        </header>
        <FirstRunGuide hasKey={hasKey} baseUrl={BASE_URL} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-14">
      <header className="animate-rise mb-9">
        <p className="eyebrow">Evidence Ledger</p>
        <h1 className="mt-2.5 font-display text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.02em]">
          Agent Runs
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Every recorded run, hash-anchored and stored redacted. Open a run to inspect its timeline,
          redaction findings, and downloadable audit packet.
        </p>
        <dl className="mt-6 flex flex-wrap items-baseline gap-x-7 gap-y-2.5">
          {[
            { label: "Runs", value: stats.total, seal: false },
            { label: "With redactions", value: stats.withRedactions, seal: false },
            { label: "Total findings", value: stats.totalRedactions, seal: true },
          ].map((s) => (
            <div key={s.label} className="flex items-baseline gap-2">
              <dd
                className="font-mono text-base font-medium tabular-nums"
                style={s.seal && s.value > 0 ? { color: "var(--seal)" } : undefined}
              >
                {s.value}
              </dd>
              <dt className="eyebrow">{s.label}</dt>
            </div>
          ))}
        </dl>
      </header>

      <div className="animate-rise surface overflow-hidden" style={{ animationDelay: "90ms" }}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-5 py-3.5 eyebrow font-normal">Agent</th>
                <th className="px-4 py-3.5 eyebrow font-normal">Status</th>
                <th className="px-4 py-3.5 eyebrow font-normal">Risk</th>
                <th className="px-4 py-3.5 eyebrow font-normal">Started</th>
                <th className="px-4 py-3.5 eyebrow font-normal text-right">Duration</th>
                <th className="px-4 py-3.5 eyebrow font-normal text-right">Cost</th>
                <th className="px-4 py-3.5 eyebrow font-normal text-right">Events</th>
                <th className="px-5 py-3.5 eyebrow font-normal text-right">Redactions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                  <tr
                    key={run.id}
                    className="group border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/runs/${run.id}`}
                        className="inline-flex items-center gap-1.5 rounded-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <span className="decoration-1 underline-offset-4 group-hover:underline group-focus-visible:underline">
                          {run.agentName}
                        </span>
                        <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                      </Link>
                      <div className="mt-0.5 font-mono text-[0.66rem] text-muted-foreground">{run.id}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="px-4 py-3.5">
                      <RiskBadge risk={run.riskLevel} />
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">
                      {formatDateTime(run.startedAt)}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                      {formatDuration(run.durationMs)}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                      {formatCost(run.costMicroUsd)}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono tabular-nums">{run.eventCount}</td>
                    <td className="px-5 py-3.5 text-right font-mono tabular-nums">
                      {run.redactionCount > 0 ? (
                        <span style={{ color: "var(--seal)" }}>{run.redactionCount}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 ? (
        <nav className="mt-6 flex items-center justify-between" aria-label="Pagination">
          <PagerLink page={page - 1} disabled={page <= 1} dir="prev" />
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            Page {page} of {totalPages}
          </span>
          <PagerLink page={page + 1} disabled={page >= totalPages} dir="next" />
        </nav>
      ) : null}
    </main>
  );
}

function PagerLink({
  page,
  disabled,
  dir,
}: {
  page: number;
  disabled: boolean;
  dir: "prev" | "next";
}) {
  const label = dir === "prev" ? "Previous" : "Next";
  const icon = dir === "prev" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />;
  const cls =
    "inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors";

  if (disabled) {
    return (
      <span className={`${cls} cursor-not-allowed text-muted-foreground/50`} aria-disabled>
        {dir === "prev" ? icon : null}
        {label}
        {dir === "next" ? icon : null}
      </span>
    );
  }
  return (
    <Link
      href={`/runs?page=${page}`}
      className={`${cls} text-muted-foreground outline-none hover:border-foreground/30 hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`}
    >
      {dir === "prev" ? icon : null}
      {label}
      {dir === "next" ? icon : null}
    </Link>
  );
}
