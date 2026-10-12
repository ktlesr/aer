-- AlterTable
ALTER TABLE "AgentEvent" ADD COLUMN     "captureDeclared" JSONB,
ADD COLUMN     "redactionPolicy" TEXT;

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "captureDeclared" JSONB,
ADD COLUMN     "redactionPolicy" TEXT;
