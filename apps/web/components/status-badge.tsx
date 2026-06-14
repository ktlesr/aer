import { cn } from "@/lib/utils";

const STATUS_DOT: Record<string, string> = {
  running: "bg-sky-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  needs_approval: "bg-amber-500",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5">
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status] ?? "bg-muted-foreground")} />
      <span className="font-mono text-[0.62rem] font-medium uppercase tracking-wider">
        {status.replace(/_/g, " ")}
      </span>
    </span>
  );
}
