import { requireDashboardAccess } from "@/lib/dashboard/access";
import { listApiKeys } from "@/lib/auth/api-keys";
import { KeysManager, type KeyRow } from "@/components/keys-manager";
import { SdkUsage } from "@/components/sdk-usage";

const BASE_URL = process.env.AUTH_URL ?? "https://aer.ktlsr.com";

export const dynamic = "force-dynamic";

export const metadata = { title: "API Keys — Agent Evidence Recorder" };

export default async function KeysPage() {
  const scope = await requireDashboardAccess();
  const keys = await listApiKeys(scope);

  const rows: KeyRow[] = keys.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    revoked: k.revokedAt !== null,
  }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <header className="animate-rise mb-9">
        <p className="eyebrow">Credentials</p>
        <h1 className="mt-2.5 font-display text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.02em]">
          API Keys
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Keys authenticate the collector SDK to record runs into your workspace. Each key is bound
          to your organization — runs recorded with it appear only on your dashboard.
        </p>
      </header>
      <div className="animate-rise" style={{ animationDelay: "90ms" }}>
        <KeysManager keys={rows} />
      </div>
      <div className="animate-rise mt-10 border-t border-border/60 pt-8" style={{ animationDelay: "150ms" }}>
        <SdkUsage baseUrl={BASE_URL} />
      </div>
    </main>
  );
}
