import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { RiskBadge } from "@/components/risk-badge";
import { Timeline, type TimelineEvent } from "@/components/timeline";
import { RawJsonViewer } from "@/components/raw-json-viewer";
import { HashSeal } from "@/components/hash-seal";
import { getRunDetail } from "@/lib/dashboard/queries";
import { evidenceDigest } from "@/lib/audit/packet";
import { formatCost, formatDateTime, formatDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4">
      <div className="eyebrow">{label}</div>
      <div className="mt-2 font-mono tabular-nums">{children}</div>
    </div>
  );
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = await getRunDetail(id);
  if (!run) notFound();

  const digest = evidenceDigest(run, run.events, run.findings);

  const findingCountByEvent = run.findings.reduce<Record<string, number>>((acc, f) => {
    if (f.eventId) acc[f.eventId] = (acc[f.eventId] ?? 0) + 1;
    return acc;
  }, {});

  const events: TimelineEvent[] = run.events.map((e) => ({
    id: e.id,
    seq: e.seq,
    type: e.type,
    title: e.title,
    occurredAt: e.occurredAt.toISOString(),
    inputRedacted: e.inputRedacted ?? null,
    outputRedacted: e.outputRedacted ?? null,
    riskLevel: e.riskLevel,
    costMicroUsd: e.costMicroUsd,
    redactionCount: findingCountByEvent[e.id] ?? 0,
  }));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link
        href="/runs"
        className="inline-flex items-center gap-1.5 font-mono text-[0.68rem] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> All runs
      </Link>

      <div className="animate-rise mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Agent Run</p>
          <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">{run.agentName}</h1>
          <p className="mt-2 font-mono text-xs text-muted-foreground">{run.id}</p>
        </div>
        <a
          href={`/runs/${run.id}/download`}
          download
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
        >
          <Download className="size-4" /> Download audit packet
        </a>
      </div>

      {/* ruled stat strip */}
      <div
        className="animate-rise mt-6 grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-xl border border-border sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0"
        style={{ animationDelay: "70ms" }}
      >
        <Stat label="Status">
          <StatusBadge status={run.status} />
        </Stat>
        <Stat label="Risk">
          <RiskBadge risk={run.riskLevel} />
        </Stat>
        <Stat label="Duration">{formatDuration(run.durationMs)}</Stat>
        <Stat label="Cost">{formatCost(run.costMicroUsd)}</Stat>
        <Stat label="Events">{run.eventCount}</Stat>
        <Stat label="Redactions">
          <span className={run.redactionCount > 0 ? "text-seal" : undefined}>
            {run.redactionCount}
          </span>
        </Stat>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_21rem]">
        <section>
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="font-serif text-xl font-semibold">Timeline</h2>
            <span className="eyebrow">{run.events.length} events</span>
          </div>
          <Timeline events={events} />
        </section>

        <aside className="space-y-8">
          <section>
            <h2 className="mb-3 font-serif text-xl font-semibold">Evidence seal</h2>
            <HashSeal digest={digest} />
          </section>

          <section>
            <h2 className="mb-3 font-serif text-xl font-semibold">
              Redaction findings
              <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">
                {run.findings.length}
              </span>
            </h2>
            {run.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No findings.</p>
            ) : (
              <ul className="overflow-hidden rounded-lg border border-border">
                {run.findings.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-start justify-between gap-3 border-b border-border/70 px-3 py-2.5 last:border-0"
                  >
                    <div>
                      <div className="text-sm font-medium capitalize">
                        {f.findingType.replace(/_/g, " ")}
                      </div>
                      <div className="mt-0.5 font-mono text-[0.68rem] text-muted-foreground">
                        {f.fieldPath}
                      </div>
                    </div>
                    <span className="eyebrow shrink-0 pt-0.5">{f.severity}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Only a hash of each detected value is stored — never the raw value.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-serif text-xl font-semibold">Raw record</h2>
            <RawJsonViewer
              data={{
                run: {
                  id: run.id,
                  agentName: run.agentName,
                  status: run.status,
                  riskLevel: run.riskLevel,
                  startedAt: formatDateTime(run.startedAt),
                  endedAt: run.endedAt ? formatDateTime(run.endedAt) : null,
                },
                events,
                findings: run.findings.map((f) => ({
                  findingType: f.findingType,
                  severity: f.severity,
                  fieldPath: f.fieldPath,
                  originalHash: `sha256:${f.originalHash}`,
                })),
              }}
            />
          </section>
        </aside>
      </div>
    </main>
  );
}
