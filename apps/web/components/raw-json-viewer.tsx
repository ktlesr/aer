"use client";

import { useState } from "react";
import { Braces } from "lucide-react";
import { cn } from "@/lib/utils";

export function RawJsonViewer({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5",
          "font-mono text-[0.68rem] font-medium uppercase tracking-wider text-muted-foreground",
          "outline-none transition-colors hover:border-foreground/30 hover:text-foreground",
          "focus-visible:border-ring focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        )}
      >
        <Braces className="size-3.5" />
        {open ? "Hide" : "Show"} full redacted record
      </button>
      {open ? (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">
            Payloads are stored <span className="text-foreground">redacted</span> — no raw sensitive
            values are present. This is the complete stored record.
          </p>
          <pre className="mt-2 max-h-[28rem] overflow-auto rounded-md border border-border/70 bg-muted/40 p-3 font-mono text-xs leading-relaxed">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
