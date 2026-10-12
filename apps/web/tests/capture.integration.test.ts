import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyChain } from "@ktlsr/evidence-chain";
import { prisma } from "@/lib/prisma";
import { POST as createRun } from "@/app/api/v1/runs/route";
import { POST as addEvent } from "@/app/api/v1/runs/[run_id]/events/route";
import { POST as completeRun } from "@/app/api/v1/runs/[run_id]/complete/route";
import { POST as createExport } from "@/app/api/v1/runs/[run_id]/exports/route";
import { GET as downloadExport } from "@/app/api/v1/runs/[run_id]/exports/[export_id]/download/route";
import { packetSeal, packetToChainLinks, type AuditPacket } from "@/lib/audit/packet";
import { REDACTION_POLICY } from "@/lib/redaction";
import { ctx, dropTenants, makeTenant, req } from "./support";

const ORG = "org_capture_itest";
const KEY = "aer_test_capture11capture22capture";
const PASSWORD = "Kedi123!sifre";
const declared = { mode: "redacted_content", policy: "collector-js/0.3.0", status: "applied" };

beforeAll(() => makeTenant(ORG, KEY));
afterAll(async () => {
  await dropTenants(ORG);
  await prisma.$disconnect();
});

describe("capture policy — server label + client declaration, end to end", () => {
  it("records both, masks secret fields, keeps scores numeric, and the packet still verifies", async () => {
    const run = await createRun(
      req("POST", "/api/v1/runs", { token: KEY, body: { agentName: "Teşvik Asistanı", capture: declared } }),
    );
    expect(run.status).toBe(201);
    const runId = (await run.json()).run.id as string;

    const ev = await addEvent(
      req("POST", `/api/v1/runs/${runId}/events`, {
        token: KEY,
        body: {
          type: "tool_call",
          title: "retrieve sources",
          output: { sources: [{ id: "9903_karar.pdf_madde_9", score: 0.0000246913578 }] },
          metadata: { db_password: PASSWORD, model: "m-1" },
          capture: declared,
        },
      }),
      ctx({ run_id: runId }),
    );
    expect(ev.status).toBe(201);
    await completeRun(req("POST", `/api/v1/runs/${runId}/complete`, { token: KEY, body: { status: "completed" } }), ctx({ run_id: runId }));

    const row = await prisma.agentEvent.findFirstOrThrow({ where: { runId } });
    expect(row.redactionPolicy).toBe(REDACTION_POLICY);
    expect(row.captureDeclared).toEqual(declared);
    expect(row.outputRedacted).toEqual({ sources: [{ id: "9903_karar.pdf_madde_9", score: 0.0000246913578 }] });
    expect(row.metadata).toEqual({ db_password: "[REDACTED_SECRET]", model: "m-1" });

    const exp = await createExport(req("POST", `/api/v1/runs/${runId}/exports?type=json`, { token: KEY }), ctx({ run_id: runId }));
    const exportId = (await exp.json()).export.id as string;
    const dl = await downloadExport(
      req("GET", `/api/v1/runs/${runId}/exports/${exportId}/download`, { token: KEY }),
      ctx({ run_id: runId, export_id: exportId }),
    );
    const text = await dl.text();
    expect(text).not.toContain(PASSWORD);
    const packet = JSON.parse(text) as AuditPacket;
    expect(packet.schema_version).toBe("1.2");
    expect(packet.run.capture).toEqual({
      server_applied: { layer: "server", policy: REDACTION_POLICY },
      client_declared: { layer: "client", ...declared },
    });
    expect(packet.events[0].capture.client_declared).toEqual({ layer: "client", ...declared });
    expect(packet.events[0].findings).toEqual([
      { findingType: "secret", severity: "high", fieldPath: "metadata.db_password", originalHash: null },
    ]);
    expect(verifyChain(packetToChainLinks(packet), packetSeal(packet), runId)).toMatchObject({ ok: true });
  });

  it("rejects a capture declaration that could carry content (unknown key / free text) with 422", async () => {
    for (const capture of [
      { ...declared, prompt: "raw user question" },
      { ...declared, policy: "free text with spaces" },
      { ...declared, mode: "everything" },
    ]) {
      const res = await createRun(req("POST", "/api/v1/runs", { token: KEY, body: { agentName: "a", capture } }));
      expect(res.status).toBe(422);
    }
  });

  it("leaves server_applied null for rows written before policies were labelled", async () => {
    const legacy = await prisma.agentRun.create({
      data: { organizationId: ORG, projectId: `${ORG}_proj`, agentName: "legacy" },
    });
    const exp = await createExport(req("POST", `/api/v1/runs/${legacy.id}/exports?type=json`, { token: KEY }), ctx({ run_id: legacy.id }));
    const stored = await prisma.auditExport.findFirstOrThrow({ where: { id: (await exp.json()).export.id } });
    expect((stored.packet as unknown as AuditPacket).run.capture).toEqual({ server_applied: null, client_declared: null });
  });
});
