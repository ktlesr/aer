import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { RiskBadge } from "@/components/risk-badge";
import { FirstRunGuide } from "@/components/first-run-guide";
import { listRuns } from "@/lib/dashboard/queries";
import { requireDashboardAccess } from "@/lib/dashboard/access";
import { listApiKeys } from "@/lib/auth/api-keys";
import { formatCost, formatDateTime, formatDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

const BASE_URL = process.env.AUTH_URL ?? "https://aer.ktlsr.com";

export default async function RunsPage() {
  const scope = await requireDashboardAccess();
  const [runs, keys] = await Promise.all([listRuns(), listApiKeys(scope)]);

  // First-run activation: empty workspace gets a guide, not a blank table.
  if (runs.length === 0) {
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

  const withRedactions = runs.filter((r) => r.redactionCount > 0).length;
  const totalRedactions = runs.reduce((n, r) => n + r.redactionCount, 0);

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
            { label: "Runs", value: runs.length, seal: false },
            { label: "With redactions", value: withRedactions, seal: false },
            { label: "Total findings", value: totalRedactions, seal: true },
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
    </main>
  );
}
