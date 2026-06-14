import { cn } from "@/lib/utils";

const RISK_DOT: Record<string, string> = {
  low: "bg-slate-400",
  medium: "bg-amber-500",
  high: "bg-orange-500",
  critical: "bg-red-500",
};

export function RiskBadge({ risk }: { risk: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5">
      <span className={cn("size-1.5 rounded-full", RISK_DOT[risk] ?? "bg-muted-foreground")} />
      <span className="font-mono text-[0.62rem] font-medium uppercase tracking-wider">{risk}</span>
    </span>
  );
}
