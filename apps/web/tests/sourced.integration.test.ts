// Stage 3 acceptance: sourced-assistant profile, through the real routes and a real PostgreSQL.
// Synthetic "Teşvik Asistanı" conversation — no real customer data.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyChain } from "@ktlsr/evidence-chain";
import { prisma } from "@/lib/prisma";
import { POST as createRun } from "@/app/api/v1/runs/route";
import { POST as addEvent } from "@/app/api/v1/runs/[run_id]/events/route";
import { POST as completeRun } from "@/app/api/v1/runs/[run_id]/complete/route";
import { POST as createExport } from "@/app/api/v1/runs/[run_id]/exports/route";
import { GET as downloadExport } from "@/app/api/v1/runs/[run_id]/exports/[export_id]/download/route";
import { packetSeal, packetToChainLinks, type AuditPacket } from "@/lib/audit/packet";
import { AgentEvidenceRecorder } from "../../../packages/collector-js/src/index";
import { ctx, dropTenants, makeTenant, req, sha256 } from "./support";

const ORG = "org_sourced_itest";
const KEY = "aer_test_sourced11sourced22sourced";
const OTHER_ORG = "org_sourced_other";
const OTHER_KEY = "aer_test_sourcedOtherTenant0000000";

const H1 = `sha256:${sha256("9903 karar madde 9 — v1 text")}`;
const H2 = `sha256:${sha256("9903 karar madde 9 — v2 text")}`;
const source = (version: string, contentHash: string) => ({
  id: "9903_karar.madde_9",
  version,
  title: "Yatırımlarda Devlet Yardımları Hakkında Karar, md. 9",
  contentHash,
  hashScope: "chunk_text_utf8",
  archiveRef: "kb:tesvik/9903/madde-9",
});

beforeAll(async () => {
  await makeTenant(ORG, KEY);
  await makeTenant(OTHER_ORG, OTHER_KEY);
});
afterAll(async () => {
  await dropTenants(ORG, OTHER_ORG);
  await prisma.$disconnect();
});

async function startRun(body: Record<string, unknown>, key = KEY) {
  const res = await createRun(req("POST", "/api/v1/runs", { token: key, body: { agentName: "tesvik-asistani", ...body } }));
  expect(res.status).toBe(201);
  return (await res.json()).run as { id: string; parentRunId: string | null; conversationRef: string | null };
}

const event = (runId: string, body: Record<string, unknown>, headers?: Record<string, string>) =>
  addEvent(req("POST", `/api/v1/runs/${runId}/events`, { token: KEY, body, headers }), ctx({ run_id: runId }));

async function packetOf(runId: string): Promise<AuditPacket> {
  const exp = await createExport(req("POST", `/api/v1/runs/${runId}/exports?type=json`, { token: KEY }), ctx({ run_id: runId }));
  const exportId = (await exp.json()).export.id as string;
  const dl = await downloadExport(
    req("GET", `/api/v1/runs/${runId}/exports/${exportId}/download`, { token: KEY }),
    ctx({ run_id: runId, export_id: exportId }),
  );
  return JSON.parse(await dl.text()) as AuditPacket;
}

