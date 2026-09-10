import type { Metadata } from "next";
import { requireOperator } from "@/lib/dashboard/access";
import { prisma } from "@/lib/prisma";
import { fetchNpmDownloads, loadAdoptionReport, parseInternalEmails } from "@/lib/ops/adoption";
import { LocalTime } from "@/components/local-time";
import { PRIVATE_PAGE } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Adoption", ...PRIVATE_PAGE };

const pct = (part: number, whole: number) =>
  whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;

export default async function OpsPage() {
  // Before any read: non-operators (logged out included) get a 404 and never reach the query.
  await requireOperator();

  const [r, downloads] = await Promise.all([
    loadAdoptionReport(prisma, {
      now: new Date(),
      internalEmails: parseInternalEmails(process.env.AER_INTERNAL_EMAILS),
    }),
    fetchNpmDownloads(),
  ]);
  const f = r.funnel;

  const funnel: { step: string; value: string; rate: string; note?: string; key?: boolean }[] = [
    {
      step: "npm downloads · last 365 days",
      value: downloads === null ? "n/a" : downloads.toLocaleString("en-US"),
      rate: "",
      note: "Installs, not people — includes CI, mirrors and security scanners.",
    },
    { step: "Signed up", value: String(f.signedUp), rate: "" },
    { step: "API key created", value: String(f.keyCreated), rate: pct(f.keyCreated, f.signedUp) },
    { step: "First run", value: String(f.firstRun), rate: pct(f.firstRun, f.keyCreated) },
    {
      step: "First event",
      value: String(f.firstEvent),
      rate: pct(f.firstEvent, f.firstRun),
      note: "Connected the collector and running — the number that matters.",
      key: true,
    },
    {
      step: "Retained 7 days",
      value: `${f.retained7d.retained} / ${f.retained7d.eligible}`,
      rate: pct(f.retained7d.retained, f.retained7d.eligible),
      note: "Of projects whose first event is at least 7 days old.",
    },
    {
      step: "Retained 30 days",
      value: `${f.retained30d.retained} / ${f.retained30d.eligible}`,
      rate: pct(f.retained30d.retained, f.retained30d.eligible),
      note: "Of projects whose first event is at least 30 days old.",
    },
  ];

  const activity = [
    { label: "Active · 7d", value: f.active7d },
    { label: "Active · 30d", value: f.active30d },
    { label: "First event this week", value: f.newThisWeek },
    { label: "Events · 24h", value: r.events24h },
    { label: "Events · 7d", value: r.events7d },
  ];

  return (
    <main className="mx-auto max-w-6xl px-6 py-14">
      <header className="animate-rise mb-9">
        <p className="eyebrow">Operator</p>
        <h1 className="mt-2.5 font-display text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.02em]">
          Collector Adoption
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Across every workspace, counted in projects. Seed and demo workspaces and the accounts in{" "}
          <span className="font-mono text-xs">AER_INTERNAL_EMAILS</span> are left out, so these
          numbers mean someone else. Visible only to operators.
        </p>
        <p className="mt-4 font-mono text-xs text-muted-foreground">
          Generated <LocalTime iso={r.generatedAt.toISOString()} /> · excluded{" "}
          {r.excluded.ownerless} seed/demo · {r.excluded.internal} internal
        </p>
      </header>

      <section className="animate-rise" style={{ animationDelay: "60ms" }} aria-labelledby="funnel">
        <h2 id="funnel" className="mb-3 font-display text-lg font-semibold">
          Funnel
        </h2>
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-5 py-3 eyebrow font-normal">Step</th>
                  <th className="px-4 py-3 eyebrow font-normal text-right">Count</th>
                  <th className="px-4 py-3 eyebrow font-normal text-right">From previous</th>
                  <th className="px-5 py-3 eyebrow font-normal">Note</th>
                </tr>
              </thead>
              <tbody>
                {funnel.map((s) => (
                  <tr key={s.step} className="border-b border-border/60 last:border-0">
                    <td className={`px-5 py-3 ${s.key ? "font-medium" : ""}`}>{s.step}</td>
                    <td
                      className={`px-4 py-3 text-right font-mono tabular-nums ${s.key ? "text-base font-medium" : ""}`}
                    >
                      {s.value}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {s.rate}
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="animate-rise mt-10" style={{ animationDelay: "120ms" }} aria-labelledby="activity">
        <h2 id="activity" className="mb-3 font-display text-lg font-semibold">
          Activity
        </h2>
        <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          {activity.map((a) => (
            <div key={a.label} className="flex items-baseline gap-2">
              <dd className="font-mono text-base font-medium tabular-nums">
                {a.value.toLocaleString("en-US")}
              </dd>
              <dt className="eyebrow">{a.label}</dt>
            </div>
          ))}
        </dl>
      </section>

      <div className="animate-rise mt-10 grid gap-8 md:grid-cols-2" style={{ animationDelay: "180ms" }}>
        <Breakdown
          id="sdk"
          title="SDK"
          caption="Projects per SDK version. Runs from collector-js 0.1.0 or the raw API report no version."
          rows={r.sdk}
        />
        <Breakdown
          id="environments"
          title="Environments"
          caption="Projects per environment label. A project running in two places counts under both."
          rows={r.environments}
        />
      </div>

      <section className="animate-rise mt-10" style={{ animationDelay: "240ms" }} aria-labelledby="projects">
        <h2 id="projects" className="mb-3 font-display text-lg font-semibold">
          Projects sending events{" "}
          <span className="font-mono text-sm font-normal text-muted-foreground tabular-nums">
            {r.projects.length}
          </span>
        </h2>
        {r.projects.length === 0 ? (
          <p className="surface px-5 py-6 text-sm text-muted-foreground">
            No external project has sent an event yet.
          </p>
        ) : (
          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left">
                    <th className="px-5 py-3 eyebrow font-normal">Owner</th>
                    <th className="px-4 py-3 eyebrow font-normal">Workspace · Project</th>
                    <th className="px-4 py-3 eyebrow font-normal text-right">Runs</th>
                    <th className="px-4 py-3 eyebrow font-normal text-right">Events</th>
                    <th className="px-4 py-3 eyebrow font-normal">First event</th>
                    <th className="px-5 py-3 eyebrow font-normal">Last event</th>
                  </tr>
                </thead>
                <tbody>
                  {r.projects.map((p) => (
                    <tr
                      key={`${p.owner}/${p.project}`}
                      className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-5 py-3 font-mono text-xs">{p.owner}</td>
                      <td className="px-4 py-3">
                        {p.workspace}
                        <span className="text-muted-foreground"> · {p.project}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{p.runs}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {p.events.toLocaleString("en-US")}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        <LocalTime iso={p.firstEventAt.toISOString()} />
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                        <LocalTime iso={p.lastEventAt.toISOString()} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function Breakdown({
  id,
  title,
  caption,
  rows,
}: {
  id: string;
  title: string;
  caption: string;
  rows: [string, number][];
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="font-display text-lg font-semibold">
        {title}
      </h2>
      <p className="mt-1 mb-3 text-xs text-muted-foreground">{caption}</p>
      {rows.length === 0 ? (
        <p className="surface px-5 py-4 text-sm text-muted-foreground">No runs yet.</p>
      ) : (
        <ul className="surface divide-y divide-border/60">
          {rows.map(([label, n]) => (
            <li key={label} className="flex items-baseline justify-between gap-4 px-5 py-2.5 text-sm">
              <span className="font-mono text-xs">{label}</span>
              <span className="font-mono tabular-nums">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
