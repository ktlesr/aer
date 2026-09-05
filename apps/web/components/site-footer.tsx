import Link from "next/link";
import { SITE_CONTACT_EMAIL, SITE_NAME, SITE_OPERATOR, SITE_REPO_URL } from "@/lib/site";

/**
 * Operator identity, shown on every public page (marketing + auth). This is a trust surface,
 * not decoration: who runs the site, how to reach them, and where the legal terms are.
 */
export function SiteFooter({ className = "" }: { className?: string }) {
  return (
    <footer
      className={`flex flex-col gap-2 border-t border-border/60 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <span>
        {SITE_NAME} — operated by <span className="text-foreground">{SITE_OPERATOR}</span>.{" "}
        <a
          href={`mailto:${SITE_CONTACT_EMAIL}`}
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          {SITE_CONTACT_EMAIL}
        </a>
      </span>
      <nav className="flex items-center gap-4">
        <Link href="/privacy" className="underline-offset-4 hover:text-foreground hover:underline">
          Privacy
        </Link>
        <Link href="/terms" className="underline-offset-4 hover:text-foreground hover:underline">
          Terms
        </Link>
        <a
          href={SITE_REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          Source
        </a>
      </nav>
    </footer>
  );
}
