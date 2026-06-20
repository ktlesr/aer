import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";

/** Chain verification verdict, derived server-side via the shared verifyChain. */
export type ChainStatus =
  | { kind: "verified"; count: number }
  | { kind: "broken"; brokenSeq: number }
  | { kind: "pending" }
  | { kind: "legacy" };

const COPY: Record<
  ChainStatus["kind"],
  { label: (s: ChainStatus) => string; note: string; broken: boolean }
> = {
  verified: {
    label: (s) => (s.kind === "verified" ? `Chain verified · ${s.count} events` : ""),
    note: "Every event links to the previous one; the sealed head matches.",
    broken: false,
  },
  broken: {
    label: (s) => (s.kind === "broken" ? `Chain BROKEN at seq ${s.brokenSeq}` : ""),
    note: "A stored event or finding was altered after the fact. This run is not trustworthy.",
    broken: true,
  },
  pending: {
    label: () => "Sealing pending",
    note: "The run is still in progress; the chain head is sealed on completion.",
    broken: false,
  },
  legacy: {
    label: () => "Legacy · unchained",
    note: "This run predates the evidence chain, so it carries no per-event hashes.",
    broken: false,
  },
};

/** Tamper-evident evidence digest + chain verdict, presented as a wax-seal-style stamp. */
export function HashSeal({ digest, chain }: { digest: string; chain: ChainStatus }) {
  const hex = digest.replace(/^sha256:/, "");
  const copy = COPY[chain.kind];
  const accent = copy.broken ? "var(--destructive)" : "var(--seal)";
  const Icon = copy.broken
    ? ShieldAlert
    : chain.kind === "verified"
      ? ShieldCheck
      : ShieldQuestion;

  return (
    <div
      className="surface relative overflow-hidden p-4"
      style={{
        borderColor: `color-mix(in oklch, ${accent} 28%, var(--border))`,
        background: `radial-gradient(120% 90% at 100% 0%, color-mix(in oklch, ${accent} 9%, var(--card)), var(--card))`,
      }}
    >
      <div className="flex items-center gap-2" style={{ color: accent }}>
        <Icon className="size-4" />
        <span className="eyebrow" style={{ color: accent }}>
          {copy.label(chain)}
        </span>
      </div>
      <p className="mt-3 break-all font-mono text-xs leading-relaxed text-foreground/85">
        <span className="text-muted-foreground">sha256:</span>
        {hex}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">{copy.note}</p>
      <div
        className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full"
        style={{ border: `1px solid color-mix(in oklch, ${accent} 16%, transparent)` }}
      />
      <div
        className="pointer-events-none absolute -right-4 -top-4 size-16 rounded-full"
        style={{ border: `1px solid color-mix(in oklch, ${accent} 12%, transparent)` }}
      />
    </div>
  );
}
