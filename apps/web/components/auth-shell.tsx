import { ShieldCheck } from "lucide-react";
import { SealMark } from "@/components/brand";

// A quiet echo of the real evidence timeline — the brand signature, not decoration.
const STEPS: { label: string; sealed?: boolean }[] = [
  { label: "RUN STARTED" },
  { label: "MODEL CALL · plan" },
  { label: "TOOL CALL · search_customer" },
  { label: "REDACTION · 2 sealed", sealed: true },
  { label: "RUN COMPLETED" },
];

/**
 * Two-panel auth frame in the Security Console register: a silent "evidence" aside on the left
 * (desktop) and the form on the right. Respects the design system — one seal accent, mono facts,
 * Fraunces gravity, flat surfaces, a single staggered rise on load.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative z-10 grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border/70 px-12 py-11 lg:flex">
        <div className="animate-rise" style={{ animationDelay: "40ms" }}>
          <div className="flex items-center gap-3">
            <SealMark className="size-8 drop-shadow-sm" />
            <span className="font-display text-[1.02rem] font-semibold tracking-[-0.01em]">
              Agent Evidence Recorder
            </span>
          </div>
        </div>

        <div className="max-w-md">
          <p className="eyebrow animate-rise" style={{ animationDelay: "90ms" }}>
            Audit-ready evidence layer
          </p>
          <h2
            className="animate-rise mt-4 font-display text-[2.3rem] font-semibold leading-[1.08] tracking-[-0.02em] text-balance"
            style={{ animationDelay: "150ms" }}
          >
            Prove what your agents did — without storing what they saw.
          </h2>

          <ol className="animate-rise mt-9 space-y-0" style={{ animationDelay: "230ms" }}>
            {STEPS.map((step, i) => (
              <li key={step.label} className="relative flex items-center gap-3.5 py-2">
                {/* spine */}
                {i < STEPS.length - 1 ? (
                  <span
                    aria-hidden
                    className="absolute left-[5px] top-[1.6rem] h-[calc(100%-0.4rem)] w-px"
                    style={{ background: "var(--border)" }}
                  />
                ) : null}
                <span
                  aria-hidden
                  className="relative z-10 size-[11px] shrink-0 rounded-full border"
                  style={
                    step.sealed
                      ? {
                          background: "var(--seal)",
                          borderColor: "var(--seal)",
                          boxShadow: "0 0 0 3px color-mix(in oklch, var(--seal) 22%, transparent)",
                        }
                      : { background: "var(--card)", borderColor: "var(--border)" }
                  }
                />
                <span
                  className="font-mono text-[0.7rem] tracking-[0.14em]"
                  style={{ color: step.sealed ? "var(--seal)" : "var(--muted-foreground)" }}
                >
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div
          className="animate-rise flex items-center gap-2 text-xs text-muted-foreground"
          style={{ animationDelay: "300ms" }}
        >
          <ShieldCheck className="size-3.5" style={{ color: "var(--seal)" }} />
          <span className="font-mono tracking-wide">
            tamper-evident · sha256 · redacted before storage
          </span>
        </div>
      </aside>

      <div className="flex items-center justify-center px-6 py-12">{children}</div>
    </main>
  );
}
