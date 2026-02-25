@echo off

REM Start Supabase MCP Server with environment from parent project

REM Load environment variables from parent .env.local
if exist "..\.env.local" (
  for /f "tokens=*" %%a in ('type "..\.env.local" ^| findstr /v "^#"') do set %%a
  echo Loaded environment from ..\.env.local
) else (
  echo Warning: ..\.env.local not found
)

REM Check required variables
if "%SUPABASE_URL%"=="" (
  echo Error: SUPABASE_URL not set
  exit /b 1
)

if "%SUPABASE_SERVICE_ROLE_KEY%"=="" (
  echo Error: SUPABASE_SERVICE_ROLE_KEY not set
  exit /b 1
)

echo Starting Supabase MCP Server...
npx tsx supabase-server.ts
