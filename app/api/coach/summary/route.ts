import { NextResponse } from 'next/server';
import { generatePostCallSummary } from '@/lib/salescoach-ai-server';
import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

interface TranscriptTurn {
  speaker: 'salesperson' | 'prospect';
  text: string;
  timestamp?: string;
}

// Safe fallback summary when everything fails
const createSafeFallback = () => ({
  outcome: {
    result: "Follow up",
    confidence_score: 50,
    primary_blocker: "N/A",
    overall_tone: "Neutral"
  },
  salesperson_performance: {
    strengths: ["Call completed"],
    weaknesses: ["N/A"],
    missed_opportunities: [],
    control_score: 5
  },
  improvement_focus: {
    better_phrase_example: "",
    objection_handling_upgrade: "Continue practicing active listening.",
    recommended_next_action: "Schedule follow-up"
  },
  objections: [],
  prospect_signals: {
    buying_signals: [],
    curiosity_signals: [],
    resistance_signals: [],
    tone_shift_detected: false
  }
});

/**
 * POST /api/coach/summary
 * 
 * Generate and store post-call summary
 */
export async function POST(request: Request) {
  console.log('[Summary API] Received POST request');

  try {
    const body = await request.json();
    console.log('[Summary API] Request body received:', {
      hasCallId: !!body.callId,
      transcriptCount: body.transcripts?.length
    });

    const { callId, transcripts } = body;

    if (!transcripts || !Array.isArray(transcripts) || transcripts.length === 0) {
      console.log('[Summary API] Guard: Empty transcript');
      return NextResponse.json(createSafeFallback(), { headers: CORS_HEADERS });
    }

    // Generate summary using AI with timeout
    const summaryPromise = generatePostCallSummary(transcripts as TranscriptTurn[]);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Summary generation timeout')), 25000)
    );

    let summary: any;
    try {
      summary = await Promise.race([summaryPromise, timeoutPromise]);
    } catch (timeoutErr) {
      console.error('[Summary API] Generation timed out, using fallback');
      summary = createSafeFallback();
    }

    // MAP RICH DATA TO EXISTING SUPABASE COLUMNS (Backward Compatibility)
    const dbSummary = {
      outcome_guess: summary?.outcome?.result || "Unknown",
      outcome_confidence: summary?.outcome?.confidence_score || 50,
      objections_handled: Array.isArray(summary?.objections)
        ? summary.objections.map((o: any) => ({ type: o.type, handled_well: o.handled === "Yes" }))
        : [],
      strengths: summary?.salesperson_performance?.strengths || ["Call completed"],
      improvement_areas: summary?.salesperson_performance?.weaknesses || ["Continue practicing"],
      focus_next_call: [summary?.improvement_focus?.recommended_next_action || "Follow up"],
      ai_summary_text: summary?.improvement_focus?.objection_handling_upgrade || "No detailed summary text available",
      summary_quality_score: summary?.salesperson_performance?.control_score * 10 || 50
    };

    if (callId && supabase) {
      try {
        const { error: summaryError } = await supabase
          .from('summaries')
          .insert({
            call_id: callId,
            outcome_guess: dbSummary.outcome_guess,
            outcome_confidence: dbSummary.outcome_confidence,
            objections_handled: dbSummary.objections_handled,
            strengths: dbSummary.strengths,
            improvement_areas: dbSummary.improvement_areas,
            focus_next_call: dbSummary.focus_next_call,
            ai_summary_text: dbSummary.ai_summary_text,
            summary_quality_score: dbSummary.summary_quality_score,
          });

        if (summaryError) {
          console.error('[Summary API] Failed to store summary:', summaryError);
        } else {
          console.log('[Summary API] Summary stored successfully for call:', callId);
        }

        // Update call status to completed (best effort)
        await supabase
          .from('calls')
          .update({
            status: 'completed',
            outcome: dbSummary.outcome_guess,
            outcome_confidence: dbSummary.outcome_confidence / 100, // DB expects decimal
            ended_at: new Date().toISOString(),
          })
          .eq('id', callId);
      } catch (dbError) {
        console.error('[Summary API] Database error (non-fatal):', dbError);
      }
    }

    return NextResponse.json(summary, { headers: CORS_HEADERS });

  } catch (error: any) {
    console.error('[Summary API Error]', error);
    return NextResponse.json(createSafeFallback(), { headers: CORS_HEADERS });
  }
}