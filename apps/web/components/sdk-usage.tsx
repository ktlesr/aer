"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

function CopyBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable (insecure context) — value stays visible to copy manually.
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card/40">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <span className="font-mono text-[0.62rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : `Copy ${label}`}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[0.66rem] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {copied ? <Check className="size-3 text-[var(--seal)]" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * How to use an API key from an agent: .env vars + a minimal collector SDK call.
 * Shared by /keys (post-mint) and /login (onboarding teaser).
 */
export function SdkUsage({ baseUrl }: { baseUrl: string }) {
  const install = "npm install @ktlsr/collector-js";

  const env = `# .env\nAER_API_BASE_URL=${baseUrl}\nAER_API_KEY=aer_xxxxxxxxxxxxxxxxxxxxxxxx`;

  const code = `import { AgentEvidenceRecorder } from "@ktlsr/collector-js";

const recorder = new AgentEvidenceRecorder({
  baseUrl: process.env.AER_API_BASE_URL!,
  apiKey: process.env.AER_API_KEY!, // never hard-code; load from env
});

const run = await recorder.startRun({ agentName: "My Agent", riskLevel: "medium" });
await run.event({ type: "user_input", title: "Request", input: { text } });
await run.event({ type: "tool_call", title: "search", output: { hits } });
await run.complete({ status: "completed" });`;

  return (
    <section aria-label="Using your API key" className="space-y-3">
      <div>
        <h2 className="font-display text-lg font-semibold">Use it from your agent</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Install the collector SDK, set two environment variables, then drop a few calls into your
          agent. Runs recorded with the key appear on your dashboard.
        </p>
      </div>
      <CopyBlock label="install" code={install} />
      <CopyBlock label=".env" code={env} />
      <CopyBlock label="agent.ts" code={code} />
      <p className="text-xs text-muted-foreground">
        <code className="font-mono text-foreground">AER_API_BASE_URL</code> is this deployment&apos;s
        URL; <code className="font-mono text-foreground">AER_API_KEY</code> is the key you mint above
        (sent as <code className="font-mono">Authorization: Bearer …</code>). The key is the only
        credential the SDK needs.
      </p>
    </section>
  );
}
