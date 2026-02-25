/**
 * Server-side SalesCoach AI Service
 * Uses OpenAI API with 300ms timeout for <200ms responses
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = 'gpt-4o-mini';

interface TranscriptTurn {
  speaker: 'salesperson' | 'prospect';
  text: string;
  timestamp?: string;
}

export type Stage = 'Greeting' | 'Rapport' | 'Discovery' | 'Pain' | 'Impact' | 'Qualification' | 'Value' | 'Confusion' | 'Comparison' | 'Objection' | 'Hesitation' | 'Buy-Signal' | 'Close' | 'Logistics' | 'Stall';

export type ObjectionType = 'Price' | 'Timing' | 'Trust' | 'Authority' | 'Need' | 'Competition';

interface CoachingSuggestion {
  speaker: 'Prospect' | 'Salesperson' | 'Unclear';
  stage: Stage;
  objection_type?: ObjectionType | null;
  say_next: string;
  insight: string;
  confidence: number;
}

// Timeout wrapper - only returns fallback on actual timeout, throws on other errors
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let isTimeout = false;

  const timeoutPromise = new Promise<T>((_, reject) =>
    setTimeout(() => {
      isTimeout = true;
      reject(new Error('Timeout'));
    }, ms)
  );

  return Promise.race([promise, timeoutPromise]).catch((error) => {
    if (isTimeout) {
      return fallback;
    }
    // Re-throw non-timeout errors so they can be logged
    throw error;
  });
}

export async function generateLiveCoaching(
  recentTranscript: TranscriptTurn[],
  lastSpeaker: 'salesperson' | 'prospect'
): Promise<CoachingSuggestion> {
  const startTime = Date.now();
  const lastTurn = recentTranscript[recentTranscript.length - 1];

  if (!lastTurn) {
    return {
      speaker: 'Unclear',
      stage: 'Discovery',
      say_next: 'What brings you here today?',
      insight: 'Starting the conversation',
      confidence: 50
    };
  }

  // ALWAYS respond when prospect speaks
  const isProspectTurn = lastTurn.speaker === 'prospect';

  if (!OPENAI_API_KEY) {
    console.error("[AI Server] ❌ OPENAI_API_KEY missing!");
    return {
      speaker: 'Prospect',
      stage: 'Discovery',
      say_next: isProspectTurn ? "Tell me more about what you're looking for." : "",
      insight: 'API Key missing - using fallback',
      confidence: 50
    };
  }

  // Build context - last 10 turns for better conversational awareness
  // Filter out turns with empty or undefined text to prevent API errors
  const validTurns = recentTranscript
    .slice(-10)
    .filter(t => t.text && t.text.trim().length > 0);

  const transcriptText = validTurns.length > 0
    ? validTurns.map(t => `${t.speaker.toUpperCase()}: "${t.text}"`).join('\n')
    : 'No transcript available yet.';

  const fallbackResponse: CoachingSuggestion = {
    speaker: 'Prospect',
    stage: 'Discovery',
    say_next: "That's interesting. Can you tell me more about your current situation?",
    insight: 'API timeout - using fallback',
    confidence: 60
  };


  try {
    // Prepare the request payload
    const requestPayload = {
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: `Expert sales coach. Categorize into one of 15 stages: Greeting, Rapport, Discovery, Pain, Impact, Qualification, Value, Confusion, Comparison, Objection, Hesitation, Buy-Signal, Close, Logistics, Stall.
Provide deep, strategic tactical advice. ALWAYS provide a detailed 'insight' (at least 2 sentences) explaining the psychological reason WHY this response is the most effective.
JSON: {speaker, stage, objection_type, say_next, insight, confidence}`
        },
        {
          role: 'user',
          content: `TRANSCRIPT:\n${transcriptText}\n\nWhat should the salesperson say next? Identify the stage and provide the exact words to speak.`
        },
      ],
      temperature: 0.4, // Increased from 0.1 to allow for more natural, varied responses
      max_tokens: 300,
      response_format: { type: 'json_object' },
    };


    const apiPromise = fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(requestPayload),
    }).then(async (response) => {
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[AI Server] API Error Response:', errorText);
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }
      const data = await response.json();
      const content = data.choices[0].message.content;

      let result: CoachingSuggestion;
      try {
        result = JSON.parse(content) as CoachingSuggestion;
      } catch (parseError) {
        console.error('[AI Server] JSON parse error:', parseError);
        console.error('[AI Server] Failed content:', content);
        // Try to extract values from malformed JSON
        const sayNextMatch = content.match(/"say_next"\s*:\s*"([^"]+)"/);
        const insightMatch = content.match(/"insight"\s*:\s*"([^"]+)"/);
        const stageMatch = content.match(/"stage"\s*:\s*"([^"]+)"/);

        result = {
          speaker: isProspectTurn ? 'Prospect' : 'Salesperson',
          stage: (stageMatch?.[1] as Stage) || 'Discovery',
          objection_type: null,
          say_next: sayNextMatch?.[1] || "I hear you. Can you tell me more about that?",
          insight: insightMatch?.[1] || 'Listen to understand their perspective',
          confidence: 75
        };
      }

      // Ensure we always have a say_next for any turn
      if (!result.say_next || result.say_next.trim().length < 5) {
        result.say_next = isProspectTurn
          ? "That's interesting. Help me understand your situation better."
          : "Acknowledge them and ask one clarifying question.";
        result.insight = result.insight || 'Fallback because AI returned empty say_next';
      }

      return result;
    }).catch(err => {
      console.error('[AI Server] Fetch error:', err);
      throw err;
    });

    // Wait max 4000ms for API response - must be less than client timeout
    let result = await withTimeout(apiPromise, 4000, fallbackResponse);
    const elapsed = Date.now() - startTime;

    // FORCE non-empty say_next for any turn
    const needsFallback = !result.say_next || result.say_next.trim().length < 5;
    if (needsFallback) {
      result = {
        speaker: isProspectTurn ? 'Prospect' : 'Salesperson',
        stage: result.stage || 'Discovery',
        objection_type: result.objection_type || null,
        say_next: isProspectTurn
          ? "I hear you. Can you tell me more about that?"
          : "Acknowledge and ask one follow-up to keep them talking.",
        insight: result.insight || 'Fallback: Response too short',
        confidence: result.confidence || 65
      };
    }

    return result;

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[AI Server] ❌ Error after ${elapsed}ms:`, error);
    // Return fallback
    return {
      speaker: isProspectTurn ? 'Prospect' : 'Salesperson',
      stage: 'Discovery',
      say_next: isProspectTurn
        ? "That's interesting. Can you tell me more about that?"
        : "Acknowledge and ask a clarifying question.",
      insight: 'API error - using fallback',
      confidence: 60
    };
  }
}

/**
 * NEW: Streaming version of generateLiveCoaching for <1s perceived latency
 * Returns a ReadableStream that yields chunks of the response
 */
