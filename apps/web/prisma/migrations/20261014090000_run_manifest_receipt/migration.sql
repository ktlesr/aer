-- Stage 4: run manifest + receipt frozen at seal. Additive and nullable; existing rows untouched
-- (runs sealed earlier keep a null manifest and are reported as "not_frozen", never backfilled).
ALTER TABLE "AgentRun" ADD COLUMN "manifestVersion" TEXT,
ADD COLUMN "manifestHash" TEXT,
ADD COLUMN "receipt" JSONB;
