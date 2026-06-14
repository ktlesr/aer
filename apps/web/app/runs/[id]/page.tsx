import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { RiskBadge } from "@/components/risk-badge";
import { Timeline, type TimelineEvent } from "@/components/timeline";
import { RawJsonViewer } from "@/components/raw-json-viewer";
import { getRunDetail } from "@/lib/dashboard/queries";
import { formatCost, formatDateTime, formatDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{children}</div>
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
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link
        href="/runs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All runs
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{run.agentName}</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{run.id}</p>
        </div>
        <Button asChild>
          <a href={`/runs/${run.id}/download`} download>
            <Download className="size-4" /> Download JSON audit packet
          </a>
        </Button>
      </div>

      <Card className="mt-6">
        <CardContent className="grid grid-cols-2 gap-6 py-6 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Status">
            <StatusBadge status={run.status} />
          </Stat>
          <Stat label="Risk">
            <RiskBadge risk={run.riskLevel} />
          </Stat>
          <Stat label="Duration">{formatDuration(run.durationMs)}</Stat>
          <Stat label="Cost">{formatCost(run.costMicroUsd)}</Stat>
          <Stat label="Events">{run.eventCount}</Stat>
          <Stat label="Redactions">{run.redactionCount}</Stat>
        </CardContent>
      </Card>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section>
          <h2 className="mb-4 text-lg font-semibold">Timeline</h2>
          <Timeline events={events} />
        </section>

        <aside className="space-y-8">
          <section>
            <h2 className="mb-3 text-lg font-semibold">Redaction findings</h2>
            {run.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No findings.</p>
            ) : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Field</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {run.findings.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="capitalize">{f.findingType.replace(/_/g, " ")}</TableCell>
                        <TableCell className="capitalize">{f.severity}</TableCell>
                        <TableCell className="font-mono text-xs">{f.fieldPath}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Only a hash of each detected value is stored — never the raw value.
            </p>
          </section>

          <Separator />

          <section>
            <h2 className="mb-3 text-lg font-semibold">Raw record</h2>
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
