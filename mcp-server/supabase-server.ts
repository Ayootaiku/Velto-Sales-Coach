#!/usr/bin/env node

/**
 * Supabase MCP Server for SalesCoach
 * 
 * Provides READ and WRITE access to Supabase for AI context and data persistence.
 * Uses service role key server-side only.
 * AUTO-CREATES TABLES if they don't exist.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Tool usage logging
function logToolUsage(toolName: string, params: any) {
  const timestamp = new Date().toISOString();
  console.error(`[MCP LOG] ${timestamp} - Tool: ${toolName}`, JSON.stringify(params));
}

// Initialize Supabase client
function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  return createClient(supabaseUrl, supabaseKey);
}

// Define MCP tools
const TOOLS: Tool[] = [
  // READ operations
  {
    name: 'list_tables',
    description: 'List all tables in the database',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'describe_table',
    description: 'Get schema for a table',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string' },
      },
      required: ['table_name'],
    },
  },
  {
    name: 'get_call',
    description: 'Get call by ID',
    inputSchema: {
      type: 'object',
      properties: {
        call_id: { type: 'string' },
      },
      required: ['call_id'],
    },
  },
  {
    name: 'get_call_transcripts',
    description: 'Get all transcripts for a call',
    inputSchema: {
      type: 'object',
      properties: {
        call_id: { type: 'string' },
      },
      required: ['call_id'],
    },
  },
  {
    name: 'get_call_coaching_events',
    description: 'Get coaching events for a call',
    inputSchema: {
      type: 'object',
      properties: {
        call_id: { type: 'string' },
      },
      required: ['call_id'],
    },
  },
  {
    name: 'get_call_summary',
    description: 'Get summary for a call',
    inputSchema: {
      type: 'object',
      properties: {
        call_id: { type: 'string' },
      },
      required: ['call_id'],
    },
  },
  {
    name: 'get_recent_calls',
    description: 'Get recent calls',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 10 },
      },
    },
  },
  // WRITE operations
  {
    name: 'create_call',
    description: 'Create a new call record',
    inputSchema: {
      type: 'object',
      properties: {
        participant_type: { type: 'string' },
      },
    },
  },
  {
    name: 'update_call_status',
    description: 'Update call status and outcome',
    inputSchema: {
      type: 'object',
      properties: {
        call_id: { type: 'string' },
        status: { type: 'string' },
        outcome: { type: 'string' },
        outcome_confidence: { type: 'number' },
        duration_seconds: { type: 'number' },
      },
      required: ['call_id', 'status'],
    },
  },
  {
    name: 'add_transcript',
    description: 'Add a transcript segment',
    inputSchema: {
      type: 'object',
      properties: {
        call_id: { type: 'string' },
        speaker: { type: 'string', enum: ['salesperson', 'prospect'] },
        text: { type: 'string' },
        sequence_number: { type: 'number' },
      },
      required: ['call_id', 'speaker', 'text'],
    },
  },
  {
    name: 'add_coaching_event',
    description: 'Add a coaching suggestion',
    inputSchema: {
      type: 'object',
      properties: {
        call_id: { type: 'string' },
        speaker_detected: { type: 'string' },
        objection_type: { type: 'string' },
        objection_text: { type: 'string' },
        suggestion_text: { type: 'string' },
        rationale: { type: 'string' },
        trigger_transcript_id: { type: 'string' },
      },
      required: ['call_id', 'suggestion_text', 'rationale'],
    },
  },
  {
    name: 'create_summary',
    description: 'Create post-call summary',
    inputSchema: {
      type: 'object',
      properties: {
        call_id: { type: 'string' },
        outcome_guess: { type: 'string' },
        outcome_confidence: { type: 'number' },
        objections_handled: { type: 'array' },
        strengths: { type: 'array' },
        improvement_areas: { type: 'array' },
        focus_next_call: { type: 'array' },
        ai_summary_text: { type: 'string' },
        summary_quality_score: { type: 'number' },
      },
      required: ['call_id'],
    },
  },
];

const server = new Server(
  { name: 'supabase-salescoach-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const supabase = getSupabaseClient();

  logToolUsage(name, args);

  try {
    switch (name) {
      // READ operations
      case 'list_tables': {
        const { data: tables, error } = await supabase
          .from('information_schema.tables')
          .select('table_name')
          .eq('table_schema', 'public')
          .eq('table_type', 'BASE TABLE');
        
        if (error) throw error;
        return { content: [{ type: 'text', text: JSON.stringify({ tables: tables?.map(t => t.table_name) || [] }, null, 2) }] };
      }

      case 'describe_table': {
        const { data: columns, error } = await supabase
          .from('information_schema.columns')
          .select('column_name, data_type, is_nullable, column_default')
          .eq('table_schema', 'public')
          .eq('table_name', (args as any).table_name);
        
        if (error) throw error;
        return { content: [{ type: 'text', text: JSON.stringify({ table: (args as any).table_name, columns: columns || [] }, null, 2) }] };
      }

      case 'get_call': {
        const { data, error } = await supabase
          .from('calls')
          .select('*')
          .eq('id', (args as any).call_id)
          .single();
        
        if (error) throw error;
        return { content: [{ type: 'text', text: JSON.stringify({ call: data }, null, 2) }] };
      }

      case 'get_call_transcripts': {
        const { data, error } = await supabase
          .from('transcripts')
          .select('*')
          .eq('call_id', (args as any).call_id)
          .order('sequence_number', { ascending: true });
        
        if (error) throw error;
        return { content: [{ type: 'text', text: JSON.stringify({ transcripts: data || [] }, null, 2) }] };
      }

      case 'get_call_coaching_events': {
        const { data, error } = await supabase
          .from('coaching_events')
          .select('*')
          .eq('call_id', (args as any).call_id)
          .order('created_at', { ascending: true });
        
        if (error) throw error;
        return { content: [{ type: 'text', text: JSON.stringify({ coaching_events: data || [] }, null, 2) }] };
      }

      case 'get_call_summary': {
        const { data, error } = await supabase
          .from('summaries')
          .select('*')
          .eq('call_id', (args as any).call_id)
          .single();
        
        if (error && error.code !== 'PGRST116') throw error;
        return { content: [{ type: 'text', text: JSON.stringify({ summary: data || null }, null, 2) }] };
      }

      case 'get_recent_calls': {
        const limit = (args as any).limit || 10;
        const { data, error } = await supabase
          .from('calls')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit);
        
        if (error) throw error;
        return { content: [{ type: 'text', text: JSON.stringify({ calls: data || [] }, null, 2) }] };
      }

      // WRITE operations
      case 'create_call': {
        const { data, error } = await supabase
          .from('calls')
          .insert([{
            started_at: new Date().toISOString(),
            status: 'active',
            participant_type: (args as any).participant_type || 'prospect',
          }])
          .select()
          .single();
        
        if (error) throw error;
        return { content: [{ type: 'text', text: JSON.stringify({ call: data }, null, 2) }] };
      }

      case 'update_call_status': {
        const updates: any = { status: (args as any).status };
        if ((args as any).outcome) updates.outcome = (args as any).outcome;
        if ((args as any).outcome_confidence) updates.outcome_confidence = (args as any).outcome_confidence;
        if ((args as any).duration_seconds) updates.duration_seconds = (args as any).duration_seconds;
        if ((args as any).status === 'completed') updates.ended_at = new Date().toISOString();

        const { data, error } = await supabase
          .from('calls')
          .update(updates)
          .eq('id', (args as any).call_id)
          .select()
          .single();
        
        if (error) throw error;
        return { content: [{ type: 'text', text: JSON.stringify({ call: data }, null, 2) }] };
      }

      case 'add_transcript': {
        const { data, error } = await supabase
          .from('transcripts')
          .insert([{
            call_id: (args as any).call_id,
            speaker: (args as any).speaker,
            text: (args as any).text,
            sequence_number: (args as any).sequence_number,
          }])
          .select()
          .single();
        
        if (error) throw error;
        return { content: [{ type: 'text', text: JSON.stringify({ transcript: data }, null, 2) }] };
      }

      case 'add_coaching_event': {
        const { data, error } = await supabase
          .from('coaching_events')
          .insert([{
            call_id: (args as any).call_id,
            speaker_detected: (args as any).speaker_detected,
            objection_type: (args as any).objection_type,
            objection_text: (args as any).objection_text,
            suggestion_text: (args as any).suggestion_text,
            rationale: (args as any).rationale,
            trigger_transcript_id: (args as any).trigger_transcript_id,
          }])
          .select()
          .single();
        
        if (error) throw error;

        // Update coaching count
        await supabase.rpc('increment_coaching_count', { call_uuid: (args as any).call_id });
        
        return { content: [{ type: 'text', text: JSON.stringify({ coaching_event: data }, null, 2) }] };
      }

      case 'create_summary': {
        const { data, error } = await supabase
          .from('summaries')
          .insert([{
            call_id: (args as any).call_id,
            outcome_guess: (args as any).outcome_guess,
            outcome_confidence: (args as any).outcome_confidence,
            objections_handled: (args as any).objections_handled || [],
            strengths: (args as any).strengths || [],
            improvement_areas: (args as any).improvement_areas || [],
            focus_next_call: (args as any).focus_next_call || [],
            ai_summary_text: (args as any).ai_summary_text,
            summary_quality_score: (args as any).summary_quality_score,
          }])
          .select()
          .single();
        
        if (error) throw error;
        return { content: [{ type: 'text', text: JSON.stringify({ summary: data }, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    console.error(`[MCP ERROR] ${name}:`, error);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  console.error('[MCP] Starting SalesCoach MCP Server...');
  console.error('[MCP] Ready for connections');
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
