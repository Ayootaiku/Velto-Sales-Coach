// Test Supabase connection and table existence
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables:');
  console.error('  SUPABASE_URL:', supabaseUrl ? '✓ Set' : '✗ Missing');
  console.error('  SUPABASE_SERVICE_ROLE_KEY:', supabaseKey ? '✓ Set' : '✗ Missing');
  process.exit(1);
}

console.log('✓ Environment variables loaded');
console.log('  URL:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  try {
    // Test connection
    console.log('\nTesting Supabase connection...');
    const { data: tables, error: tableError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public');
    
    if (tableError) {
      console.error('❌ Failed to connect:', tableError.message);
      return;
    }
    
    console.log('✓ Connected to Supabase');
    console.log('\nExisting tables:', tables?.map(t => t.table_name).join(', ') || 'None');
    
    // Check for required tables
    const requiredTables = ['calls', 'transcripts', 'coaching_events', 'summaries'];
    const existingTables = tables?.map(t => t.table_name) || [];
    
    console.log('\nChecking required tables:');
    for (const table of requiredTables) {
      if (existingTables.includes(table)) {
        console.log(`  ✓ ${table}`);
      } else {
        console.log(`  ✗ ${table} - MISSING`);
      }
    }
    
    // Test insert (will fail if table doesn't exist)
    console.log('\nTesting insert to calls table...');
    const { data, error } = await supabase
      .from('calls')
      .insert([{
        status: 'test',
        participant_type: 'test'
      }])
      .select()
      .single();
    
    if (error) {
      console.error('❌ Insert failed:', error.message);
      if (error.message.includes('does not exist')) {
        console.log('\n⚠️  You need to run the migration SQL!');
        console.log('   File: supabase/migrations/001_create_salescoach_tables.sql');
      }
    } else {
      console.log('✓ Insert successful');
      // Clean up test data
      await supabase.from('calls').delete().eq('id', data.id);
      console.log('✓ Test data cleaned up');
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

testConnection();
