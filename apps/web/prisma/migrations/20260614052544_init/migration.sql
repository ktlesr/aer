-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('running', 'completed', 'failed', 'needs_approval');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('run_started', 'user_input', 'model_call', 'tool_call', 'redaction_applied', 'human_approval_requested', 'human_approval_granted', 'error', 'final_output', 'run_completed');

-- CreateEnum
CREATE TYPE "FindingType" AS ENUM ('email', 'phone', 'api_key', 'bearer_token', 'credit_card', 'national_id');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "ExportType" AS ENUM ('json', 'pdf');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('pending', 'ready', 'failed');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'running',
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'low',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "redactionCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "EventType" NOT NULL,
    "title" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inputRedacted" JSONB,
    "outputRedacted" JSONB,
    "riskLevel" "RiskLevel",
    "costMicroUsd" INTEGER,
    "metadata" JSONB,

    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedactionFinding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "eventId" TEXT,
    "findingType" "FindingType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "fieldPath" TEXT NOT NULL,
    "originalHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedactionFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditExport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "type" "ExportType" NOT NULL DEFAULT 'json',
    "status" "ExportStatus" NOT NULL DEFAULT 'pending',
    "contentHash" TEXT,
    "packet" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_organizationId_idx" ON "Project"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_organizationId_projectId_idx" ON "ApiKey"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "AgentRun_organizationId_projectId_startedAt_idx" ON "AgentRun"("organizationId", "projectId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentEvent_organizationId_projectId_idx" ON "AgentEvent"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentEvent_runId_seq_key" ON "AgentEvent"("runId", "seq");

-- CreateIndex
CREATE INDEX "RedactionFinding_runId_idx" ON "RedactionFinding"("runId");

-- CreateIndex
CREATE INDEX "RedactionFinding_organizationId_projectId_idx" ON "RedactionFinding"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "AuditExport_runId_idx" ON "AuditExport"("runId");

-- CreateIndex
CREATE INDEX "AuditExport_organizationId_projectId_idx" ON "AuditExport"("organizationId", "projectId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedactionFinding" ADD CONSTRAINT "RedactionFinding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedactionFinding" ADD CONSTRAINT "RedactionFinding_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "AgentEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditExport" ADD CONSTRAINT "AuditExport_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
