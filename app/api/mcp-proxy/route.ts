import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: Request) {
  try {
    const { tool, args } = await request.json();

    // Log tool usage
    console.log(`[MCP Proxy] Tool: ${tool}`, args);

    let result;

    switch (tool) {
      case 'create_call': {
        const { data, error } = await supabase
          .from('calls')
          .insert([{
            started_at: new Date().toISOString(),
            status: 'active',
            participant_type: args.participant_type || 'prospect',
          }])
          .select()
          .single();
        
        if (error) throw error;
        result = { call: data };
        break;
      }

      case 'update_call_status': {
        const updates: any = { status: args.status };
        if (args.outcome) updates.outcome = args.outcome;
        if (args.outcome_confidence) updates.outcome_confidence = args.outcome_confidence;
        if (args.duration_seconds) updates.duration_seconds = args.duration_seconds;
        if (args.status === 'completed') updates.ended_at = new Date().toISOString();

        const { data, error } = await supabase
          .from('calls')
          .update(updates)
          .eq('id', args.call_id)
          .select()
          .single();
        
        if (error) throw error;
        result = { call: data };
        break;
      }

      case 'add_transcript': {
        const { data, error } = await supabase
          .from('transcripts')
          .insert([{
            call_id: args.call_id,
            speaker: args.speaker,
            text: args.text,
            sequence_number: args.sequence_number,
          }])
          .select()
          .single();
        
        if (error) throw error;
        result = { transcript: data };
        break;
      }

      case 'add_coaching_event': {
        const { data, error } = await supabase
          .from('coaching_events')
          .insert([{
            call_id: args.call_id,
            speaker_detected: args.speaker_detected,
            objection_type: args.objection_type,
            objection_text: args.objection_text,
            suggestion_text: args.suggestion_text,
            rationale: args.rationale,
            trigger_transcript_id: args.trigger_transcript_id,
          }])
          .select()
          .single();
        
        if (error) throw error;

        // Update coaching count
        await supabase.rpc('increment_coaching_count', { call_uuid: args.call_id });
        
        result = { coaching_event: data };
        break;
      }

      case 'create_summary': {
        const { data, error } = await supabase
          .from('summaries')
          .insert([{
            call_id: args.call_id,
            outcome_guess: args.outcome_guess,
            outcome_confidence: args.outcome_confidence,
            objections_handled: args.objections_handled || [],
            strengths: args.strengths || [],
            improvement_areas: args.improvement_areas || [],
            focus_next_call: args.focus_next_call || [],
            ai_summary_text: args.ai_summary_text,
            summary_quality_score: args.summary_quality_score,
          }])
          .select()
          .single();
        
        if (error) throw error;
        result = { summary: data };
        break;
      }

      case 'get_call_transcripts': {
        const { data, error } = await supabase
          .from('transcripts')
          .select('*')
          .eq('call_id', args.call_id)
          .order('sequence_number', { ascending: true });
        
        if (error) throw error;
        result = { transcripts: data || [] };
        break;
      }

      case 'get_call_coaching_events': {
        const { data, error } = await supabase
          .from('coaching_events')
          .select('*')
          .eq('call_id', args.call_id)
          .order('created_at', { ascending: true });
        
        if (error) throw error;
        result = { coaching_events: data || [] };
        break;
      }

      case 'get_call_summary': {
        const { data, error } = await supabase
          .from('summaries')
          .select('*')
          .eq('call_id', args.call_id)
          .single();
        
        if (error && error.code !== 'PGRST116') throw error;
        result = { summary: data || null };
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown tool: ${tool}` }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[MCP Proxy Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
