import Link from "next/link";
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
import { listRuns } from "@/lib/dashboard/queries";
import { formatCost, formatDateTime, formatDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runs = await listRuns();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Agent Runs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Audit-ready evidence for every agent run. Values are stored redacted.
        </p>
      </header>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Started</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Events</TableHead>
              <TableHead className="text-right">Redactions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  No runs yet. Run the demo agent to create one.
                </TableCell>
              </TableRow>
            ) : (
              runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link href={`/runs/${run.id}`} className="font-medium hover:underline">
                      {run.agentName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell>
                    <RiskBadge risk={run.riskLevel} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {formatDateTime(run.startedAt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDuration(run.durationMs)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCost(run.costMicroUsd)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{run.eventCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{run.redactionCount}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </main>
  );
}
