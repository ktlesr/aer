// Sourced-assistant profile (Stage 3): read-side helpers shared by the dashboard and the packet.
// Recording rules live in lib/validation/schemas.ts (sourcedSchema); this file only resolves
// lineage and labels what was NOT recorded — it never fills a gap with a guess.
import { prisma } from "@/lib/prisma";
import type { SourcedInput } from "@/lib/validation/schemas";

/**
 * A stored `sourced` block as read back, plus the gaps. Values are the REDACTED snapshot, so a
 * masked number may read back as a string — render values, don't compute with them.
 */
export type SourcedView = SourcedInput & { not_recorded: string[] };

export interface Tenant {
  organizationId: string;
  projectId: string;
}

/**
 * Lineage as the reader sees it. `parentRun.status`:
 * - `linked`: the parent run exists in this tenant.
 * - `missing_context`: a parent id was recorded but no such run exists here — never recorded,
 *   pruned, or another tenant's id (deliberately indistinguishable).
 */
export interface RunLinks {
  conversationRef: string | null;
  turnRef: string | null;
  parentRun: { id: string; status: "linked" | "missing_context"; agentName: string | null } | null;
}

export async function resolveLinks(
  tenant: Tenant,
  run: { conversationRef: string | null; turnRef: string | null; parentRunId: string | null },
): Promise<RunLinks> {
  let parentRun: RunLinks["parentRun"] = null;
  if (run.parentRunId) {
    const parent = await prisma.agentRun.findFirst({
      where: { id: run.parentRunId, organizationId: tenant.organizationId, projectId: tenant.projectId },
      select: { agentName: true },
    });
    parentRun = parent
      ? { id: run.parentRunId, status: "linked", agentName: parent.agentName }
      : { id: run.parentRunId, status: "missing_context", agentName: null };
  }
  return { conversationRef: run.conversationRef, turnRef: run.turnRef, parentRun };
}

/** Generation fields a reviewer expects; any the client did not send is reported, not invented. */
export const GENERATION_FIELDS = ["provider", "model", "promptTemplateVersion", "appVersion", "providerRequestId"] as const;

/** The `sourced` block plus explicit gaps — what the packet exports and the dashboard shows. */
export function sourcedView(sourced: unknown): SourcedView | null {
  if (!sourced || typeof sourced !== "object" || Array.isArray(sourced)) return null;
  const s = sourced as Record<string, unknown>;
  const generation = (s.generation ?? {}) as Record<string, unknown>;
  const notRecorded = [
    ...GENERATION_FIELDS.filter((f) => generation[f] === undefined).map((f) => `generation.${f}`),
    ...["context", "retrievedSources", "citedSources", "claimSourceLinks", "timing"].filter((k) => s[k] === undefined),
  ];
  return { ...(s as SourcedInput), not_recorded: notRecorded };
}
