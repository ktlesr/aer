import Link from "next/link";
import { GENERATION_FIELDS, type RunLinks, type SourcedView } from "@/lib/audit/sourced";

// Sourced-assistant evidence (Stage 3). Labels say exactly what each list is: retrieved candidates
// are never shown as support, a score is a retriever's number (not a probability), a claim link
// names who asserted it, and anything not sent reads "not recorded".

type Source = NonNullable<SourcedView["citedSources"]>[number];

const ORIGIN_LABEL: Record<string, string> = {
  user_stated: "stated by user",
  previous_turn: "from previous turn",
  retrieved: "from a source",
  inferred: "inferred — not confirmed",
  system: "system",
};

function NotRecorded() {
  return <span className="font-mono text-xs text-muted-foreground">not recorded</span>;
}

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border/60 px-4 py-3 first:border-0">
      <div className="eyebrow">{title}</div>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
      <div className="mt-2 text-sm">{children}</div>
    </div>
  );
}

function SourceList({ sources }: { sources?: Source[] }) {
  if (!sources || sources.length === 0) return <NotRecorded />;
  return (
    <ul className="space-y-1.5">
      {sources.map((s, i) => (
        <li key={`${s.id}-${i}`} className="font-mono text-xs">
          <span className="text-foreground">{s.id}</span>
          {s.version ? <span className="text-muted-foreground"> @ {s.version}</span> : null}
          {s.title ? <span className="font-sans text-muted-foreground"> — {s.title}</span> : null}
          <div className="text-[0.66rem] text-muted-foreground">
            {s.contentHash ? `${s.contentHash.slice(0, 19)}… over ${s.hashScope}` : "no content hash"}
            {s.archiveRef ? ` · archive ${s.archiveRef}` : " · no archive ref"}
            {s.score !== undefined ? ` · score ${s.score} (${s.scoreMethod})` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SourcedEvidence({ seq, sourced }: { seq: number; sourced: SourcedView }) {
  const g = sourced.generation ?? {};
  return (
    <div className="surface overflow-hidden">
      <div className="flex items-baseline justify-between px-4 pt-3">
        <span className="eyebrow text-foreground/65">Event {String(seq).padStart(2, "0")}</span>
        <span className="font-mono text-[0.66rem] text-muted-foreground">sourced_assistant v1</span>
      </div>

      <Block title="Context used">
        {sourced.context?.used?.length ? (
          <ul className="space-y-1">
            {sourced.context.used.map((c, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className="font-mono text-xs text-muted-foreground">{c.key}</span>
                <span>{String(c.value)}</span>
                <span className="text-xs text-muted-foreground">
                  · {ORIGIN_LABEL[c.origin] ?? c.origin}
                  {c.fromTurnRef ? ` (${c.fromTurnRef})` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <NotRecorded />
        )}
        {sourced.context?.missing?.length ? (
          <p className="mt-2 font-mono text-xs text-amber-500">
            missing_context: {sourced.context.missing.join(", ")}
          </p>
        ) : null}
      </Block>

      <Block title="Cited as support" note="Sources the answer presents as its basis.">
        <SourceList sources={sourced.citedSources} />
      </Block>

      <Block
        title="Retrieved candidates"
        note="What retrieval returned. Not evidence that the answer relied on them; scores are retriever-specific, not probabilities."
      >
        <SourceList sources={sourced.retrievedSources} />
      </Block>

      <Block title="Claim → source">
        {sourced.claimSourceLinks?.length ? (
          <ul className="space-y-1.5">
            {sourced.claimSourceLinks.map((l, i) => (
              <li key={i}>
                <span>{l.claim}</span>
                <div className="font-mono text-[0.66rem] text-muted-foreground">
                  → {l.sourceIds.join(", ")} ·{" "}
                  {l.basis === "assessed" && sourced.assessment
                    ? `assessed by ${sourced.assessment.method} ${sourced.assessment.version}: ${sourced.assessment.result}`
                    : "declared by the model/app, not independently checked"}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <NotRecorded />
        )}
      </Block>

      <Block title="Generation">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
          {GENERATION_FIELDS.map((k) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{g[k] ?? <NotRecorded />}</dd>
            </div>
          ))}
        </dl>
      </Block>

      <Block title="Timing" note="Client clock as reported by the app; AER's own receive time is the event time in the timeline.">
        <div className="font-mono text-xs">
          {sourced.timing?.clientStartedAt ?? "start not recorded"} → {sourced.timing?.clientEndedAt ?? "end not recorded"}
        </div>
      </Block>
    </div>
  );
}

export function RunLineage({ links }: { links: RunLinks }) {
  if (!links.conversationRef && !links.turnRef && !links.parentRun) return null;
  const p = links.parentRun;
  return (
    <dl className="surface grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 px-3.5 py-3 text-sm">
      <dt className="eyebrow pt-0.5">Conversation</dt>
      <dd className="font-mono text-xs">{links.conversationRef ?? "not recorded"}</dd>
      <dt className="eyebrow pt-0.5">Turn</dt>
      <dd className="font-mono text-xs">{links.turnRef ?? "not recorded"}</dd>
      <dt className="eyebrow pt-0.5">Previous step</dt>
      <dd className="font-mono text-xs">
        {!p ? (
          "none recorded"
        ) : p.status === "linked" ? (
          <Link href={`/runs/${p.id}`} className="underline decoration-border underline-offset-2 hover:text-foreground">
            {p.agentName} · {p.id}
          </Link>
        ) : (
          <span>
            missing_context · {p.id}
            <span className="block font-sans text-muted-foreground">
              No such run in this workspace (never recorded, pruned, or not yours).
            </span>
          </span>
        )}
      </dd>
    </dl>
  );
}
