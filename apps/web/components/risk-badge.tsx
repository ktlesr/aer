import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const RISK_STYLES: Record<string, string> = {
  low: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
  medium:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  high: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300",
  critical: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
};

export function RiskBadge({ risk }: { risk: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium capitalize", RISK_STYLES[risk])}>
      {risk}
    </Badge>
  );
}
