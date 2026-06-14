import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { RiskBadge } from "@/components/risk-badge";
import { listRuns } from "@/lib/dashboard/queries";
import { formatCost, formatDateTime, formatDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runs = await listRuns();
  const withRedactions = runs.filter((r) => r.redactionCount > 0).length;
  const totalRedactions = runs.reduce((n, r) => n + r.redactionCount, 0);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="animate-rise mb-8">
        <p className="eyebrow">Evidence Ledger</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">Agent Runs</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Every recorded run, hash-anchored and stored redacted. Open a run to inspect its timeline,
          redaction findings, and audit packet.
        </p>
        <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-3">
          {[
            { label: "Runs", value: runs.length },
            { label: "With redactions", value: withRedactions },
            { label: "Total findings", value: totalRedactions },
          ].map((s) => (
            <div key={s.label}>
              <dt className="eyebrow">{s.label}</dt>
              <dd className="mt-1 font-mono text-2xl font-medium tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="animate-rise overflow-hidden rounded-xl border border-border" style={{ animationDelay: "80ms" }}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-4 py-3 eyebrow font-normal">Agent</th>
                <th className="px-4 py-3 eyebrow font-normal">Status</th>
                <th className="px-4 py-3 eyebrow font-normal">Risk</th>
                <th className="px-4 py-3 eyebrow font-normal">Started</th>
                <th className="px-4 py-3 eyebrow font-normal text-right">Duration</th>
                <th className="px-4 py-3 eyebrow font-normal text-right">Cost</th>
                <th className="px-4 py-3 eyebrow font-normal text-right">Events</th>
                <th className="px-4 py-3 eyebrow font-normal text-right">Redactions</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No runs yet. Run the demo agent to record one.
                  </td>
                </tr>
              ) : (
                runs.map((run) => (
                  <tr
                    key={run.id}
                    className="group border-b border-border/70 transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/runs/${run.id}`} className="inline-flex items-center gap-1.5 font-medium">
                        <span className="group-hover:underline">{run.agentName}</span>
                        <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                      <div className="mt-0.5 font-mono text-[0.68rem] text-muted-foreground">{run.id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="px-4 py-3">
                      <RiskBadge risk={run.riskLevel} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {formatDateTime(run.startedAt)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatDuration(run.durationMs)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatCost(run.costMicroUsd)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{run.eventCount}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {run.redactionCount > 0 ? (
                        <span className="text-seal">{run.redactionCount}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
