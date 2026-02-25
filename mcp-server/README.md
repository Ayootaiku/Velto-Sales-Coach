# Supabase MCP Server

Model Context Protocol (MCP) server for READ-ONLY Supabase access.

## Purpose

This MCP server provides AI assistants (like OpenCode) with safe, read-only access to your Supabase database for context and debugging purposes. It does NOT modify or delete any data.

## Tools Available

### 1. `list_tables`
Lists all tables in the public schema.

### 2. `describe_table(table_name)`
Returns column schema for a specific table including:
- column_name
- data_type
- is_nullable
- column_default

### 3. `get_recent_calls(limit?)`
Returns recent sales calls with metadata:
- id, created_at, duration, status, objection_count

### 4. `get_call_transcript(call_id)`
Returns full transcript for a specific call:
- timestamp, speaker, text

### 5. `get_objection_stats(timeframe_days?)`
Returns objection frequency statistics:
- type, count, filtered by timeframe

## Setup

### 1. Environment Variables

Ensure these are set in your `.env.local` (root of main project):

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 2. Install Dependencies

```bash
cd mcp-server
npm install
```

### 3. Run the Server

```bash
npm start
```

Or with environment variables from parent:

```bash
# From project root
export $(cat .env.local | xargs) && cd mcp-server && npm start
```

## Security

- ✅ READ-ONLY operations only
- ✅ Service role key never exposed to frontend
- ✅ No raw SQL execution
- ✅ Structured JSON responses only
- ✅ All tool usage is logged
- ✅ No DELETE, UPDATE, or INSERT operations

## Integration with OpenCode

Add to your OpenCode configuration:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "node",
      "args": ["./mcp-server/dist/supabase-server.js"],
      "env": {
        "SUPABASE_URL": "${SUPABASE_URL}",
        "SUPABASE_SERVICE_ROLE_KEY": "${SUPABASE_SERVICE_ROLE_KEY}"
      }
    }
  }
}
```

## Database Schema Assumptions

This MCP server expects the following tables (adjust as needed):

- `calls` - Sales call metadata
- `call_transcripts` - Call transcript entries
- `objections` - Detected objections log

If your schema differs, modify the tool implementations in `supabase-server.ts`.
