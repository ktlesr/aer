"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";
import { RiskBadge } from "@/components/risk-badge";
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

function EventRow({ event, index }: { event: TimelineEvent; index: number }) {
  const [open, setOpen] = useState(false);
  const redacted = event.redactionCount > 0;
  const hasPayload =
    (event.inputRedacted !== null && event.inputRedacted !== undefined) ||
    (event.outputRedacted !== null && event.outputRedacted !== undefined);

  return (
    <li className="animate-rise relative pl-10" style={{ animationDelay: `${index * 55}ms` }}>
      {/* node centered on the spine (both anchored at left-[0.6875rem]) */}
      <span
        className="absolute left-[0.6875rem] top-2 z-10 flex size-[1.15rem] -translate-x-1/2 items-center justify-center rounded-full border bg-background"
        style={{
          borderColor: redacted ? "color-mix(in oklch, var(--seal) 50%, transparent)" : "var(--border)",
          boxShadow: redacted ? "0 0 0 3px color-mix(in oklch, var(--seal) 12%, transparent)" : undefined,
        }}
      >
        <span
          className="size-2 rounded-full"
          style={{ background: redacted ? "var(--seal)" : "color-mix(in oklch, var(--foreground) 45%, transparent)" }}
        />
      </span>

      <div className="rounded-lg border border-border/70 bg-card px-4 py-3 transition-all duration-200 hover:border-border hover:shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="eyebrow text-foreground/65">
            {String(event.seq).padStart(2, "0")} · {formatEventType(event.type)}
          </span>
          {event.riskLevel ? <RiskBadge risk={event.riskLevel} /> : null}
          {redacted ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[0.6rem] font-medium uppercase tracking-wider"
              style={{
                color: "var(--seal)",
                borderColor: "color-mix(in oklch, var(--seal) 32%, transparent)",
                background: "color-mix(in oklch, var(--seal) 8%, transparent)",
              }}
            >
              <ShieldAlert className="size-3" />
              {event.redactionCount} redacted
            </span>
          ) : null}
        </div>

        <div className="mt-1.5 font-medium">{event.title}</div>

        <div className="mt-1 font-mono text-xs text-muted-foreground">
          {formatDateTime(event.occurredAt)}
          {event.costMicroUsd ? <span> · {formatCost(event.costMicroUsd)}</span> : null}
          <span className="text-muted-foreground/70">
            {" "}
            · in {summarize(event.inputRedacted)} · out {summarize(event.outputRedacted)}
          </span>
        </div>

        {hasPayload ? (
          <div className="mt-2.5">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="inline-flex items-center gap-1 rounded-sm font-mono text-[0.66rem] font-medium uppercase tracking-wider text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              {open ? "Hide" : "Show"} payloads · redacted
            </button>
            {open ? (
              <pre className="mt-2 max-h-[28rem] overflow-auto rounded-md border border-border/70 bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
                {JSON.stringify(
                  { input: event.inputRedacted ?? null, output: event.outputRedacted ?? null },
                  null,
                  2,
                )}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No events recorded.</p>;
  }
  return (
    <ol className="relative space-y-3">
      {/* continuous spine — anchored at the same x as every node */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-[0.6875rem] top-2 bottom-2 w-px -translate-x-1/2"
        style={{
          background:
            "linear-gradient(180deg, transparent, var(--border) 8%, var(--border) 92%, transparent)",
        }}
      />
      {events.map((event, i) => (
        <EventRow key={event.id} event={event} index={i} />
      ))}
    </ol>
  );
}
