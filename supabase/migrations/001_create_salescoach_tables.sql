-- SalesCoach System Schema
-- Run this in Supabase SQL Editor to create required tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- calls table: stores call metadata
CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  status VARCHAR(20) DEFAULT 'active',
  outcome VARCHAR(50),
  outcome_confidence DECIMAL(3,2),
  participant_type VARCHAR(20),
  total_objections INTEGER DEFAULT 0,
  coaching_events_count INTEGER DEFAULT 0
);

-- transcripts table: stores speaker-labeled conversation turns
CREATE TABLE IF NOT EXISTS transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES calls(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  speaker VARCHAR(20) NOT NULL CHECK (speaker IN ('salesperson', 'prospect')),
  text TEXT NOT NULL,
  sequence_number INTEGER,
  confidence_score DECIMAL(3,2) DEFAULT 1.0
);

-- coaching_events table: stores live coaching suggestions
CREATE TABLE IF NOT EXISTS coaching_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES calls(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  trigger_transcript_id UUID REFERENCES transcripts(id),
  speaker_detected VARCHAR(20),
  objection_type VARCHAR(50),
  objection_text TEXT,
  suggestion_text TEXT NOT NULL,
  rationale TEXT NOT NULL,
  was_used BOOLEAN DEFAULT FALSE
);

-- summaries table: stores post-call AI summaries
CREATE TABLE IF NOT EXISTS summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES calls(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  outcome_guess VARCHAR(50),
  outcome_confidence DECIMAL(3,2),
  objections_handled JSONB DEFAULT '[]',
  strengths JSONB DEFAULT '[]',
  improvement_areas JSONB DEFAULT '[]',
  focus_next_call JSONB DEFAULT '[]',
  ai_summary_text TEXT,
  summary_quality_score DECIMAL(3,2)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_transcripts_call_id ON transcripts(call_id);
CREATE INDEX IF NOT EXISTS idx_coaching_events_call_id ON coaching_events(call_id);
CREATE INDEX IF NOT EXISTS idx_summaries_call_id ON summaries(call_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at DESC);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for calls table
DROP TRIGGER IF EXISTS update_calls_updated_at ON calls;
CREATE TRIGGER update_calls_updated_at
  BEFORE UPDATE ON calls
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create function to increment coaching count
CREATE OR REPLACE FUNCTION increment_coaching_count(call_uuid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE calls 
  SET coaching_events_count = coaching_events_count + 1
  WHERE id = call_uuid;
END;
$$ LANGUAGE plpgsql;

-- Create function for executing SQL (for migrations)
CREATE OR REPLACE FUNCTION exec_sql(sql text)
RETURNS void AS $$
BEGIN
  EXECUTE sql;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
