-- AlterTable
ALTER TABLE "AgentEvent" ADD COLUMN     "hash" TEXT,
ADD COLUMN     "prevHash" TEXT;

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "seal" TEXT;
