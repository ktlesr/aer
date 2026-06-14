import { ShieldCheck } from "lucide-react";

/** Tamper-evident evidence digest, presented as a wax-seal-style stamp. */
export function HashSeal({ digest }: { digest: string }) {
  const hex = digest.replace(/^sha256:/, "");
  return (
    <div
      className="surface relative overflow-hidden p-4"
      style={{
        borderColor: "color-mix(in oklch, var(--seal) 28%, var(--border))",
        background:
          "radial-gradient(120% 90% at 100% 0%, color-mix(in oklch, var(--seal) 9%, var(--card)), var(--card))",
      }}
    >
      <div className="flex items-center gap-2" style={{ color: "var(--seal)" }}>
        <ShieldCheck className="size-4" />
        <span className="eyebrow" style={{ color: "var(--seal)" }}>
          Tamper-evident · sha256
        </span>
      </div>
      <p className="mt-3 break-all font-mono text-xs leading-relaxed text-foreground/85">
        <span className="text-muted-foreground">sha256:</span>
        {hex}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        A change to any event or finding changes this digest.
      </p>
      <div
        className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full"
        style={{ border: "1px solid color-mix(in oklch, var(--seal) 16%, transparent)" }}
      />
      <div
        className="pointer-events-none absolute -right-4 -top-4 size-16 rounded-full"
        style={{ border: "1px solid color-mix(in oklch, var(--seal) 12%, transparent)" }}
      />
    </div>
  );
}
