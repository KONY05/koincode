-- Add per-session auxiliary LLM cost records (title generation, sub-agent steps)
-- that don't produce normal assistant message rows.
ALTER TABLE "Session" ADD COLUMN "auxCost" TEXT NOT NULL DEFAULT '[]';
