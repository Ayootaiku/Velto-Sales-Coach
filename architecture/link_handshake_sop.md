# Link Handshake SOP

## Goal
Verify external dependencies (Supabase and OpenAI) are reachable and authenticated before any business logic execution.

## Inputs
- `.env.local` values loaded into process environment.
- Required keys:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `OPENAI_API_KEY`

## Tooling
- `tools/check_supabase_connection.py`
- `tools/check_openai_connection.py`

## Deterministic Checks
1. **Environment check**
   - Fail if any required key is missing or empty.
2. **Supabase check**
   - Perform lightweight authenticated query against an existing table (`calls`) with `limit(1)`.
   - Pass only if request returns without auth/network error.
3. **OpenAI check**
   - Call models listing endpoint and verify at least one model is returned.
   - Pass only if API key accepted.
4. **Machine-readable output**
   - Each script prints one JSON object with `status`, `service`, `checks`, and `error` fields.

## Failure Handling
- On failure, no downstream pipeline logic runs.
- Record exact error message in `progress.md`.
- Patch script behavior only after reading stack trace.
- Update this SOP if root cause reveals new permanent rule.

## Exit Criteria
- Both checks return `status: "ok"`.
- Results logged in `progress.md`.
