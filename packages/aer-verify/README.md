# @ktlsr/aer-verify

Offline verifier for [Agent Evidence Recorder](https://aer.ktlsr.com) audit packets. Reads local
files only — no network request, no AER account, no database. Zero runtime dependencies (Node ≥ 18).

```sh
npx @ktlsr/aer-verify packet.json --receipt receipt.json --trusted-key aer-key.json
```

- `packet.json` — a JSON packet exported from AER (schema 1.1–2.0).
- `--receipt` — the receipt **you kept** when the run was sealed (the `complete` response, or its
  `receipt` field). This is what makes a later rewrite detectable.
- `--trusted-key` (repeatable) — an Ed25519 public key you obtained **out of band**:
  `{ "key_id", "public_key" }`, a list of them, or a saved `GET /api/v1/receipt-keys` response.
  A key carried inside the packet is never used.
- `--require-anchor` — exit 1 unless the result is tied to your receipt or trusted key.
- `--json` — machine-readable report.

## What it reports, separately

| Check | Meaning |
| --- | --- |
| Schema | Known packet version? Unknown versions are never "verified". |
| Event chain | Each event's hash and link (`aer-chain/1`); `consistent_unsealed` while the run is open. |
| Seal | Whether the run was sealed (completed/failed). |
| Run manifest | Agent, status, tenant, times, policies, capture claims, lineage, sourced blocks — frozen at seal (`aer-manifest/1`). |
| Content hash | Whole-file consistency. Not tamper evidence by itself: an editor can recompute it. |
| Receipt in packet / signature | The server's receipt, and its signature checked **only** against your trusted keys. |
| Your kept receipt | Whether this packet is the run you hold a receipt for. |

It also lists the fields no integrity check covers (counters, export-time views).

**Anchored: NO** means the file is internally consistent — whoever produced it could have rewritten
and recomputed everything. Anchoring needs a receipt you kept or a signature by a key you trust.

Exit codes: `0` verified · `2` verified with limits (legacy schema, unsealed, pre-manifest run) ·
`1` failed · `4` unsupported or unreadable input.

## Limits

AER verifies what was **recorded**: not that the events happened, that sources are correct, or that
nothing went unreported. `issued_at` in a receipt is the AER server's clock, not an independent
timestamp. Schema 1.x packets carry no manifest; their content hash covers the writer's key order and
may not be reproducible after storage.
