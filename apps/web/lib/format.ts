export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 0) ms = 0;
  // Sub-second runs are real, not zero — show ms so a fast run never reads as "0s".
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function formatCost(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(4)}`;
}

export function formatDateTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.toISOString().slice(0, 19).replace("T", " ")}Z`;
}

export function formatEventType(type: string): string {
  return type.replace(/_/g, " ");
}
