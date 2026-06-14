import { cn } from "@/lib/utils";

/** Seal mark — a hash-anchored evidence stamp. */
export function SealMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={cn("size-7", className)}
    >
      <path
        d="M16 1.7 27.4 8v16L16 30.3 4.6 24V8L16 1.7Z"
        className="fill-seal/10 stroke-seal"
        strokeWidth="1.4"
      />
      <path
        d="M11 16.2 14.6 20 21 12.4"
        className="stroke-seal"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="9.4" className="stroke-seal/40" strokeWidth="0.9" strokeDasharray="1.5 2.2" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <SealMark />
      <div className="leading-none">
        <div className="font-serif text-[0.95rem] font-semibold tracking-tight">
          Agent Evidence Recorder
        </div>
        <div className="eyebrow mt-1 text-[0.6rem]">Audit-ready evidence layer</div>
      </div>
    </div>
  );
}
