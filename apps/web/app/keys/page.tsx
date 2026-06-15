import { requireDashboardAccess } from "@/lib/dashboard/access";
import { listApiKeys } from "@/lib/auth/api-keys";
import { formatDateTime } from "@/lib/format";
import { KeysManager, type KeyRow } from "@/components/keys-manager";

export const dynamic = "force-dynamic";

export const metadata = { title: "API Keys — Agent Evidence Recorder" };

export default async function KeysPage() {
  const scope = await requireDashboardAccess();
  const keys = await listApiKeys(scope);

  const rows: KeyRow[] = keys.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    createdAt: formatDateTime(k.createdAt),
    lastUsedAt: k.lastUsedAt ? formatDateTime(k.lastUsedAt) : null,
    revoked: k.revokedAt !== null,
  }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <header className="mb-9">
        <p className="eyebrow">Credentials</p>
        <h1 className="mt-2.5 font-display text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.02em]">
          API Keys
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Keys authenticate the collector SDK to record runs into your workspace. Each key is bound
          to your organization — runs recorded with it appear only on your dashboard.
        </p>
      </header>
      <KeysManager keys={rows} />
    </main>
  );
}