describe("sourced assistant — follow-up question", () => {
  let turn1: string;
  let turn2: string;

  it("records turn 1 (cold storage, cites source v1)", async () => {
    turn1 = (await startRun({ conversationRef: "conv-synth-1", turnRef: "t1" })).id;
    const res = await event(turn1, {
      type: "model_call",
      title: "answer",
      sourced: {
        profile: "sourced_assistant",
        version: 1,
        context: { used: [{ key: "yatirim_konusu", value: "soğuk hava deposu", origin: "user_stated" }] },
        citedSources: [source("2024-v1", H1)],
      },
    });
    expect(res.status).toBe(201);
    expect((await res.json()).event.sourcedStored).toBe(true);
    await completeRun(req("POST", `/api/v1/runs/${turn1}/complete`, { token: KEY, body: { status: "completed" } }), ctx({ run_id: turn1 }));
  });

  it("turn 2 ('osb içinde milas') shows the carried-over context, the link to turn 1 and the gaps", async () => {
    const run = await startRun({ conversationRef: "conv-synth-1", turnRef: "t2", parentRunId: turn1 });
    turn2 = run.id;
    expect(run.parentRunId).toBe(turn1);
    const res = await event(turn2, {
      type: "model_call",
      title: "answer",
      sourced: {
        profile: "sourced_assistant",
        version: 1,
        context: {
          used: [
            { key: "ilce", value: "Milas", origin: "user_stated" },
            { key: "osb_durumu", value: "OSB içinde", origin: "user_stated" },
            { key: "yatirim_konusu", value: "soğuk hava deposu", origin: "previous_turn", fromTurnRef: "t1" },
            { key: "il", value: "Muğla", origin: "inferred" },
            { key: "iletisim", value: "ayse.yilmaz@example.com", origin: "user_stated" },
          ],
          missing: ["yatirim_tutari"],
        },
        retrievedSources: [
          { ...source("2024-v1", H1), score: 0.0000246913578, scoreMethod: "bm25" },
          { id: "osb_listesi.mugla", score: 0.81, scoreMethod: "dense-e5" },
        ],
        citedSources: [source("2024-v1", H1)],
        claimSourceLinks: [{ claim: "OSB içindeki yatırım 4. bölge desteğinden yararlanır.", sourceIds: ["9903_karar.madde_9"], basis: "model_declared" }],
        generation: { model: "synthetic-model-1" },
        timing: { clientStartedAt: "2026-10-13T10:00:00.000Z", clientEndedAt: "2026-10-13T10:00:02.500Z" },
      },
    });
    expect(res.status).toBe(201);
    await completeRun(req("POST", `/api/v1/runs/${turn2}/complete`, { token: KEY, body: { status: "completed" } }), ctx({ run_id: turn2 }));

    const p = await packetOf(turn2);
    expect(p.schema_version).toBe("2.0");
    expect(p.run.links).toEqual({
      conversationRef: "conv-synth-1",
      turnRef: "t2",
      parentRun: { id: turn1, status: "linked", agentName: "tesvik-asistani" },
    });
    const s = p.events[0].sourced!;
    expect(s.context!.used!.map((c) => c.origin)).toEqual([
      "user_stated", "user_stated", "previous_turn", "inferred", "user_stated",
    ]);
    expect(s.context!.missing).toEqual(["yatirim_tutari"]);
    // Candidates and cited support stay separate lists; a decimal score is not masked.
    expect(s.retrievedSources).toHaveLength(2);
    expect(s.retrievedSources![0].score).toBe(0.0000246913578);
    expect(s.citedSources!.map((c) => c.id)).toEqual(["9903_karar.madde_9"]);
    expect(s.claimSourceLinks![0].basis).toBe("model_declared");
    expect(s.not_recorded).toEqual([
      "generation.provider", "generation.promptTemplateVersion", "generation.appVersion", "generation.providerRequestId",
    ]);
    // Personal data inside context is masked like any other field, and the chain still verifies.
    expect(JSON.stringify(p)).not.toContain("ayse.yilmaz@example.com");
    expect(s.context!.used![4].value).toBe("[REDACTED_EMAIL]");
    expect(p.events[0].findings.map((f) => f.fieldPath)).toContain("sourced.context.used[4].value");
    expect(verifyChain(packetToChainLinks(p), packetSeal(p), turn2)).toMatchObject({ ok: true });
  });

  it("a later source update does not rewrite the version turn 2 cited", async () => {
    const later = (await startRun({ conversationRef: "conv-synth-1", turnRef: "t3", parentRunId: turn2 })).id;
    expect(
      (await event(later, { type: "model_call", title: "answer", sourced: { profile: "sourced_assistant", version: 1, citedSources: [source("2025-v2", H2)] } })).status,
    ).toBe(201);
    const p = await packetOf(turn2);
    const cited = p.events[0].sourced!.citedSources![0];
    expect(cited).toMatchObject({ version: "2024-v1", contentHash: H1, hashScope: "chunk_text_utf8" });
  });
});

