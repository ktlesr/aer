-- DropForeignKey
ALTER TABLE "AgentEvent" DROP CONSTRAINT "AgentEvent_runId_fkey";

-- DropForeignKey
ALTER TABLE "AgentRun" DROP CONSTRAINT "AgentRun_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ApiKey" DROP CONSTRAINT "ApiKey_projectId_fkey";

-- DropForeignKey
ALTER TABLE "AuditExport" DROP CONSTRAINT "AuditExport_runId_fkey";

-- DropForeignKey
ALTER TABLE "RedactionFinding" DROP CONSTRAINT "RedactionFinding_runId_fkey";

-- DropIndex
DROP INDEX "ApiKey_keyHash_idx";

-- AlterTable
ALTER TABLE "ApiKey" ALTER COLUMN "prefix" SET DATA TYPE VARCHAR(20);

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_id_organizationId_projectId_key" ON "AgentRun"("id", "organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_id_organizationId_key" ON "Project"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "Project"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "Project"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_runId_organizationId_projectId_fkey" FOREIGN KEY ("runId", "organizationId", "projectId") REFERENCES "AgentRun"("id", "organizationId", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedactionFinding" ADD CONSTRAINT "RedactionFinding_runId_organizationId_projectId_fkey" FOREIGN KEY ("runId", "organizationId", "projectId") REFERENCES "AgentRun"("id", "organizationId", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditExport" ADD CONSTRAINT "AuditExport_runId_organizationId_projectId_fkey" FOREIGN KEY ("runId", "organizationId", "projectId") REFERENCES "AgentRun"("id", "organizationId", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

