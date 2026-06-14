"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function RawJsonViewer({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : "Show"} full redacted JSON
      </Button>
      {open ? (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">
            Payloads are stored <strong>redacted</strong> — no raw sensitive values are present.
            This is the complete stored record for the run.
          </p>
          <pre className="mt-2 max-h-[28rem] overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