describe("missing context and tenant isolation", () => {
  it("an unknown parent and another tenant's real run look the same: missing_context", async () => {
    const foreign = await startRun({}, OTHER_KEY);
    for (const parentRunId of ["run_never_recorded", foreign.id]) {
      const run = await startRun({ parentRunId });
      const p = await packetOf(run.id);
      expect(p.run.links.parentRun).toEqual({ id: parentRunId, status: "missing_context", agentName: null });
    }
  });

  it("legacy run/event without the profile: links empty, sourced null", async () => {
    const run = await startRun({});
    expect((await event(run.id, { type: "tool_call", title: "t" })).status).toBe(201);
    const p = await packetOf(run.id);
    expect(p.run.links).toEqual({ conversationRef: null, turnRef: null, parentRun: null });
    expect(p.events[0].sourced).toBeNull();
  });
});

describe("validation — what must not be accepted", () => {
  const base = { profile: "sourced_assistant", version: 1 };
  const cases: Array<[string, Record<string, unknown>]> = [
    ["claim cites a source not in citedSources", { claimSourceLinks: [{ claim: "x", sourceIds: ["nope"], basis: "model_declared" }] }],
    ["assessed link without an assessment", { citedSources: [{ id: "a" }], claimSourceLinks: [{ claim: "x", sourceIds: ["a"], basis: "assessed" }] }],
    ["content hash without its scope", { citedSources: [{ id: "a", contentHash: H1 }] }],
    ["bare hex hash (no algorithm)", { citedSources: [{ id: "a", contentHash: H1.slice(7), hashScope: "chunk" }] }],
    ["score without its method", { retrievedSources: [{ id: "a", score: 0.9 }] }],
    ["signed URL as archive ref", { citedSources: [{ id: "a", archiveRef: "https://bucket.example/doc.pdf?X-Amz-Signature=abc123" }] }],
    ["unknown field", { reasoning: "hidden chain of thought" }],
    ["client end before start", { timing: { clientStartedAt: "2026-10-13T10:00:02Z", clientEndedAt: "2026-10-13T10:00:00Z" } }],
  ];
  it.each(cases)("%s → 422, input not echoed", async (_name, extra) => {
    const run = await startRun({});
    const res = await event(run.id, { type: "model_call", title: "t", sourced: { ...base, ...extra } });
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toContain("X-Amz-Signature");
    expect(text).not.toContain("hidden chain of thought");
  });

  it("a lineage ref must be identifier-shaped", async () => {
    const res = await createRun(req("POST", "/api/v1/runs", { token: KEY, body: { agentName: "a", conversationRef: "user asked about milas" } }));
    expect(res.status).toBe(422);
  });
});

describe("replay semantics include the sourced block", () => {
  it("same seq + same sourced → 200 replay; different sourced → 409", async () => {
    const run = await startRun({});
    const body = (version: string) => ({
      type: "model_call",
      title: "answer",
      seq: 1,
      sourced: { profile: "sourced_assistant", version: 1, citedSources: [{ id: "a", version }] },
    });
    expect((await event(run.id, body("v1"))).status).toBe(201);
    expect((await event(run.id, body("v1"))).status).toBe(200);
    expect((await event(run.id, body("v2"))).status).toBe(409);
  });

  it("same Idempotency-Key + different sourced → 409", async () => {
    const run = await startRun({});
    const headers = { "idempotency-key": "sourced-idem-1" };
    const body = (id: string) => ({ type: "model_call", title: "a", sourced: { profile: "sourced_assistant", version: 1, citedSources: [{ id }] } });
    expect((await event(run.id, body("a"), headers)).status).toBe(201);
    expect((await event(run.id, body("a"), headers)).headers.get("idempotent-replayed")).toBe("true");
    expect((await event(run.id, body("b"), headers)).status).toBe(409);
  });
});

