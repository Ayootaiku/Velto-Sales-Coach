import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Create client lazily
const getSupabase = () => {
    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase environment variables are missing');
    }
    return createClient(supabaseUrl, supabaseKey);
};

/**
 * Save post-call summary to Supabase
 */
export async function POST(req: NextRequest) {
    try {
        const { session_id, summary, transcripts } = await req.json();

        if (!session_id || !summary) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Store summary
        const supabase = getSupabase();
        const { data: summaryData, error: summaryError } = await supabase
            .from('summaries')
            .insert({
                call_id: session_id,
                outcome_guess: summary.outcome_guess,
                outcome_confidence: summary.outcome_confidence,
                objections_handled: summary.objections_handled,
                strengths: summary.strengths,
                improvement_areas: summary.improvement_areas,
                focus_next_call: summary.focus_next_call,
                ai_summary_text: summary.ai_summary_text,
                summary_quality_score: summary.summary_quality_score,
            })
            .select()
            .single();

        if (summaryError) {
            console.error('[Summary Save] Supabase error:', summaryError);
            throw summaryError;
        }

        // Optionally store transcripts if provided
        if (transcripts && transcripts.length > 0) {
            const transcriptRecords = transcripts.map((t: any, index: number) => ({
                call_id: session_id,
                speaker: t.speaker,
                text: t.text,
                sequence_number: index,
                confidence_score: 1.0,
            }));

            const { error: transcriptError } = await getSupabase()
                .from('transcripts')
                .insert(transcriptRecords);

            if (transcriptError) {
                console.error('[Summary Save] Transcript save error:', transcriptError);
                // Don't fail the whole request if transcript save fails
            }
        }

        console.log('[Summary Save] Success:', summaryData);
        return NextResponse.json({ success: true, data: summaryData });

    } catch (error: any) {
        console.error('[Summary Save API Error]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to save summary' },
            { status: 500 }
        );
    }
}
