# PRODUCT.md — Agent Evidence Recorder

## Product
**Agent Evidence Recorder (AER)** turns every critical action an AI agent takes —
model calls, tool calls, human approvals, redactions, errors, and outputs — into an
**audit-ready evidence packet**.

AER is **not** an AI observability/metrics tool. Its positioning is an
**audit-ready evidence layer for AI agent runs**: a defensible, redacted, hash-anchored
record that a compliance, legal, or security reviewer can trust.

## Register

product

## Brand Personality
Restrained, authoritative, precise. AER reads like **evidence**, not a product demo: clinical
confidence with no marketing hyperbole, no decorative flourish. The voice is exact and
defensible — every word and pixel earns its place. North-star feel: the refined, anti-decorative
minimalism of [impeccable.style](https://impeccable.style/) — clarity and craftsmanship over
visual excess — expressed through AER's own forensic "Security Console" identity (deep
petrol-teal seal accent, blueprint-grid atmosphere, serif/mono evidence typography). Confidence
is shown by precision and restraint, never by loudness.

## Anti-references
What AER must **not** look or feel like:
- **Generic AI observability dashboards** (Datadog / Grafana metric-walls: gauges, sparklines,
  token-cost charts). AER is evidence, not telemetry.
- **Playful consumer SaaS** (rounded mascots, gradient blobs, emoji, bouncy/elastic motion).
  It undermines audit credibility.
- **Heavy enterprise/legacy UI** (cluttered gray IBM/SAP density, dropdown soup, 2010-era chrome).
- **Crypto/blockchain "immutable ledger" hype** (neon glow, hexagons, hype copy). AER is sober and
  provable, not hyped.
- The decorative AI defaults the reference site rejects: gradient text, glassmorphism-as-default,
  vibrant accent soup, ornamental animation, trendy scaffolding (eyebrow-on-every-section,
  01/02/03 numbered markers).

## Design Principles
1. **Evidence over telemetry.** Every screen answers "can we prove what the agent did, safely?" —
   not "is it fast/healthy?" Design for a reviewer under scrutiny, not a dashboard browser.
2. **Redacted by default; raw is the exception.** Safe view is the floor. Raw values appear only
   behind an explicit, deliberate affordance — never as the default surface.
3. **Restraint is the signal.** Committed-dark, one seal accent, motion only when it conveys state.
   Loudness reads as untrustworthy; quiet precision reads as defensible.
4. **Tamper-evidence is visible.** Hashes, timestamps, and the chronological chain are first-class
   UI, not metadata footnotes — the artifact should *look* anchored and complete.
5. **Earned familiarity.** Standard, trustworthy affordances (timeline, table, detail panel) done
   impeccably. The tool disappears into the audit task; no invented controls for standard work.

## Accessibility & Inclusion
- **Target: WCAG 2.1 AA.** Body text ≥ 4.5:1, large/bold text ≥ 3:1, against its actual background
  (both the dark Security Console and light Archive Paper themes).
- Visible focus states on every interactive element; full keyboard navigability of timeline,
  tables, and detail panels.
- `prefers-reduced-motion` honored — entrance/stagger animations degrade to instant or crossfade.
- Do not encode meaning in color alone (risk level, event type, redaction status carry an icon or
  label as well), supporting color-vision deficiency.

## Target User
- **Primary:** compliance / risk / security owners at companies deploying AI agents that
  touch regulated or sensitive data (PII, financial, health, customer records).
- **Secondary:** the engineers who build those agents and need to *prove* what an agent did.

## Problem
When an AI agent performs a sensitive operation (e.g. deleting a customer's data on
request), there is usually **no trustworthy, reviewable record** of:
- what the agent was asked to do,
- which tools/models it invoked and in what order,
- whether a human approved the irreversible step,
- whether sensitive data was exposed or properly redacted,
- and a tamper-evident artifact to hand to an auditor.

Generic logging/observability captures latency and tokens — not **evidence**.

## Value Proposition
- **Provable:** a chronological, redacted timeline of every agent decision.
- **Safe:** sensitive values never stored in the clear — only hashes and redaction findings.
- **Portable:** a single JSON **audit packet** with a `sha256` content hash, downloadable
  and reviewable outside the system.
- **Low-friction:** a small collector SDK; drop a few `run.event(...)` calls into an agent.

## Differentiation
| Observability tools | Agent Evidence Recorder |
|---------------------|-------------------------|
| Metrics, traces, latency, token cost | Audit evidence: who/what/when/approval/redaction |
| Raw payloads retained for debugging | Redacted-by-default; hashes for sensitive data |
| Built for engineers | Built for auditors & compliance, usable by engineers |
| "Is it fast/healthy?" | "Can we prove what it did, safely?" |

## Demo Scenario — Customer Data Deletion Request Agent
A customer asks for their data to be deleted. The agent:
1. receives the request (`user_input`),
2. searches for the customer record (`tool_call: search_customer`),
3. checks the data-retention policy (`tool_call: check_data_policy`),
4. triggers redaction on detected PII (email, phone),
5. requests **human approval** before the irreversible deletion,
6. produces a final output and completes the run.

AER records all of this as an evidence packet: a timeline + redaction findings + a
downloadable JSON audit packet that contains **no raw sensitive values**.
