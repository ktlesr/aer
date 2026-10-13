// Stage 4 acceptance on the real writer: routes → PostgreSQL → JSON export (JSONB round trip) →
// the same offline verifier the aer-verify CLI ships. Synthetic tenant and keys only.
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyPacket, type Receipt, type TrustedKey } from "@ktlsr/evidence-chain";
import { prisma } from "@/lib/prisma";
import { POST as createRun } from "@/app/api/v1/runs/route";
import { POST as addEvent } from "@/app/api/v1/runs/[run_id]/events/route";
import { POST as completeRun } from "@/app/api/v1/runs/[run_id]/complete/route";
import { POST as createExport } from "@/app/api/v1/runs/[run_id]/exports/route";
import { GET as downloadExport } from "@/app/api/v1/runs/[run_id]/exports/[export_id]/download/route";
import { GET as receiptKeys } from "@/app/api/v1/receipt-keys/route";
import { ctx, dropTenants, makeTenant, req } from "./support";

const ORG = "org_packet_v2_itest";
const KEY = "aer_test_packetv2packetv2packetv2pa";
const KEY_ID = "test-receipt-key-1";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const PRIVATE = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const TRUSTED: TrustedKey = { key_id: KEY_ID, public_key: publicKey.export({ format: "der", type: "spki" }).toString("base64") };

const saved = { key: process.env.AER_RECEIPT_SIGNING_KEY, id: process.env.AER_RECEIPT_KEY_ID };
beforeAll(async () => {
  await makeTenant(ORG, KEY);
  process.env.AER_RECEIPT_SIGNING_KEY = PRIVATE;
  process.env.AER_RECEIPT_KEY_ID = KEY_ID;
});
afterAll(async () => {
  process.env.AER_RECEIPT_SIGNING_KEY = saved.key;
  process.env.AER_RECEIPT_KEY_ID = saved.id;
  if (saved.key === undefined) delete process.env.AER_RECEIPT_SIGNING_KEY;
  if (saved.id === undefined) delete process.env.AER_RECEIPT_KEY_ID;
  await dropTenants(ORG);
  await prisma.$disconnect();
});

async function recordRun(opts: { complete?: boolean } = {}) {
  const res = await createRun(req("POST", "/api/v1/runs", {
    token: KEY,
    body: { agentName: "tesvik-asistani", conversationRef: "c1", turnRef: "t2", capture: { mode: "redacted_content", policy: "collector-js/0.5.0:redacted_content", status: "applied" } },
  }));
  const runId = (await res.json()).run.id as string;
  for (const title of ["question", "answer"]) {
    const ev = await addEvent(req("POST", `/api/v1/runs/${runId}/events`, {
      token: KEY,
      body: {
        type: "model_call",
        title,
        output: { score: 0.0000246913578 },
        metadata: { contact: "ayse.yilmaz@example.com" },
        sourced: { profile: "sourced_assistant", version: 1, citedSources: [{ id: "9903_karar.madde_9", version: "2024-v1" }] },
      },
    }), ctx({ run_id: runId }));
    expect(ev.status).toBe(201);
  }
  let receipt: Receipt | null = null;
  if (opts.complete !== false) {
    const done = await completeRun(req("POST", `/api/v1/runs/${runId}/complete`, { token: KEY, body: { status: "completed" } }), ctx({ run_id: runId }));
    expect(done.status).toBe(200);
    receipt = (await done.json()).receipt as Receipt;
  }
  return { runId, receipt };
}

async function exported(runId: string): Promise<Record<string, unknown>> {
  const exp = await createExport(req("POST", `/api/v1/runs/${runId}/exports?type=json`, { token: KEY }), ctx({ run_id: runId }));
  const exportId = (await exp.json()).export.id as string;
  const dl = await downloadExport(req("GET", `/api/v1/runs/${runId}/exports/${exportId}/download`, { token: KEY }), ctx({ run_id: runId, export_id: exportId }));
  return JSON.parse(await dl.text()) as Record<string, unknown>;
}

