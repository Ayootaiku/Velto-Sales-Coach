import { NextResponse } from 'next/server';
import { 
  processTranscriptUltraFast,
  generateAIEnhancedCoaching,
  checkAudioHealth,
  generatePostCallSummary,
  type TranscriptTurn,
  type CoachingResponse
} from '@/lib/salescoach-copilot';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * POST /api/coach/realtime
 * 
 * Ultra-fast real-time coaching - returns in < 100ms
 * Only coaches when prospect speaks (salesperson-first)
 */
export async function POST(request: Request) {
  const startTime = Date.now();
  
  try {
    const body = await request.json();
    const { 
      turn, 
      previousTurns = [], 
      callId,
      isListening = true
    } = body;

    // Validate
    if (!turn || !turn.text) {
      return NextResponse.json(
        { error: 'Missing transcript', received: body },
        { status: 400 }
      );
    }

    // Check audio health
    const audioHealth = checkAudioHealth(Date.now() - (turn.timestamp || 0), isListening);
    
    if (audioHealth.status === 'ERROR') {
      return NextResponse.json({
        stage: 'Logistics',
        say_next: '',
        insight: audioHealth.message || 'Check microphone',
        confidence: 0,
        audioHealth,
        processingTime: Date.now() - startTime
      });
    }

    // Ultra-fast local processing (no API calls)
    const coaching = processTranscriptUltraFast(turn as TranscriptTurn, previousTurns as TranscriptTurn[]);
    
    // If no coaching needed (e.g., salesperson speaking normally)
    if (!coaching) {
      return NextResponse.json({
        stage: 'Discovery',
        say_next: '',
        insight: 'Listening...',
        confidence: 0,
        coaching: null,
        audioHealth,
        processingTime: Date.now() - startTime
      });
    }

    // Store in background (fire and forget)
    if (callId) {
      void supabase.from('transcripts').insert({
        call_id: callId,
        speaker: turn.speaker,
        text: turn.text,
        sequence_number: previousTurns.length
      });
      
      if (coaching.confidence > 60) {
        void supabase.from('coaching_events').insert({
          call_id: callId,
          objection_type: coaching.stage,
          suggestion_text: coaching.say_next,
          rationale: coaching.insight
        });
      }
    }

    return NextResponse.json({
      ...coaching,
      audioHealth,
      processingTime: Date.now() - startTime
    });

  } catch (error: any) {
    console.error('[Realtime Coaching Error]', error);
    return NextResponse.json(
      { 
        stage: 'Logistics',
        say_next: '',
        insight: 'Processing...',
        confidence: 0,
        error: error.message,
        processingTime: Date.now() - startTime
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/coach/realtime - Health check
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'ultra-realtime-coach',
    version: '2.0.0',
    latency_target: '< 100ms',
    timestamp: new Date().toISOString()
  });
}