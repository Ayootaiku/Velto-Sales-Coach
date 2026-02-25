# 🔧 Fixing "Failed to create call record" Error

## Most Likely Causes:

### 1. **Supabase Not Configured** (Most Common)

**Check:**
```bash
# Look at your .env.local file - does it have real values?
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...your-key
```

**If using placeholder values like:**
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

**Fix:** Get your real credentials from Supabase:
1. Go to https://app.supabase.com
2. Select your project
3. Go to Settings → API
4. Copy "Project URL" → paste as SUPABASE_URL
5. Copy "service_role secret" → paste as SUPABASE_SERVICE_ROLE_KEY

---

### 2. **Database Tables Don't Exist**

**Check:** Open http://localhost:3000/api/health

If Supabase is configured but you still get errors, the tables don't exist.

**Fix:** Run the migration:

1. Open Supabase Dashboard
2. Go to SQL Editor
3. Click "New Query"
4. Copy the contents of: `supabase/migrations/001_create_salescoach_tables.sql`
5. Paste in the editor
6. Click "Run"

This creates the 4 tables needed:
- `calls` - stores call metadata
- `transcripts` - stores conversation
- `coaching_events` - stores AI suggestions
- `summaries` - stores post-call summaries

---

### 3. **OpenAI Not Configured**

**Check .env.local:**
```
OPENAI_API_KEY=sk-proj-...your-key
```

Must start with `sk-` and be a valid key from https://platform.openai.com/api-keys

---

## Quick Diagnosis Steps:

### Step 1: Check Configuration
Open browser console and look for:
- Yellow warning about missing config
- Check http://localhost:3000/api/health

### Step 2: Check Browser Console
Press F12 → Console tab
Look for red error messages

### Step 3: Check Network Tab
Press F12 → Network tab
Click "Start Call"
Look for failed requests to `/api/mcp-proxy`

### Step 4: Test Supabase Directly
```bash
cd scripts
npx tsx test-supabase.ts
```

---

## Example Working .env.local:

```env
# OpenAI
OPENAI_API_KEY=sk-proj-AbCdEfGh123456789
OPENAI_MODEL=gpt-4o

# Supabase (REAL values from your project)
SUPABASE_URL=https://abc123def456.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiYzEyM2RlZjQ1NiIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJpYXQiOjE3MDY3ODkwMjAsImV4cCI6MjAyMjM2NTAyMH0.XYZ123abc
```

**NOT placeholder values!**

---

## Still Not Working?

1. **Restart the dev server:**
   ```bash
   Ctrl+C
   npm run dev
   ```

2. **Clear browser cache:**
   - Hard reload: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)

3. **Check Supabase dashboard:**
   - Go to Table Editor
   - Verify tables exist
   - Check Row Level Security is not blocking inserts

4. **Check server logs:**
   Look at the terminal where `npm run dev` is running
   Look for "[MCP Proxy]" error messages

---

## Success Indicators:

✅ **http://localhost:3000/api/health** returns:
```json
{
  "status": "ready",
  "checks": {
    "openai": { "configured": true },
    "supabase": { "url": true, "key": true }
  }
}
```

✅ **Clicking "Start Call"** shows:
- No red error banner
- Call starts successfully
- Timer begins counting

✅ **After speaking** as prospect:
- Transcripts appear
- AI coaching cards show up

---

## Need Help?

If you've checked everything above and it's still not working:

1. Open browser console (F12)
2. Copy any red error messages
3. Check the terminal running `npm run dev`
4. Share both error logs
