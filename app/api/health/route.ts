import { NextResponse } from 'next/server';

export async function GET() {
  const checks = {
    openai: {
      configured: !!process.env.OPENAI_API_KEY,
      keyPrefix: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.substring(0, 10) + '...' : null,
    },
    supabase: {
      url: !!process.env.SUPABASE_URL,
      key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    node_env: process.env.NODE_ENV,
  };

  const allConfigured = checks.openai.configured && checks.supabase.url && checks.supabase.key;

  return NextResponse.json({
    status: allConfigured ? 'ready' : 'missing_config',
    checks,
    message: allConfigured 
      ? 'All services configured correctly' 
      : 'Missing configuration. Check .env.local',
  });
}
