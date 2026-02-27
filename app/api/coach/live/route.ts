import { NextResponse } from 'next/server';
import { generateLiveCoaching, generateLiveCoachingStream } from '@/lib/salescoach-ai-server';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const start = Date.now();
    const body = await request.json();
    const { transcript, lastSpeaker, settings } = body;

    if (!transcript || !Array.isArray(transcript)) {
      return NextResponse.json(
        { error: 'Invalid transcript data' },
        { status: 400 }
      );
    }

    // Filter out invalid transcript turns before processing
    const validTranscript = transcript.filter(
      (t: any) => t && t.text && typeof t.text === 'string' && t.text.trim().length > 0
    );

    if (validTranscript.length === 0) {
      return NextResponse.json({
        speaker: 'Prospect',
        stage: 'Discovery',
        say_next: "What brings you here today?",
        insight: 'Waiting for valid transcript',
        confidence: 50
      });
    }

    if (body.stream) {
      const stream = await generateLiveCoachingStream(validTranscript, lastSpeaker || 'prospect', settings);
      return new Response(stream, {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    let coaching = await generateLiveCoaching(validTranscript, lastSpeaker || 'prospect', settings);

    // FORCE non-empty say_next for any turn
    const lastTurn = transcript[transcript.length - 1];
    const needsFallback = !coaching.say_next || coaching.say_next.trim().length < 5;
    if (needsFallback) {
      const isProspect = lastTurn?.speaker === 'prospect';
      coaching = {
        ...coaching,
        say_next: isProspect
          ? "I hear you. Can you tell me more about that?"
          : "Acknowledge and ask one follow-up to keep them talking.",
        insight: coaching.insight || 'Fallback because AI response was empty',
        confidence: coaching.confidence || 65
      };
    }


    return NextResponse.json(coaching, { headers: CORS_HEADERS });
  } catch (error: any) {
    console.error('[Live Coaching API Error]', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate coaching' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
