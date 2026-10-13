-- Stage 6: verified human approvals. Additive. NOTE: enum values cannot be dropped in PostgreSQL,
-- so the two new EventType values stay even if this feature is rolled back (no "full rollback").
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'human_approval_rejected';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'human_approval_used';

CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'revoked');

CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "action" VARCHAR(300) NOT NULL,
    "paramsRedacted" JSONB,
    "actionHash" VARCHAR(64) NOT NULL,
    "paramsHash" VARCHAR(64) NOT NULL,
    "paramsSalt" VARCHAR(32) NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "outcome" JSONB,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Approval_runId_idx" ON "Approval"("runId");
CREATE INDEX "Approval_organizationId_projectId_status_idx" ON "Approval"("organizationId", "projectId", "status");

ALTER TABLE "Approval" ADD CONSTRAINT "Approval_runId_organizationId_projectId_fkey" FOREIGN KEY ("runId", "organizationId", "projectId") REFERENCES "AgentRun"("id", "organizationId", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;
