import { NextResponse } from 'next/server';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o';

type Input = {
  transcript: string;
  context: Record<string, any>;
  sessionId?: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input: Input = {
      transcript: body.transcript ?? '',
      context: body.context ?? {},
      sessionId: body.sessionId
    };

    // If OpenAI key is present, attempt real API call
    if (OPENAI_API_KEY && OPENAI_API_KEY.startsWith('sk-')) {
      try {
        const systemPrompt = `You are an expert sales coach AI. Analyze the sales conversation transcript and provide actionable coaching.

Respond with a JSON object in this exact format:
{
  "objections": [
    {
      "type": "price|timing|value|competitor|trust|authority|other",
      "text": "The actual objection text from the conversation",
      "severity": "high|medium|low"
    }
  ],
  "recommendations": [
    {
      "type": "response|question|reframe|clarify",
      "text": "The exact response the salesperson should say",
      "rationale": "Why this response works - the psychology/strategy behind it"
    }
  ],
  "insights": [
    "Key insight about the prospect's mindset",
    "Strategic recommendation for moving forward"
  ]
}

Rules:
1. objections array must have at least 1 item if any objection detected
2. recommendations array must have at least 1 response for each objection
3. insights array must have 1-2 key insights
4. text fields should be natural, conversational responses a salesperson can say word-for-word
5. rationale should explain the psychology/sales strategy`;

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Analyze this sales conversation transcript and provide coaching:\n\n${input.transcript}` }
            ],
            max_tokens: 1500,
            temperature: 0.3,
            response_format: { type: 'json_object' }
          })
        });

        if (res.ok) {
          const data = await res.json();
          const content = data?.choices?.[0]?.message?.content ?? '';
          
          try {
            const parsed = JSON.parse(content);
            
            // Validate structure
            if (!parsed.objections || !Array.isArray(parsed.objections)) {
              parsed.objections = [];
            }
            if (!parsed.recommendations || !Array.isArray(parsed.recommendations)) {
              parsed.recommendations = [];
            }
            if (!parsed.insights || !Array.isArray(parsed.insights)) {
              parsed.insights = [];
            }
            
            return NextResponse.json(parsed);
          } catch (parseError) {
            console.error('Failed to parse OpenAI response:', content);
            return NextResponse.json({ 
              errors: ['Invalid JSON from AI'], 
              objections: [],
              recommendations: [],
              insights: ['AI response parsing failed']
            }, { status: 500 });
          }
        } else {
          const errText = await res.text();
          console.error('OpenAI API error:', errText);
          return NextResponse.json({ 
            errors: ['OpenAI API error'], 
            details: errText,
            objections: [],
            recommendations: [],
            insights: []
          }, { status: res.status });
        }
      } catch (e) {
        console.error('OpenAI call failed:', e);
        // Return empty but valid structure on error
        return NextResponse.json({
          objections: [],
          recommendations: [],
          insights: ['AI analysis temporarily unavailable']
        });
      }
    } else {
      // No API key - return empty structure
      console.log('No OpenAI API key configured');
      return NextResponse.json({
        objections: [],
        recommendations: [],
        insights: ['Add OPENAI_API_KEY to .env.local for AI-powered insights']
      });
    }
  } catch (err) {
    console.error('Request processing error:', err);
    return NextResponse.json({ 
      errors: ['Invalid request'], 
      details: String(err),
      objections: [],
      recommendations: [],
      insights: []
    }, { status: 400 });
  }
}
