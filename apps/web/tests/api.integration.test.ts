import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST as createRun } from "@/app/api/v1/runs/route";
import { POST as addEvent } from "@/app/api/v1/runs/[run_id]/events/route";
import { POST as completeRun } from "@/app/api/v1/runs/[run_id]/complete/route";
import { POST as createExport } from "@/app/api/v1/runs/[run_id]/exports/route";
import { GET as downloadExport } from "@/app/api/v1/runs/[run_id]/exports/[export_id]/download/route";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

const TEST_KEY = "aer_test_aaaa1111bbbb2222cccc3333";
const OTHER_KEY = "aer_test_zzzz9999yyyy8888xxxx7777";
const REVOKED_KEY = "aer_test_rrrr0000rrrr0000rrrr0000";

const ORG = "org_itest";
const OTHER_ORG = "org_itest_other";

const RAW_EMAIL = "eviltest@example.com";
const RAW_PHONE = "+1 222 333 4455";

function req(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

const ctx = <T extends Record<string, string>>(params: T) => ({
  params: Promise.resolve(params),
});

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [ORG, OTHER_ORG] } } });

  await prisma.organization.create({
    data: {
      id: ORG,
      name: "Integration Test Org",
      projects: { create: { id: "proj_itest", name: "P" } },
    },
  });
  await prisma.apiKey.create({
    data: {
      organizationId: ORG,
      projectId: "proj_itest",
      name: "itest key",
      keyHash: sha256(TEST_KEY),
      prefix: TEST_KEY.slice(0, 13),
    },
  });
  await prisma.apiKey.create({
    data: {
      organizationId: ORG,
      projectId: "proj_itest",
      name: "revoked key",
      keyHash: sha256(REVOKED_KEY),
      prefix: REVOKED_KEY.slice(0, 13),
      revokedAt: new Date(),
    },
  });

  await prisma.organization.create({
    data: {
      id: OTHER_ORG,
      name: "Other Org",
      projects: { create: { id: "proj_other", name: "P2" } },
    },
  });
  await prisma.apiKey.create({
    data: {
      organizationId: OTHER_ORG,
      projectId: "proj_other",
      name: "other key",
      keyHash: sha256(OTHER_KEY),
      prefix: OTHER_KEY.slice(0, 13),
    },
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [ORG, OTHER_ORG] } } });
  await prisma.$disconnect();
});

