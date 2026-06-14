"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RiskBadge } from "@/components/risk-badge";
import { cn } from "@/lib/utils";
import { formatCost, formatDateTime, formatEventType } from "@/lib/format";

export interface TimelineEvent {
  id: string;
  seq: number;
  type: string;
  title: string;
  occurredAt: string;
  inputRedacted: unknown;
  outputRedacted: unknown;
  riskLevel: string | null;
  costMicroUsd: number | null;
  redactionCount: number;
}

function summarize(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return `{ ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""} }`;
  }
  return String(value);
}

function EventRow({ event }: { event: TimelineEvent }) {
  const [open, setOpen] = useState(false);
  const hasPayload =
    event.inputRedacted !== null && event.inputRedacted !== undefined
      ? true
      : event.outputRedacted !== null && event.outputRedacted !== undefined;

  return (
    <li className="relative pl-8">
      {/* rail dot */}
      <span className="absolute left-2 top-1.5 size-3 -translate-x-1/2 rounded-full border-2 border-background bg-foreground/70" />
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-mono text-xs">
          {event.seq}. {formatEventType(event.type)}
        </Badge>
        <span className="font-medium">{event.title}</span>
        {event.riskLevel ? <RiskBadge risk={event.riskLevel} /> : null}
        {event.redactionCount > 0 ? (
          <Badge
            variant="outline"
            className="gap-1 border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300"
          >
            <ShieldAlert className="size-3" />
            {event.redactionCount} redacted
          </Badge>
        ) : null}
      </div>

      <div className="mt-1 text-xs text-muted-foreground">
        <span className="font-mono">{formatDateTime(event.occurredAt)}</span>
        {event.costMicroUsd ? <span> · {formatCost(event.costMicroUsd)}</span> : null}
        <span> · in {summarize(event.inputRedacted)} · out {summarize(event.outputRedacted)}</span>
      </div>

      {hasPayload ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            {open ? "Hide" : "Show"} payloads (redacted)
          </button>
          {open ? (
            <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">
              {JSON.stringify(
                { input: event.inputRedacted ?? null, output: event.outputRedacted ?? null },
                null,
                2,
              )}
            </pre>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No events recorded.</p>;
  }
  return (
    <ol className={cn("relative space-y-6 border-l pl-2")}>
      {events.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}
    </ol>
  );
}
