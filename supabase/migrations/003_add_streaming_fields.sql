-- Add streaming-specific fields and performance tracking
-- Migration: 003_add_streaming_fields.sql

-- Add Google STT v2 specific fields to calls table
ALTER TABLE calls 
ADD COLUMN IF NOT EXISTS stt_provider VARCHAR(50) DEFAULT 'google-stt-v2',
ADD COLUMN IF NOT EXISTS avg_latency_ms INTEGER,
ADD COLUMN IF NOT EXISTS total_turns INTEGER DEFAULT 0;

-- Create partial transcripts table for debugging/monitoring (optional)
CREATE TABLE IF NOT EXISTS partial_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES calls(id) ON DELETE CASCADE,
  speaker VARCHAR(20) NOT NULL CHECK (speaker IN ('salesperson', 'prospect')),
  partial_text TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  finalized BOOLEAN DEFAULT FALSE,
  confidence_score DECIMAL(3,2)
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_partial_transcripts_call ON partial_transcripts(call_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_partial_transcripts_finalized ON partial_transcripts(finalized);

-- Add comment for documentation
COMMENT ON TABLE partial_transcripts IS 'Stores partial transcripts from Google STT v2 streaming for debugging and monitoring';
COMMENT ON COLUMN calls.stt_provider IS 'Speech-to-text provider used (google-stt-v2, whisper, etc.)';
COMMENT ON COLUMN calls.avg_latency_ms IS 'Average latency in milliseconds from speech end to transcript';
COMMENT ON COLUMN calls.total_turns IS 'Total number of conversation turns in this call';
