-- SalesCoach RAG (Retrieval Augmented Generation) Schema
-- Adds tables for AI context retrieval and personalized coaching

-- RAG: Common objections knowledge base
CREATE TABLE IF NOT EXISTS objection_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  objection_type VARCHAR(50) NOT NULL,
  objection_text TEXT NOT NULL,
  best_response TEXT NOT NULL,
  success_rate DECIMAL(3,2) DEFAULT 0.0,
  usage_count INTEGER DEFAULT 0,
  industry VARCHAR(50),
  tags JSONB DEFAULT '[]'
);

-- RAG: Salesperson tendencies/habits
CREATE TABLE IF NOT EXISTS salesperson_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  total_calls INTEGER DEFAULT 0,
  common_objections JSONB DEFAULT '[]',
  strengths JSONB DEFAULT '[]',
  improvement_areas JSONB DEFAULT '[]',
  avg_call_duration INTEGER,
  success_rate DECIMAL(3,2) DEFAULT 0.0,
  preferred_responses JSONB DEFAULT '{}',
  last_call_date TIMESTAMPTZ
);

-- RAG: Call similarity embeddings (for finding similar calls)
CREATE TABLE IF NOT EXISTS call_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES calls(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  embedding vector(1536), -- OpenAI embedding dimension
  transcript_summary TEXT,
  key_topics JSONB DEFAULT '[]'
);

-- Indexes for RAG queries
CREATE INDEX IF NOT EXISTS idx_objection_patterns_type ON objection_patterns(objection_type);
CREATE INDEX IF NOT EXISTS idx_objection_patterns_success ON objection_patterns(success_rate DESC);
CREATE INDEX IF NOT EXISTS idx_salesperson_profiles_id ON salesperson_profiles(salesperson_id);
CREATE INDEX IF NOT EXISTS idx_call_embeddings_call_id ON call_embeddings(call_id);

-- Function to get similar calls for RAG context
CREATE OR REPLACE FUNCTION get_similar_calls(
  p_salesperson_id VARCHAR,
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  call_id UUID,
  outcome VARCHAR,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.outcome,
    c.created_at
  FROM calls c
  WHERE c.status = 'completed'
    AND c.outcome IN ('booked', 'follow_up')
  ORDER BY c.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to get common objections for RAG context
CREATE OR REPLACE FUNCTION get_common_objections(
  p_objection_type VARCHAR DEFAULT NULL,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  objection_type VARCHAR,
  objection_text TEXT,
  best_response TEXT,
  success_rate DECIMAL,
  usage_count INTEGER
) AS $$
BEGIN
  IF p_objection_type IS NOT NULL THEN
    RETURN QUERY
    SELECT 
      op.objection_type,
      op.objection_text,
      op.best_response,
      op.success_rate,
      op.usage_count
    FROM objection_patterns op
    WHERE op.objection_type = p_objection_type
    ORDER BY op.success_rate DESC, op.usage_count DESC
    LIMIT p_limit;
  ELSE
    RETURN QUERY
    SELECT 
      op.objection_type,
      op.objection_text,
      op.best_response,
      op.success_rate,
      op.usage_count
    FROM objection_patterns op
    ORDER BY op.usage_count DESC, op.success_rate DESC
    LIMIT p_limit;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to update salesperson profile from completed call
CREATE OR REPLACE FUNCTION update_salesperson_profile_from_call()
RETURNS TRIGGER AS $$
DECLARE
  v_objections JSONB;
  v_strengths JSONB;
BEGIN
  -- Only process completed calls with salesperson_id
  IF NEW.status = 'completed' AND NEW.salesperson_id IS NOT NULL THEN
    -- Get objections from this call
    SELECT jsonb_agg(
      jsonb_build_object(
        'type', ce.objection_type,
        'handled', true
      )
    )
    INTO v_objections
    FROM coaching_events ce
    WHERE ce.call_id = NEW.id;
    
    -- Get strengths from summary
    SELECT strengths
    INTO v_strengths
    FROM summaries
    WHERE call_id = NEW.id;
    
    -- Update or insert salesperson profile
    INSERT INTO salesperson_profiles (
      salesperson_id,
      total_calls,
      common_objections,
      strengths,
      last_call_date,
      success_rate
    )
    VALUES (
      NEW.salesperson_id,
      1,
      COALESCE(v_objections, '[]'),
      COALESCE(v_strengths, '[]'),
      NEW.created_at,
      CASE WHEN NEW.outcome = 'booked' THEN 1.0 ELSE 0.0 END
    )
    ON CONFLICT (salesperson_id) 
    DO UPDATE SET
      total_calls = salesperson_profiles.total_calls + 1,
      common_objections = salesperson_profiles.common_objections || EXCLUDED.common_objections,
      strengths = EXCLUDED.strengths,
      last_call_date = EXCLUDED.last_call_date,
      success_rate = (
        (salesperson_profiles.success_rate * salesperson_profiles.total_calls) + 
        CASE WHEN NEW.outcome = 'booked' THEN 1.0 ELSE 0.0 END
      ) / (salesperson_profiles.total_calls + 1),
      updated_at = NOW();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update salesperson profile
DROP TRIGGER IF EXISTS update_profile_on_call_complete ON calls;
CREATE TRIGGER update_profile_on_call_complete
  AFTER UPDATE OF status ON calls
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION update_salesperson_profile_from_call();

-- Add salesperson_id to calls table if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'calls' AND column_name = 'salesperson_id'
  ) THEN
    ALTER TABLE calls ADD COLUMN salesperson_id VARCHAR(100);
  END IF;
END $$;

-- Enable pgvector extension for embeddings (if available)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pgvector extension not available, skipping vector operations';
END $$;