import Link from "next/link";
import { SealMark } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";
import { SITE_NAME } from "@/lib/site";

/** Shared frame for the public legal pages. Same register as the marketing page, no chrome. */
export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="flex items-center gap-2.5 outline-none focus-visible:underline">
          <SealMark className="size-7" />
          <span className="font-display text-[0.98rem] font-semibold tracking-[-0.01em]">
            {SITE_NAME}
          </span>
        </Link>
      </header>

      <article className="flex-1 py-8">
        <p className="eyebrow">Legal</p>
        <h1 className="mt-3 font-display text-[clamp(1.8rem,4vw,2.6rem)] font-semibold leading-tight tracking-[-0.02em]">
          {title}
        </h1>
        <p className="mt-2 font-mono text-[0.7rem] tracking-[0.14em] text-muted-foreground">
          LAST UPDATED · {updated}
        </p>
        <div className="mt-10 space-y-7 text-sm leading-relaxed text-muted-foreground [&_a]:text-foreground [&_a]:underline-offset-4 hover:[&_a]:underline [&_h2]:font-display [&_h2]:text-base [&_h2]:font-medium [&_h2]:text-foreground [&_li]:mt-1.5 [&_p]:mt-2 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </article>

      <SiteFooter />
    </main>
  );
}
