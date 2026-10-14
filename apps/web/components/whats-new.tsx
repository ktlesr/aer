// ponytail: static list, edited by hand with each release — no CMS/changelog feed until there is a need.
const ITEMS = [
  {
    title: "Verified human approval",
    body: "The agent asks; only a signed-in user of your workspace approves. The approval is bound to the exact action and parameters, and every step lands in the evidence chain.",
    code: "run.requestApproval()",
  },
  {
    title: "Signed receipts, offline verification",
    body: "Sealing a run returns a receipt. Keep it, and anyone can later check an exported packet against it — no network, no AER account.",
    code: "npx @ktlsr/aer-verify",
  },
  {
    title: "Delivery that survives outages",
    body: "Retries honour Retry-After, events queue while AER is unreachable, and an optional file store keeps them across restarts.",
    code: "recorder.shutdown()",
  },
];

/** Recent product changes, with where to read more. Shown on the landing page and the signed-in home. */
export function WhatsNew() {
  return (
    <section aria-labelledby="whats-new" className="border-t border-border/60 pt-8">
      <h2 id="whats-new" className="eyebrow">
        What&apos;s new · collector-js 0.7
      </h2>
      <ul className="mt-5 grid gap-6 sm:grid-cols-3">
        {ITEMS.map((i) => (
          <li key={i.title}>
            <p className="font-display text-base font-medium">{i.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{i.body}</p>
            <p className="mt-2 font-mono text-[0.72rem] text-muted-foreground">{i.code}</p>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted-foreground">
        Already using AER? <span className="font-mono text-foreground">npm i @ktlsr/collector-js@latest</span> — older
        SDK versions keep working unchanged.{" "}
        <a
          href="https://www.npmjs.com/package/@ktlsr/collector-js#upgrading"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Upgrade notes
        </a>
      </p>
    </section>
  );
}