export async function generateLiveCoachingStream(
  recentTranscript: TranscriptTurn[],
  lastSpeaker: 'salesperson' | 'prospect'
) {
  if (!OPENAI_API_KEY) {
    throw new Error('Streaming failed: API Key missing');
  }

  const validTurns = recentTranscript
    .slice(-10)
    .filter(t => t.text && t.text.trim().length > 0);

  const transcriptText = validTurns.length > 0
    ? validTurns.map(t => `${t.speaker.toUpperCase()}: "${t.text}"`).join('\n')
    : 'No transcript available yet.';

  const requestPayload = {
    model: OPENAI_MODEL,
    messages: [
      {
        role: 'system',
        content: `Expert sales coach. Categorize into one of 15 stages: Greeting, Rapport, Discovery, Pain, Impact, Qualification, Value, Confusion, Comparison, Objection, Hesitation, Buy-Signal, Close, Logistics, Stall.
Provide deep, strategic advice. 
IMPORTANT: Your 'INSIGHT' must be at least 25 words or two full sentences explaining the tactical edge of your advice.
DO NOT wrap your response in quotes.
FORMAT YOUR RESPONSE EXACTLY LIKE THIS (include the labels):
STAGE: [Stage Name]
INSIGHT: [A detailed strategic reasoning explaining WHY this response is the most tactical choice here. Focus on psychological impact. At least 2 sentences.]
SAY_NEXT: [The exact words to speak]`
      },
      {
        role: 'user',
        content: `TRANSCRIPT:\n${transcriptText}\n\nWhat should the salesperson say next?`
      },
    ],
    temperature: 0.4,
    max_tokens: 300,
    stream: true, // ENABLE STREAMING
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(requestPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[AI Stream Server] API Error:', errorText);
    throw new Error(`API Error ${response.status}`);
  }

  return response.body; // Relay the OpenAI stream to the API route
}

export async function generatePostCallSummary(transcript: TranscriptTurn[]) {
  // MANDATORY SAFETY GUARDS
  if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
    console.log('[Summary AI] 🛡️ Guard triggered: No transcript data');
    return {
      outcome: {
        result: "No transcript captured",
        confidence_score: 0,
        primary_blocker: "Missing data",
        overall_tone: "N/A"
      },
      highlights: "No audio or transcript data available.",
      next_focus: "Restart session and confirm audio capture.",
      objections: [],
      prospect_signals: {
        buying_signals: [],
        curiosity_signals: [],
        resistance_signals: [],
        tone_shift_detected: false
      },
      salesperson_performance: {
        strengths: ["Waiting for data"],
        weaknesses: ["No data captured"],
        missed_opportunities: [],
        control_score: 0
      },
      improvement_focus: {
        better_phrase_example: "N/A",
        objection_handling_upgrade: "Restart session and confirm audio capture.",
        recommended_next_action: "Ensure microphone and tab audio sharing are active."
      }
    };
  }

  if (!OPENAI_API_KEY) {
    console.error("[Summary AI] ❌ OPENAI_API_KEY missing!");
    return {
      outcome: { result: "Error", confidence_score: 0, primary_blocker: "API Key Missing", overall_tone: "Neutral" },
      highlights: "AI services unavailable.",
      next_focus: "Check server configuration.",
      objections: [],
      prospect_signals: { buying_signals: [], curiosity_signals: [], resistance_signals: [], tone_shift_detected: false },
      salesperson_performance: { strengths: [], weaknesses: [], missed_opportunities: [], control_score: 0 },
      improvement_focus: { better_phrase_example: "", objection_handling_upgrade: "Configure API Key", recommended_next_action: "Contact support" }
    };
  }

  // OPTIONAL: Lightweight summary for very short calls
  const isShortCall = transcript.length < 3;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{
          role: 'system',
          content: `You are a senior sales performance analyst.
          Analyze this full sales call transcript.
          
          Do NOT summarize generically.
          Extract behavioral patterns.
          Identify objections.
          Detect buying signals.
          Score salesperson performance.
          Identify missed opportunities.
          Provide specific improvement suggestions.
          Assign a realistic confidence score.
          
          Return EXACTLY this JSON structure:
          {
            "outcome": {
              "result": "Interested | Objection | Neutral | Lost",
              "confidence_score": 0-100,
              "primary_blocker": "string",
              "overall_tone": "string"
            },
            "objections": [
              {
                "type": "string",
                "handled": "Yes | Partial | No",
                "reasoning": "string"
              }
            ],
            "prospect_signals": {
              "buying_signals": ["string"],
              "curiosity_signals": ["string"],
              "resistance_signals": ["string"],
              "tone_shift_detected": boolean
            },
            "salesperson_performance": {
              "strengths": ["string"],
              "weaknesses": ["string"],
              "missed_opportunities": ["string"],
              "control_score": 0-10
            },
            "improvement_focus": {
              "better_phrase_example": "string",
              "objection_handling_upgrade": "string",
              "recommended_next_action": "string"
            }
          }`
        }, {
          role: 'user',
          content: `SESSION_TRANSCRIPT: ${JSON.stringify(transcript.map(t => ({
            speaker: t.speaker || 'Unknown',
            text: t.text || ''
          })))}`
        }],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      }),
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

    // NESTED NULL GUARDS & DEFAULTS
    const safeResult = {
      outcome: {
        result: result?.outcome?.result || (isShortCall ? "Neutral" : "Uncertain"),
        confidence_score: Number(result?.outcome?.confidence_score) || (isShortCall ? 30 : 50),
        primary_blocker: result?.outcome?.primary_blocker || "None identified",
        overall_tone: result?.outcome?.overall_tone || "Neutral"
      },
      objections: Array.isArray(result?.objections) ? result.objections.map((obj: any) => ({
        type: String(obj?.type || "General"),
        handled: String(obj?.handled || "No"),
        reasoning: String(obj?.reasoning || "N/A")
      })) : [],
      prospect_signals: {
        buying_signals: Array.isArray(result?.prospect_signals?.buying_signals) ? result.prospect_signals.buying_signals : [],
        curiosity_signals: Array.isArray(result?.prospect_signals?.curiosity_signals) ? result.prospect_signals.curiosity_signals : [],
        resistance_signals: Array.isArray(result?.prospect_signals?.resistance_signals) ? result.prospect_signals.resistance_signals : [],
        tone_shift_detected: Boolean(result?.prospect_signals?.tone_shift_detected)
      },
      salesperson_performance: {
        strengths: (Array.isArray(result?.salesperson_performance?.strengths) && result.salesperson_performance.strengths.length > 0)
          ? result.salesperson_performance.strengths
          : ["Call completed"],
        weaknesses: (Array.isArray(result?.salesperson_performance?.weaknesses) && result.salesperson_performance.weaknesses.length > 0)
          ? result.salesperson_performance.weaknesses
          : ["N/A"],
        missed_opportunities: Array.isArray(result?.salesperson_performance?.missed_opportunities) ? result.salesperson_performance.missed_opportunities : [],
        control_score: Number(result?.salesperson_performance?.control_score) || 5
      },
      improvement_focus: {
        better_phrase_example: String(result?.improvement_focus?.better_phrase_example || ""),
        objection_handling_upgrade: String(result?.improvement_focus?.objection_handling_upgrade || ""),
        recommended_next_action: String(result?.improvement_focus?.recommended_next_action || "Follow up")
      }
    };

    return safeResult;
  } catch (error) {
    console.error('[Summary AI] ❌ Critical failure during generation:', error);
    // NEVER throw runtime errors - return valid fallback structure
    return {
      outcome: { result: "Error", confidence_score: 0, primary_blocker: "Generation failed", overall_tone: "Neutral" },
      objections: [],
      prospect_signals: { buying_signals: [], curiosity_signals: [], resistance_signals: [], tone_shift_detected: false },
      salesperson_performance: { strengths: ["Call completed"], weaknesses: [], missed_opportunities: [], control_score: 5 },
      improvement_focus: { better_phrase_example: "", objection_handling_upgrade: "Service momentarily unavailable", recommended_next_action: "Please retry later" }
    };
  }
}
