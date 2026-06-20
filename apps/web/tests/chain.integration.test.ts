import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyChain } from "@ktlsr/evidence-chain";
import { prisma } from "@/lib/prisma";
import { POST as createRun } from "@/app/api/v1/runs/route";
import { POST as addEvent } from "@/app/api/v1/runs/[run_id]/events/route";
import { POST as completeRun } from "@/app/api/v1/runs/[run_id]/complete/route";
import { toChainLink } from "@/lib/audit/chainAdapter";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");
const TEST_KEY = "aer_test_chain1111chain2222chain33";
const ORG = "org_chain_itest";

function req(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

async function loadLinks(runId: string) {
  const events = await prisma.agentEvent.findMany({ where: { runId }, orderBy: { seq: "asc" } });
  const findings = await prisma.redactionFinding.findMany({ where: { runId } });
  return events.map((e) => toChainLink(e, findings));
}

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { id: ORG } });
  await prisma.organization.create({
    data: { id: ORG, name: "Chain Test Org", projects: { create: { id: "proj_chain", name: "P" } } },
  });
  await prisma.apiKey.create({
    data: {
      organizationId: ORG,
      projectId: "proj_chain",
      name: "chain key",
      keyHash: sha256(TEST_KEY),
      prefix: TEST_KEY.slice(0, 13),
    },
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: ORG } });
  await prisma.$disconnect();
});

describe("evidence chain — write path + seal", () => {
  let runId = "";

  it("chains events at write time (verifiable while running, seal null)", async () => {
    const created = await createRun(
      req("POST", "/api/v1/runs", { token: TEST_KEY, body: { agentName: "Chain Agent" } }),
    );
    runId = (await created.json()).run.id;

    for (const [i, body] of [
      { type: "user_input", title: "step 1", input: { email: "leak@example.com" } },
      { type: "model_call", title: "step 2" },
      { type: "final_output", title: "step 3" },
    ].entries()) {
      const res = await addEvent(
        req("POST", `/api/v1/runs/${runId}/events`, { token: TEST_KEY, body }),
        ctx({ run_id: runId }),
      );
      expect(res.status, `event ${i + 1}`).toBe(201);
    }

    const links = await loadLinks(runId);
    expect(links).toHaveLength(3);
    expect(links.every((l) => l.hash && l.prevHash)).toBe(true);
    // seal is null while running.
    expect(verifyChain(links, null, runId)).toMatchObject({ ok: true, status: "verified" });
  });

  it("seals the head on complete and verifies end-to-end", async () => {
    const res = await completeRun(
      req("POST", `/api/v1/runs/${runId}/complete`, { token: TEST_KEY, body: { status: "completed" } }),
      ctx({ run_id: runId }),
    );
    expect(res.status).toBe(200);

    const run = await prisma.agentRun.findFirstOrThrow({ where: { id: runId } });
    expect(run.seal).toBeTruthy();
    const links = await loadLinks(runId);
    expect(verifyChain(links, run.seal, runId)).toMatchObject({ ok: true, status: "verified" });
  });

  it("breaks at the exact seq when a stored event is tampered", async () => {
    const run = await prisma.agentRun.findFirstOrThrow({ where: { id: runId } });
    const target = await prisma.agentEvent.findFirstOrThrow({ where: { runId, seq: 2 } });
    await prisma.agentEvent.update({ where: { id: target.id }, data: { title: "tampered" } });

    const links = await loadLinks(runId);
    const result = verifyChain(links, run.seal, runId);
    expect(result.ok).toBe(false);
    if (!result.ok && result.status === "broken") expect(result.brokenSeq).toBe(2);

    // restore so re-runs stay clean
    await prisma.agentEvent.update({ where: { id: target.id }, data: { title: "step 2" } });
  });
});
