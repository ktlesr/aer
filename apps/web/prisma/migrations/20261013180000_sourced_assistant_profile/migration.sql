-- Stage 3: sourced-assistant profile. Additive and nullable; existing rows are untouched.
ALTER TABLE "AgentRun" ADD COLUMN "conversationRef" TEXT,
ADD COLUMN "turnRef" TEXT,
ADD COLUMN "parentRunId" TEXT;

ALTER TABLE "AgentEvent" ADD COLUMN "sourced" JSONB;
