import Link from "next/link";
import { LogOut } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logoutAction } from "@/lib/auth/actions";
import { isOperator } from "@/lib/ops/operator";

type Section = "runs" | "keys" | "ops";

/** Dashboard chrome shared by /runs, /keys and /ops: brand, workspace label, nav, logout, theme. */
export async function AppHeader({ active }: { active: Section | "home" }) {
  const session = await auth();
  const org = session?.user?.id
    ? await prisma.organization.findUnique({
        where: { ownerUserId: session.user.id },
        select: { name: true },
      })
    : null;
  // Only a convenience link — the page itself enforces access via requireOperator().
  const operator = isOperator(session?.user?.id);

  const navLink = (href: string, label: string, key: Section) =>
    active === key ? (
      <span key={key} className="text-sm font-medium text-foreground">
        {label}
      </span>
    ) : (
      <Link
        key={key}
        href={href}
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {label}
      </Link>
    );

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div
        className="h-px w-full"
        style={{ background: "linear-gradient(90deg, transparent, var(--seal), transparent)" }}
      />
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="transition-opacity hover:opacity-80">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-5">
          <nav className="hidden items-center gap-5 sm:flex">
            {navLink("/runs", "Runs", "runs")}
            {navLink("/keys", "API Keys", "keys")}
            {operator ? navLink("/ops", "Ops", "ops") : null}
          </nav>
          {org?.name ? (
            <span
              className="hidden rounded-full border px-2.5 py-1 font-mono text-[0.6rem] font-medium tracking-wider md:inline"
              style={{
                color: "var(--seal)",
                borderColor: "color-mix(in oklch, var(--seal) 35%, transparent)",
                background: "color-mix(in oklch, var(--seal) 8%, transparent)",
              }}
            >
              {org.name}
            </span>
          ) : null}
          <ThemeToggle />
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" size="sm" aria-label="Sign out">
              <LogOut />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
