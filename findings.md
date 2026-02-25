# Findings

## Initial Discovery
- Repository detected and writable.
- `architecture/`, `tools/`, and `.tmp/` directories initialized.
- No existing `task_plan.md`, `findings.md`, `progress.md`, or `gemini.md` were present before initialization.

## Constraints Captured
- No scripts may be created under `tools/` before discovery answers and schema confirmation.
- Payload design must be defined in `gemini.md` before implementation.
- Reliability-first approach; no guessing on business logic.

## Open Questions
- None. Discovery answers received and captured in `gemini.md`.

## Discovery Answers (Captured)
- North Star: Sales coaching.
- Integrations: Supabase + OpenAI.
- Source of truth: Supabase.
- Delivery: Database write.
- Behavioral rules: Strict factual; concise executive with analyst depth.

## Research Notes (GitHub + Docs)
- Supabase semantic search docs confirm pgvector workflow and recommend model consistency for embeddings.
- OpenAI structured outputs docs confirm strict JSON schema support for deterministic payload generation.
- `supabase-py` README confirms lightweight Python client initialization for DB and function access.
- `pgvector` README documents index/operator choices (`<=>`, `<#>`, HNSW/IVFFlat) and production tuning guardrails.

## Helpful References
- https://supabase.com/docs/guides/ai/semantic-search
- https://platform.openai.com/docs/guides/structured-outputs
- https://raw.githubusercontent.com/supabase/supabase-py/main/src/supabase/README.md
- https://raw.githubusercontent.com/pgvector/pgvector/master/README.md
- https://supabase.com/docs/guides/database/extensions/pgvector

## Link Verification Findings
- `.env.local` contains required integration variables for Supabase and OpenAI.
- Supabase handshake (REST query to `calls`) succeeded with authenticated response.
- OpenAI handshake (`/v1/models`) succeeded with authenticated response.
- Link phase is unblocked for Architect implementation.
