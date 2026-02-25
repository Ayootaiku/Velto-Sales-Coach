import { NextResponse } from 'next/server';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

interface TranscriptTurn {
  speaker: 'salesperson' | 'prospect';
  text: string;
}

interface CoachingResponse {
  speaker: 'Prospect' | 'Salesperson' | 'Unclear';
  stage: string;
  say_next: string;
  coach_insight: string;
  confidence: number;
}

export async function POST(request: Request) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    const { 
      transcript, 
      lastSpeaker,
      callHistory = [],
      repHistory = []
    } = await request.json();

    if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
      return NextResponse.json(
        { error: 'No transcript provided' },
        { status: 400 }
      );
    }

    const lastTurn = transcript[transcript.length - 1];
    
    // Build conversation context
    const conversationContext = transcript
      .slice(-5)
      .map((t: TranscriptTurn) => `${t.speaker}: "${t.text}"`)
      .join('\n');

    // Build rep history context (if available)
    const repContext = repHistory.length > 0 
      ? `\n\nREP PERFORMANCE HISTORY:\n- Past calls: ${repHistory.length}\n- Common issue: ${repHistory[0]?.issue || 'None'}\n- Strength: ${repHistory[0]?.strength || 'None'}`
      : '';

    const prompt = `You are an elite sales coach AI. Analyze this conversation turn and provide IMMEDIATE coaching.

CONVERSATION HISTORY (last 5 turns):
${conversationContext}
${repContext}

LAST UTTERANCE:
Speaker: ${lastTurn.speaker}
Text: "${lastTurn.text}"

RULES:
1. Identify WHO spoke: Prospect (client) or Salesperson (user being coached)
2. Identify STAGE/INTENT: Greeting, Discovery, Objection:Price, Objection:Timing, Competitor, Close, Logistics, Hesitation, SmallTalk
3. Provide EXACT words the salesperson should say NEXT (natural, conversational)
4. Give 1-sentence micro-insight on why + what to do next
5. If prospect spoke → tell salesperson what to say
6. If salesperson spoke → evaluate and give next step or better alternative
7. DO NOT coach filler words ("um", "ah") unless they indicate hesitation
8. Be IMMEDIATE and ACTIONABLE

OUTPUT JSON:
{
  "speaker": "Prospect|Salesperson|Unclear",
  "stage": "Greeting|Discovery|Objection:Price|Objection:Timing|Competitor|Close|Logistics|Hesitation|SmallTalk",
  "say_next": "Exact words to speak next (if prospect spoke) or evaluation + next step (if salesperson spoke)",
  "coach_insight": "One short sentence: why this works + what to watch for",
  "confidence": 0.0-1.0
}

Examples:
- Prospect: "Hi" → Stage: Greeting → Say: "Hey — great to meet you. Quick one: what made you take the call today?" → Insight: "Opens discovery immediately"
- Prospect: "Um..." → Stage: Hesitation → Say: "No rush — what's on your mind?" → Insight: "Creates space, keeps control"
- Salesperson: "Our product is great" → Stage: Discovery → Say: "Instead of features, try: 'What would success look like for you in 3 months?'" → Insight: "Shift from pitching to understanding"
- Prospect: "Too expensive" → Stage: Objection:Price → Say: "I hear you. If price wasn't a factor, would this solve your problem?" → Insight: "Isolates true objection from price"`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { 
            role: 'system', 
            content: 'You are a real-time sales coach. Be immediate, specific, and actionable. Never give generic advice. Focus on the exact next words to say.' 
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500,
        temperature: 0.4,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Coach API] OpenAI error:', response.status, errorText);
      return NextResponse.json(
        { error: 'AI service error' },
        { status: 500 }
      );
    }

    const data = await response.json();
    const coaching: CoachingResponse = JSON.parse(data.choices[0].message.content);

    return NextResponse.json(coaching);

  } catch (error: any) {
    console.error('[Coach API Error]', error);
    return NextResponse.json(
      { error: error.message || 'Coaching generation failed' },
      { status: 500 }
    );
  }
}
