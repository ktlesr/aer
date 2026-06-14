import { z } from "zod";
import { ApiError } from "@/lib/api/errors";

export const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

const metadataSchema = z.record(z.string(), z.unknown());

export const createRunSchema = z.object({
  agentName: z.string().min(1).max(200),
  riskLevel: riskLevelSchema.optional(),
  metadata: metadataSchema.optional(),
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