describe("packet 2.0 from the real writer", () => {
  it("complete returns a signed receipt; the exported packet verifies offline and is anchored by it", async () => {
    const { runId, receipt } = await recordRun();
    expect(receipt!.signature).toMatchObject({ alg: "Ed25519", key_id: KEY_ID });
    expect(receipt!.statement).toMatchObject({ run_id: runId, organization_id: ORG, event_count: 2, clock: "aer-server" });

    const packet = await exported(runId); // read back from JSONB: key order not preserved
    expect(packet.schema_version).toBe("2.0");
    expect(JSON.stringify(packet)).not.toContain("ayse.yilmaz@example.com");
    const r = verifyPacket(packet, { trustedReceipt: receipt!, trustedKeys: [TRUSTED] });
    expect(r).toMatchObject({
      overall: "verified",
      anchored: true,
      chain: { status: "verified" },
      content_hash: { status: "verified" },
      manifest: { status: "verified" },
      signature: { status: "valid_trusted" },
      trusted_receipt: { status: "match" },
    });
  });

  it("repeating complete returns the very same receipt", async () => {
    const { runId, receipt } = await recordRun();
    const again = await completeRun(req("POST", `/api/v1/runs/${runId}/complete`, { token: KEY, body: { status: "completed" } }), ctx({ run_id: runId }));
    expect((await again.json()).receipt).toEqual(receipt);
  });

  it.each([
    ["agent name", { agentName: "renamed-in-db" }],
    ["run status", { status: "failed" as const }],
    ["lineage", { parentRunId: "run_injected" }],
  ])("a DB edit of the %s after seal is caught by the manifest", async (_n, data) => {
    const { runId, receipt } = await recordRun();
    await prisma.agentRun.update({ where: { id: runId }, data });
    const r = verifyPacket(await exported(runId), { trustedReceipt: receipt!, trustedKeys: [TRUSTED] });
    expect(r.chain.status).toBe("verified");
    expect(r.manifest.status).toBe("mismatch");
    expect(r.overall).toBe("failed");
  });

  it("a DB edit of an event's sourced block after seal is caught by the manifest", async () => {
    const { runId, receipt } = await recordRun();
    const ev = await prisma.agentEvent.findFirstOrThrow({ where: { runId, seq: 2 } });
    await prisma.agentEvent.update({
      where: { id: ev.id },
      data: { sourced: { profile: "sourced_assistant", version: 1, citedSources: [{ id: "9903_karar.madde_9", version: "2025-v2" }] } },
    });
    const r = verifyPacket(await exported(runId), { trustedReceipt: receipt!, trustedKeys: [TRUSTED] });
    expect(r.manifest.status).toBe("mismatch");
    expect(r.overall).toBe("failed");
  });

  it("an unsealed run exports as consistent so far, with no manifest and no receipt", async () => {
    const { runId } = await recordRun({ complete: false });
    const r = verifyPacket(await exported(runId));
    expect(r).toMatchObject({ overall: "consistent_unsealed", chain: { status: "consistent_unsealed" }, manifest: { status: "not_frozen" } });
    expect(r.packet_receipt.status).toBe("not_present");
  });

  it("a run sealed before manifests existed is verified_partial, never backfilled", async () => {
    const { runId } = await recordRun();
    await prisma.agentRun.update({ where: { id: runId }, data: { manifestHash: null, manifestVersion: null } });
    await prisma.$executeRaw`UPDATE "AgentRun" SET "receipt" = NULL WHERE "id" = ${runId}`;
    const r = verifyPacket(await exported(runId));
    expect(r.manifest).toMatchObject({ status: "not_frozen", detail: "sealed before run manifests existed" });
    expect(r.overall).toBe("verified_partial");
  });

  it("without a signing key, the receipt is unsigned but still anchors when kept", async () => {
    process.env.AER_RECEIPT_SIGNING_KEY = "";
    try {
      const { runId, receipt } = await recordRun();
      expect(receipt!.signature).toBeNull();
      const r = verifyPacket(await exported(runId), { trustedReceipt: receipt! });
      expect(r).toMatchObject({ overall: "verified", anchored: true, signature: { status: "not_present" }, trusted_receipt: { status: "match" } });
    } finally {
      process.env.AER_RECEIPT_SIGNING_KEY = PRIVATE;
    }
  });

  it("the public key endpoint publishes the public key only", async () => {
    const body = await (await receiptKeys()).json();
    expect(body.keys).toEqual([{ key_id: KEY_ID, alg: "Ed25519", public_key: TRUSTED.public_key, status: "active" }]);
    expect(JSON.stringify(body)).not.toContain(PRIVATE);
  });
});

describe("collector-js 0.5 end to end", () => {
  it("SDK complete() hands back the receipt that anchors the later export", async () => {
    const { AgentEvidenceRecorder } = await import("../../../packages/collector-js/src/index");
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(String(url), init);
      const m = /^\/api\/v1\/runs\/([^/]+)\/(events|complete)$/.exec(new URL(String(url)).pathname);
      return !m ? createRun(request) : m[2] === "events" ? addEvent(request, ctx({ run_id: m[1] })) : completeRun(request, ctx({ run_id: m[1] }));
    }) as typeof fetch;
    const run = await new AgentEvidenceRecorder({ baseUrl: "http://aer.test", apiKey: KEY, fetchImpl }).startRun({ agentName: "sdk-receipt" });
    await run.event({ type: "tool_call", title: "one" });
    const { receipt } = await run.complete();
    expect(receipt?.signature?.key_id).toBe(KEY_ID);
    const r = verifyPacket(await exported(run.id), { trustedReceipt: receipt as Receipt, trustedKeys: [TRUSTED] });
    expect(r).toMatchObject({ overall: "verified", anchored: true });
  });
});

describe("write boundary: content aer-canonical/1 cannot hash is refused", () => {
  it("a body with an own __proto__ key is 422 on run create and event append; nothing is stored", async () => {
    const raw = (path: string, body: string) =>
      new Request(`http://localhost${path}`, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body });
    const before = await prisma.agentRun.count({ where: { organizationId: ORG } });
    const res = await createRun(raw("/api/v1/runs", '{"agentName":"a","metadata":{"__proto__":{"hidden":"synthetic"}}}'));
    expect(res.status).toBe(422);
    expect(await res.text()).not.toContain("synthetic");
    expect(await prisma.agentRun.count({ where: { organizationId: ORG } })).toBe(before);
    const { runId } = await recordRun({ complete: false });
    const ev = await addEvent(raw(`/api/v1/runs/${runId}/events`, '{"type":"tool_call","title":"t","output":{"a":[{"__proto__":{"x":1}}]}}'), ctx({ run_id: runId }));
    expect(ev.status).toBe(422);
    expect(await prisma.agentEvent.count({ where: { runId } })).toBe(2);
  });
});
