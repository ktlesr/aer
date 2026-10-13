import { z } from "zod";
import { ApiError } from "@/lib/api/errors";

export const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

const metadataSchema = z.record(z.string(), z.unknown());

/**
 * The client's own statement of how it filtered content before sending (collector-js >= 0.3).
 * A claim, not a fact AER can check — stored and exported as "client_declared". Bounded and strict
 * so it can't smuggle content.
 */
export const captureDeclaredSchema = z
  .object({
    mode: z.enum(["metadata_only", "allowlist", "redacted_content", "full"]),
    policy: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/, "1–80 chars: letters, digits, . _ : / -"),
    status: z.enum(["applied", "failed_closed"]),
  })
  .strict();

/** An app-side identifier (conversation, turn, run). Identifier-shaped so it can't carry text. */
const refSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/, "1–200 chars: letters, digits, . _ : -");
const isoTimeSchema = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "must be an ISO datetime");
const short = (max: number) => z.string().min(1).max(max);

// Access material in a URI: a query parameter (?X-Amz-Signature=…, &sig=…) or userinfo
// (https://user:pass@host). A signed link grants access to the document, so no source field may
// carry one — whichever field the app puts it in. Plain paths/URLs without these are fine.
const ACCESS_URI = /[?&][^\s=&]+=|[a-z][a-z0-9+.-]*:\/\/[^\s/]*@/i;
const sourceText = (max: number) =>
  short(max).refine((v) => !ACCESS_URI.test(v), "must not contain a URI query string or credentials");

/**
 * One source document/chunk. The hash names its algorithm (prefix) and its scope (which bytes were
 * hashed) — a bare hash says nothing a reader can re-check. archiveRef is an opaque pointer, never
 * a URL with a query string, credentials or spaces; no other source field may carry query
 * parameters or credentials either (signed URLs must not land in a packet).
 * A score needs its method: scores from different retrievers are not comparable.
 */
const sourceSchema = z
  .object({
    id: sourceText(200),
    version: sourceText(100).optional(),
    title: sourceText(300).optional(),
    contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/, "sha256:<64 lowercase hex>").optional(),
    hashScope: sourceText(100).optional(),
    archiveRef: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,299}$/, "opaque ref: no query string, credentials or spaces")
      .optional(),
    score: z.number().finite().optional(),
    scoreMethod: sourceText(100).optional(),
  })
  .strict()
  .refine((s) => s.contentHash === undefined || s.hashScope !== undefined, "contentHash requires hashScope")
  .refine((s) => s.score === undefined || s.scoreMethod !== undefined, "score requires scoreMethod");

/**
 * Sourced-assistant evidence on one event (Stage 3). Everything is optional except the profile tag;
 * what is not sent is shown as "not recorded", never inferred.
 * - context.used: only context the app actually used, each with where it came from — an
 *   inferred value is labelled `inferred`, not passed off as user-stated.
 * - retrievedSources (candidates) and citedSources (shown as support) are separate lists; a
 *   retrieved source is never implied to support the answer.
 * - claimSourceLinks: claim → cited source ids, with who asserted the link (`model_declared`
 *   by the model/app, `assessed` by a separate check described in `assessment`).
 * - timing: the client's own clock; AER's receive time is the event's occurredAt.
 */
export const sourcedSchema = z
  .object({
    profile: z.literal("sourced_assistant"),
    version: z.literal(1),
    context: z
      .object({
        used: z
          .array(
            z
              .object({
                key: short(100),
                value: z.union([z.string().max(500), z.number().finite(), z.boolean()]),
                origin: z.enum(["user_stated", "previous_turn", "retrieved", "inferred", "system"]),
                fromTurnRef: refSchema.optional(),
              })
              .strict(),
          )
          .max(100)
          .optional(),
        missing: z.array(short(100)).max(50).optional(),
      })
      .strict()
      .optional(),
    retrievedSources: z.array(sourceSchema).max(100).optional(),
    citedSources: z.array(sourceSchema).max(50).optional(),
    claimSourceLinks: z
      .array(
        z
          .object({
            claim: short(1000),
            sourceIds: z.array(sourceText(200)).min(1).max(20),
            basis: z.enum(["model_declared", "assessed"]),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    assessment: z.object({ method: short(100), version: short(50), result: short(200) }).strict().optional(),
    generation: z
      .object({
        provider: short(100).optional(),
        model: short(100).optional(),
        promptTemplateVersion: short(100).optional(),
        appVersion: short(100).optional(),
        providerRequestId: short(200).optional(),
      })
      .strict()
      .optional(),
    timing: z.object({ clientStartedAt: isoTimeSchema.optional(), clientEndedAt: isoTimeSchema.optional() }).strict().optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const cited = new Set((s.citedSources ?? []).map((c) => c.id));
    s.claimSourceLinks?.forEach((l, i) => {
      if (l.sourceIds.some((id) => !cited.has(id))) {
        ctx.addIssue({ code: "custom", path: ["claimSourceLinks", i, "sourceIds"], message: "every id must be in citedSources" });
      }
    });
    if (s.claimSourceLinks?.some((l) => l.basis === "assessed") && !s.assessment) {
      ctx.addIssue({ code: "custom", path: ["assessment"], message: "required when a link's basis is assessed" });
    }
    const { clientStartedAt: a, clientEndedAt: b } = s.timing ?? {};
    if (a && b && Date.parse(a) > Date.parse(b)) {
      ctx.addIssue({ code: "custom", path: ["timing"], message: "clientStartedAt is after clientEndedAt" });
    }
  });
export type SourcedInput = z.infer<typeof sourcedSchema>;

export const createRunSchema = z.object({
  agentName: z.string().min(1).max(200),
  riskLevel: riskLevelSchema.optional(),
  metadata: metadataSchema.optional(),
  // A deployment label ("production", "staging"), not free text. Lowercased so "Production"
  // and "production" count as one environment in adoption metrics.
  environment: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/, "1–40 chars: letters, digits, . _ -")
    .transform((s) => s.toLowerCase())
    .optional(),
  capture: captureDeclaredSchema.optional(),
  conversationRef: refSchema.optional(),
  turnRef: refSchema.optional(),
  parentRunId: refSchema.optional(),
});
export type CreateRunInput = z.infer<typeof createRunSchema>;

export const eventTypeSchema = z.enum([
  "run_started",
  "user_input",
  "model_call",
  "tool_call",
  "redaction_applied",
  "human_approval_requested",
  "human_approval_granted",
  "error",
  "final_output",
  "run_completed",
]);

export const createEventSchema = z.object({
  type: eventTypeSchema,
  title: z.string().min(1).max(300),
  seq: z.number().int().positive().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  riskLevel: riskLevelSchema.optional(),
  costMicroUsd: z.number().int().nonnegative().optional(),
  metadata: metadataSchema.optional(),
  capture: captureDeclaredSchema.optional(),
  sourced: sourcedSchema.optional(),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const completeRunSchema = z.object({
  status: z.enum(["completed", "failed"]),
  endedAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "endedAt must be an ISO datetime")
    .optional(),
});
export type CompleteRunInput = z.infer<typeof completeRunSchema>;

/** Validate `data` against `schema`, throwing a 422 ApiError on failure. */
export function parseBody<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ApiError("validation_error", message || "Invalid request body", 422);
  }
  return result.data;
}
