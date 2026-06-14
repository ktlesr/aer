import { cn } from "@/lib/utils";

const OCTAGON = "M11 3 H29 L37 11 V29 L29 37 H11 L3 29 V11 Z";
const OCTAGON_INSET = "M12.5 6 H27.5 L34 12.5 V27.5 L27.5 34 H12.5 L6 27.5 V12.5 Z";

/** Evidence seal — a notary-style wax stamp: octagon, gold hairline, dashed ring, verify mark. */
export function SealMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden className={cn("size-9", className)}>
      <defs>
        <linearGradient id="aer-seal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34a6b2" />
          <stop offset="1" stopColor="#125b66" />
        </linearGradient>
        <linearGradient id="aer-hi" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.4" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={OCTAGON} fill="url(#aer-seal)" />
      <path d={OCTAGON} fill="url(#aer-hi)" />
      <path d={OCTAGON_INSET} fill="none" stroke="#e3c277" strokeOpacity="0.55" strokeWidth="0.8" />
      <circle
        cx="20"
        cy="20"
        r="11"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.45"
        strokeWidth="0.8"
        strokeDasharray="1.4 2.4"
      />
      <path
        d="M14 20.4 L18.2 24.6 L26.2 15.2"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-3">
      <SealMark className="size-9 drop-shadow-sm" />
      <div className="leading-none">
        <div className="font-display text-[1.02rem] font-semibold tracking-[-0.01em] text-foreground">
          Agent Evidence Recorder
        </div>
        <div className="eyebrow mt-1.5 text-[0.58rem]">Audit-ready evidence layer</div>
      </div>
    </div>
  );
}
