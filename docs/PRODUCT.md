# PRODUCT.md — Agent Evidence Recorder

## Product
**Agent Evidence Recorder (AER)** turns every critical action an AI agent takes —
model calls, tool calls, human approvals, redactions, errors, and outputs — into an
**audit-ready evidence packet**.

AER is **not** an AI observability/metrics tool. Its positioning is an
**audit-ready evidence layer for AI agent runs**: a defensible, redacted, hash-anchored
record that a compliance, legal, or security reviewer can trust.

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

## Out of Scope (MVP) — "defer after MVP"
billing · SSO · RBAC · multi-cloud · real-time/WebSocket · team management · API marketplace ·
blockchain/immutable audit · LangChain/CrewAI/n8n/Zapier/Make integrations · SOC2/GDPR full-
compliance claims · Redis · Kafka · Temporal · Kubernetes · Elasticsearch · ClickHouse ·
microservices · PDF export (placeholder only) · signed export links (later).
