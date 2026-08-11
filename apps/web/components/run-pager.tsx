import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { RunNeighbor } from "@/lib/dashboard/queries";

const BASE =
  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[0.66rem] font-medium uppercase tracking-wider outline-none transition-colors";

function Step({ run, dir }: { run: RunNeighbor | null; dir: "prev" | "next" }) {
  const label = dir === "prev" ? "Previous" : "Next";
  const icon = dir === "prev" ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />;

  // No neighbour at this end of the ledger: keep the control in place, visibly inert.
  if (!run) {
    return (
      <span
        aria-disabled
        className={`${BASE} cursor-not-allowed border-border/60 text-muted-foreground/50`}
      >
        {dir === "prev" ? icon : null}
        {label}
        {dir === "next" ? icon : null}
      </span>
    );
  }

  return (
    <Link
      href={`/runs/${run.id}`}
      title={run.agentName}
      aria-label={`${label} run: ${run.agentName}`}
      className={`${BASE} border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`}
    >
      {dir === "prev" ? icon : null}
      {label}
      {dir === "next" ? icon : null}
    </Link>
  );
}

/**
 * Step through the ledger from a run's detail page. "Previous" is the row above in the runs list
 * (the newer run), "Next" the row below (the older one) — the same order the list itself uses.
 */
export function RunPager({
  newer,
  older,
}: {
  newer: RunNeighbor | null;
  older: RunNeighbor | null;
}) {
  if (!newer && !older) return null;

  return (
    <nav aria-label="Run navigation" className="flex items-center gap-2">
      <Step run={newer} dir="prev" />
      <Step run={older} dir="next" />
    </nav>
  );
}