describe("API v1 — auth", () => {
  it("rejects a request with no Authorization header (401)", async () => {
    const res = await createRun(req("POST", "/api/v1/runs", { body: { agentName: "x" } }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe("unauthorized");
    expect(json.error.request_id).toMatch(/^req_/);
  });

  it("rejects an invalid API key (401)", async () => {
    const res = await createRun(
      req("POST", "/api/v1/runs", { token: "aer_test_nope", body: { agentName: "x" } }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a revoked API key (401)", async () => {
    const res = await createRun(
      req("POST", "/api/v1/runs", { token: REVOKED_KEY, body: { agentName: "x" } }),
    );
    expect(res.status).toBe(401);
  });
});

describe("API v1 — run lifecycle + redaction + tenant isolation", () => {
  let runId = "";
  let exportId = "";

  it("creates a run (201)", async () => {
    const res = await createRun(
      req("POST", "/api/v1/runs", {
        token: TEST_KEY,
        body: { agentName: "Customer Data Deletion Agent", riskLevel: "high" },
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.run.status).toBe("running");
    runId = json.run.id;
    expect(runId).toBeTruthy();
  });

  it("rejects an invalid body (422)", async () => {
    const res = await createRun(
      req("POST", "/api/v1/runs", { token: TEST_KEY, body: { agentName: "" } }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("validation_error");
  });

  it("adds an event and redacts PII, reporting 2 findings", async () => {
    const res = await addEvent(
      req("POST", `/api/v1/runs/${runId}/events`, {
        token: TEST_KEY,
        body: {
          type: "user_input",
          title: "Customer requests deletion",
          input: { customer: { email: RAW_EMAIL, phone: RAW_PHONE } },
        },
      }),
      ctx({ run_id: runId }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.redaction.findingsCount).toBe(2);

    // Stored snapshot is redacted; stored findings carry no raw value.
    const event = await prisma.agentEvent.findFirstOrThrow({ where: { runId } });
    expect(JSON.stringify(event.inputRedacted)).toContain("[REDACTED_EMAIL]");
    expect(JSON.stringify(event.inputRedacted)).not.toContain(RAW_EMAIL);
    const findings = await prisma.redactionFinding.findMany({ where: { runId } });
    expect(findings).toHaveLength(2);
    expect(JSON.stringify(findings)).not.toContain(RAW_EMAIL);
    expect(JSON.stringify(findings)).not.toContain("222 333 4455");
    expect(findings.map((f) => f.fieldPath).sort()).toEqual([
      "input.customer.email",
      "input.customer.phone",
    ]);
  });

  it("rejects cross-tenant access to the run (404)", async () => {
    const res = await addEvent(
      req("POST", `/api/v1/runs/${runId}/events`, {
        token: OTHER_KEY,
        body: { type: "error", title: "intrusion" },
      }),
      ctx({ run_id: runId }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("is idempotent on (run_id, seq): a duplicate does not create a second event", async () => {
    const body = { type: "tool_call", title: "search_customer", seq: 42 };
    const first = await addEvent(
      req("POST", `/api/v1/runs/${runId}/events`, { token: TEST_KEY, body }),
      ctx({ run_id: runId }),
    );
    expect(first.status).toBe(201);
    const firstId = (await first.json()).event.id;

    const second = await addEvent(
      req("POST", `/api/v1/runs/${runId}/events`, { token: TEST_KEY, body }),
      ctx({ run_id: runId }),
    );
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson.idempotent).toBe(true);
    expect(secondJson.event.id).toBe(firstId);

    // Exactly one row for that seq — the retry created nothing.
    const rows = await prisma.agentEvent.findMany({ where: { runId, seq: 42 } });
    expect(rows).toHaveLength(1);
  });

  it("completes the run (200)", async () => {
    const res = await completeRun(
      req("POST", `/api/v1/runs/${runId}/complete`, {
        token: TEST_KEY,
        body: { status: "completed" },
      }),
      ctx({ run_id: runId }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.run.status).toBe("completed");
    expect(typeof json.run.durationMs).toBe("number");
  });

  it("rejects events after completion (422)", async () => {
    const res = await addEvent(
      req("POST", `/api/v1/runs/${runId}/events`, {
        token: TEST_KEY,
        body: { type: "error", title: "late" },
      }),
      ctx({ run_id: runId }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe("run_already_completed");
  });

  it("creates a JSON export (201) with a content hash", async () => {
    const res = await createExport(
      req("POST", `/api/v1/runs/${runId}/exports?type=json`, { token: TEST_KEY }),
      ctx({ run_id: runId }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.export.status).toBe("ready");
    expect(json.export.contentHash).toMatch(/^sha256:/);
    exportId = json.export.id;
  });

  it("downloads the packet with NO raw sensitive value", async () => {
    const res = await downloadExport(
      req("GET", `/api/v1/runs/${runId}/exports/${exportId}/download`, { token: TEST_KEY }),
      ctx({ run_id: runId, export_id: exportId }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-hash")).toMatch(/^sha256:/);
    const text = await res.text();
    expect(text).not.toContain(RAW_EMAIL);
    expect(text).not.toContain("222 333 4455");
    expect(text).toContain("[REDACTED_EMAIL]");
    expect(text).toContain("content_hash");
  });

  it("rejects cross-tenant export creation (404)", async () => {
    const res = await createExport(
      req("POST", `/api/v1/runs/${runId}/exports?type=json`, { token: OTHER_KEY }),
      ctx({ run_id: runId }),
    );
    expect(res.status).toBe(404);
  });

  it("rejects cross-tenant download (404)", async () => {
    const res = await downloadExport(
      req("GET", `/api/v1/runs/${runId}/exports/${exportId}/download`, { token: OTHER_KEY }),
      ctx({ run_id: runId, export_id: exportId }),
    );
    expect(res.status).toBe(404);
  });

  it("creates a PDF export (201) and downloads a real PDF with the same content hash", async () => {
    const res = await createExport(
      req("POST", `/api/v1/runs/${runId}/exports?type=pdf`, { token: TEST_KEY }),
      ctx({ run_id: runId }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.export.type).toBe("pdf");
    expect(json.export.status).toBe("ready");
    expect(json.export.contentHash).toMatch(/^sha256:/);

    const dl = await downloadExport(
      req("GET", `/api/v1/runs/${runId}/exports/${json.export.id}/download`, { token: TEST_KEY }),
      ctx({ run_id: runId, export_id: json.export.id }),
    );
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(dl.headers.get("x-content-hash")).toBe(json.export.contentHash);
    const bytes = new Uint8Array(await dl.arrayBuffer());
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("rejects an unsupported export type (422)", async () => {
    const res = await createExport(
      req("POST", `/api/v1/runs/${runId}/exports?type=xml`, { token: TEST_KEY }),
      ctx({ run_id: runId }),
    );
    expect(res.status).toBe(422);
  });
});

describe("API v1 — redaction covers all persisted fields, not just input/output", () => {
  it("redacts title and metadata; raw values never reach DB, export, or download", async () => {
    const rawKey = "sk-proj-abcDEF123456ghiJKL789mno";
    const rawMail = "leak@secret.example";

    const runRes = await createRun(
      req("POST", "/api/v1/runs", {
        token: TEST_KEY,
        body: { agentName: "Field Redaction Agent", metadata: { note: rawKey } },
      }),
    );
    const { run } = await runRes.json();

    await addEvent(
      req("POST", `/api/v1/runs/${run.id}/events`, {
        token: TEST_KEY,
        body: { type: "model_call", title: `contact ${rawMail}`, metadata: { auth: rawKey } },
      }),
      ctx({ run_id: run.id }),
    );

    const ev = await prisma.agentEvent.findFirstOrThrow({ where: { runId: run.id } });
    expect(ev.title).toContain("[REDACTED_EMAIL]");
    expect(ev.title).not.toContain(rawMail);
    expect(JSON.stringify(ev.metadata)).not.toContain(rawKey);

    const runRow = await prisma.agentRun.findFirstOrThrow({ where: { id: run.id } });
    expect(JSON.stringify(runRow.metadata)).not.toContain(rawKey);

    const expRes = await createExport(
      req("POST", `/api/v1/runs/${run.id}/exports?type=json`, { token: TEST_KEY }),
      ctx({ run_id: run.id }),
    );
    const { export: exp } = await expRes.json();
    const dl = await downloadExport(
      req("GET", `/api/v1/runs/${run.id}/exports/${exp.id}/download`, { token: TEST_KEY }),
      ctx({ run_id: run.id, export_id: exp.id }),
    );
    const text = await dl.text();
    expect(text).not.toContain(rawKey);
    expect(text).not.toContain(rawMail);
  });
});
