#!/bin/bash

# Start Supabase MCP Server with environment from parent project

# Load environment variables from parent .env.local
if [ -f ../.env.local ]; then
  export $(grep -v '^#' ../.env.local | xargs)
  echo "Loaded environment from ../.env.local"
else
  echo "Warning: ../.env.local not found"
fi

# Check required variables
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
  exit 1
fi

echo "Starting Supabase MCP Server..."
npx tsx supabase-server.ts
