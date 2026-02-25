# Supabase Migration - Action Required

## ✅ SQL Migration File Created

**File:** `supabase/migrations/20240209190000_create_salescoach_tables.sql`

This file contains all the SQL needed to create the 4 tables for the SalesCoach system.

## 🚀 Next Steps (You Do This)

Since Supabase CLI is installed and project is linked, run:

```bash
supabase db push
```

This will create all the tables in your Supabase project.

## 📋 What Gets Created

The migration will create these tables:

1. **calls** - Call metadata (start/end time, duration, outcome, etc.)
2. **transcripts** - Speaker-labeled conversation turns
3. **coaching_events** - AI coaching suggestions with objections and responses
4. **summaries** - Post-call AI summaries

Plus indexes and helper functions.

## ✨ After Migration

Once `supabase db push` completes:

1. **Refresh** http://localhost:3000
2. Click **"Start Call"**
3. Allow microphone
4. Start speaking!

The app will work immediately after tables exist.

## 🔍 Verify Tables Were Created

After running `supabase db push`, you can verify in Supabase Dashboard:
- Go to **Table Editor**
- You should see 4 new tables:
  - calls
  - transcripts
  - coaching_events
  - summaries

## 🎯 That's It!

Run `supabase db push` and you're done. No manual SQL pasting needed!
