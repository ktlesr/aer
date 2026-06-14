import { ShieldCheck } from "lucide-react";

/** Tamper-evident evidence digest, presented as a wax-seal-style stamp. */
export function HashSeal({ digest }: { digest: string }) {
  const hex = digest.replace(/^sha256:/, "");
  return (
    <div className="relative overflow-hidden rounded-lg border border-seal/30 bg-seal/[0.04] p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-seal" />
        <span className="eyebrow text-seal/90">Tamper-evident · sha256</span>
      </div>
      <p className="mt-3 break-all font-mono text-xs leading-relaxed text-foreground/80">
        <span className="text-muted-foreground">sha256:</span>
        {hex}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        A change to any event or finding changes this digest.
      </p>
      <div className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full border border-seal/10" />
    </div>
  );
}
