"use client";

import { useActionState, useState } from "react";
import { Check, Copy, KeyRound, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createKeyAction, revokeKeyAction, type CreateKeyState } from "@/lib/auth/actions";

/** Shows the freshly minted key with a click-to-copy button. Remounted per key (resets state). */
function NewKeyCallout({ apiKey }: { apiKey: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — the value stays visible to copy manually.
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-[color-mix(in_oklch,var(--seal)_40%,transparent)] bg-[color-mix(in_oklch,var(--seal)_8%,transparent)] p-4">
      <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--seal)" }}>
        <ShieldAlert className="size-4" />
        Copy this now — it won&apos;t be shown again
      </div>
      <div className="mt-2 flex items-stretch gap-2">
        <button
          type="button"
          onClick={copy}
          title="Click to copy"
          className="min-w-0 flex-1 cursor-pointer break-all rounded-md bg-background/70 px-3 py-2 text-left font-mono text-sm transition-colors hover:bg-background"
        >
          {apiKey}
        </button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy API key"}
        >
          {copied ? <Check className="text-[var(--seal)]" /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

export interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

export function KeysManager({ keys }: { keys: KeyRow[] }) {
  const [state, formAction, pending] = useActionState<CreateKeyState, FormData>(
    createKeyAction,
    {},
  );

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-border bg-card/40 p-5">
        <h2 className="font-display text-lg font-semibold">Create an API key</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Use it in the collector SDK as <code className="font-mono">Authorization: Bearer …</code>.
          The full key is shown once and stored only as a hash.
        </p>
        <form action={formAction} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input name="name" placeholder="Key name (e.g. prod agent)" className="sm:max-w-xs" />
          <Button type="submit" disabled={pending}>
            <KeyRound />
            {pending ? "Creating…" : "Create key"}
          </Button>
        </form>

        {state.apiKey ? <NewKeyCallout key={state.apiKey} apiKey={state.apiKey} /> : null}
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Your keys</h2>
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No keys yet. Create one above to authenticate the collector SDK and record your first run.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{k.name}</span>
                    {k.revoked ? (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[0.65rem] font-medium text-destructive">
                        revoked
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {k.prefix}… · created {k.createdAt}
                    {k.lastUsedAt ? ` · last used ${k.lastUsedAt}` : " · never used"}
                  </div>
                </div>
                {!k.revoked ? (
                  <form action={revokeKeyAction}>
                    <input type="hidden" name="id" value={k.id} />
                    <Button type="submit" variant="destructive" size="sm">
                      Revoke
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