describe("collector-js 0.4 end to end", () => {
  it("SDK → real routes → DB: lineage and sourced are stored and acknowledged", async () => {
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(String(url), init);
      const m = /^\/api\/v1\/runs\/([^/]+)\/events$/.exec(new URL(String(url)).pathname);
      return m ? addEvent(request, ctx({ run_id: m[1] })) : createRun(request);
    }) as typeof fetch;
    const recorder = new AgentEvidenceRecorder({ baseUrl: "http://aer.test", apiKey: KEY, fetchImpl });
    const run = await recorder.startRun({ agentName: "tesvik-asistani", conversationRef: "conv-sdk", turnRef: "t1" });
    expect(run.lineageStored).toBe(true);
    const res = await run.event({
      type: "model_call",
      title: "answer",
      sourced: { profile: "sourced_assistant", version: 1, citedSources: [source("2024-v1", H1)], generation: { model: "m-1" } },
    });
    expect(res.sourcedStored).toBe(true);
    const row = await prisma.agentEvent.findFirstOrThrow({ where: { runId: run.id } });
    expect(row.sourced).toMatchObject({ citedSources: [{ contentHash: H1 }], generation: { model: "m-1" } });
  });
});

// Independent review (e8ea465) regressions.
describe("review e8ea465: secrets and access URIs in the sourced block", () => {
  const PASSWORD = "synthetic-password-without-token-pattern";

  it("a context entry named password is masked whole: not stored, not exported, hash not recorded", async () => {
    const run = await startRun({});
    const res = await event(run.id, {
      type: "model_call",
      title: "t",
      sourced: { profile: "sourced_assistant", version: 1, context: { used: [{ key: "password", value: PASSWORD, origin: "user_stated" }, { key: "ilce", value: "Milas", origin: "user_stated" }] } },
    });
    expect(res.status).toBe(201);
    const row = await prisma.agentEvent.findFirstOrThrow({ where: { runId: run.id } });
    expect(JSON.stringify(row.sourced)).not.toContain(PASSWORD);
    const p = await packetOf(run.id);
    expect(JSON.stringify(p)).not.toContain(PASSWORD);
    expect(p.events[0].sourced!.context!.used!.map((c) => c.value)).toEqual(["[REDACTED_SECRET]", "Milas"]);
    expect(p.events[0].findings).toContainEqual({
      findingType: "secret", severity: "high", fieldPath: "sourced.context.used[0].value", originalHash: null,
    });
  });

  const leaks: Array<[string, Record<string, unknown>]> = [
    ["signed URL as source id", { citedSources: [{ id: "https://bucket.example.invalid/doc?X-Amz-Signature=synthetic" }] }],
    ["scheme-less signed link as id", { retrievedSources: [{ id: "bucket.example.invalid/doc?sig=synthetic" }] }],
    ["credentials in a URI id", { citedSources: [{ id: "https://user:synthetic@host.example.invalid/doc" }] }],
    ["signed URL in title", { citedSources: [{ id: "a", title: "see https://x.example.invalid/d?token=synthetic" }] }],
    ["signed URL in version", { citedSources: [{ id: "a", version: "v1?sig=synthetic" }] }],
    ["signed URL as claim source id", { claimSourceLinks: [{ claim: "c", sourceIds: ["https://x.example.invalid/d?sig=synthetic"], basis: "model_declared" }] }],
  ];
  it.each(leaks)("%s → 422, nothing stored, value not echoed", async (_n, extra) => {
    const run = await startRun({});
    const res = await event(run.id, { type: "model_call", title: "t", sourced: { profile: "sourced_assistant", version: 1, ...extra } });
    expect(res.status).toBe(422);
    expect(await res.text()).not.toContain("synthetic");
    expect(await prisma.agentEvent.count({ where: { runId: run.id } })).toBe(0);
  });

  it("plain URLs and file names without access material are still accepted as ids", async () => {
    const run = await startRun({});
    const res = await event(run.id, {
      type: "model_call",
      title: "t",
      sourced: { profile: "sourced_assistant", version: 1, citedSources: [{ id: "https://mevzuat.example.invalid/9903#madde-9" }, { id: "Yatırım Kararı 2024.pdf" }] },
    });
    expect(res.status).toBe(201);
  });
});
