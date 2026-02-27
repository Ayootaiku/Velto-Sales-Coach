/**
 * Ultra Real-Time SalesCoach Copilot
 * Salesperson-first, prospect-triggered, sub-second coaching
 * 
 * CORE PRINCIPLES:
 * 1. Salesperson is ALWAYS the user - never show what they said
 * 2. Coach ONLY when prospect speaks (they need the next line)
 * 3. Filter filler words (um, uh) - don't coach on noise
 * 4. Sliding window: only last 5-8 turns for speed
 * 5. Draft + Final: show interim results immediately, refine on final
 * 6. JSON-only output: { stage, say_next, insight, confidence }
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Types - Strict JSON format
export interface CoachingResponse {
  stage: Stage;
  say_next: string;
  insight: string;
  confidence: number; // 0-100
}

export type Stage =
  | 'Greeting'
  | 'Discovery'
  | 'Hesitation'
  | 'Objection:Price'
  | 'Objection:Timing'
  | 'Objection:Authority'
  | 'Objection:Value'
  | 'Objection:Need'
  | 'Competitor'
  | 'Close'
  | 'Logistics';

export interface TranscriptTurn {
  speaker: 'salesperson' | 'prospect';
  text: string;
  timestamp: number;
  isFinal: boolean;
}

// STRICT FILLER FILTER - Don't coach on these
const FILLER_WORDS = new Set([
  'um', 'uh', 'er', 'ah', 'hm', 'mm',
  'like', 'you know', 'i mean', 'sort of', 'kind of',
  'well', 'so', 'okay', 'right', 'yeah'
]);

// Stage detection keywords
const STAGE_PATTERNS: Record<Stage, RegExp[]> = {
  'Greeting': [/\b(hi|hello|hey|good morning|good afternoon)\b/i],
  'Discovery': [/\b(what|how|why|tell me|explain|describe)\b/i, /\?$/],
  'Hesitation': [/\b(um|uh|let me think|not sure|maybe|probably|i guess)\b/i],
  'Objection:Price': [/\b(price|cost|expensive|budget|too much|money|afford)\b/i],
  'Objection:Timing': [/\b(not now|later|next quarter|too soon|not ready|delay)\b/i],
  'Objection:Authority': [/\b(boss|manager|decision|approve|committee|need to ask)\b/i],
  'Objection:Value': [/\b(worth|value|roi|benefit|difference|impact)\b/i],
  'Objection:Need': [/\b(not interested|not intersted|dont want|don\'t want|no thanks|not for me|not a fit|no need|dont need|don\'t need)\b/i],
  'Competitor': [/\b(competitor|competition|using|already have|vendor|alternative)\b/i],
  'Close': [/\b(sign|contract|agreement|move forward|get started|buy|proceed)\b/i],
  'Logistics': [/\b(schedule|calendar|meeting|demo|trial|pilot|implement)\b/i],
};

// Cached responses for speed
const RESPONSE_CACHE = new Map<string, CoachingResponse>();

/**
 * Check if text is pure filler - skip coaching if true
 */
function isPureFiller(text: string): boolean {
  const words = text.toLowerCase().trim().split(/\s+/);
  if (words.length === 0) return true;
  if (words.length === 1 && FILLER_WORDS.has(words[0])) return true;
  if (words.length <= 2 && words.every(w => FILLER_WORDS.has(w))) return true;
  return false;
}

/**
 * Detect stage from text - fast pattern matching
 */
function detectStage(text: string): Stage {
  const lowerText = text.toLowerCase();

  // Check objections first (highest priority)
  // Check "not interested" and similar rejections BEFORE other objections
  if (STAGE_PATTERNS['Objection:Need'].some(p => p.test(lowerText))) return 'Objection:Need';
  if (STAGE_PATTERNS['Objection:Price'].some(p => p.test(lowerText))) return 'Objection:Price';
  if (STAGE_PATTERNS['Objection:Timing'].some(p => p.test(lowerText))) return 'Objection:Timing';
  if (STAGE_PATTERNS['Objection:Authority'].some(p => p.test(lowerText))) return 'Objection:Authority';
  if (STAGE_PATTERNS['Competitor'].some(p => p.test(lowerText))) return 'Competitor';
  if (STAGE_PATTERNS['Objection:Value'].some(p => p.test(lowerText))) return 'Objection:Value';

  // Check close signals
  if (STAGE_PATTERNS['Close'].some(p => p.test(lowerText))) return 'Close';

  // Check logistics
  if (STAGE_PATTERNS['Logistics'].some(p => p.test(lowerText))) return 'Logistics';

  // Check hesitation
  if (STAGE_PATTERNS['Hesitation'].some(p => p.test(lowerText))) return 'Hesitation';

  // Check greeting
  if (STAGE_PATTERNS['Greeting'].some(p => p.test(lowerText))) return 'Greeting';

  // Default to discovery
  return 'Discovery';
}

/**
 * Generate "say_next" based on stage - INSTANT, no API call
 */
function generateSayNext(stage: Stage): string {
  const responses: Record<Stage, string[]> = {
    'Greeting': [
      "Great to meet you. What prompted you to take this call today?",
      "Thanks for joining. What's the biggest challenge you're facing right now?",
      "Appreciate your time. What would make this call valuable for you?"
    ],
    'Discovery': [
      "Tell me more about that. What impact is it having on your team?",
      "How long has that been a problem?",
      "What would solving that mean for your business?",
      "What else?"
    ],
    'Hesitation': [
      "No rush. What's the one thing that would make this an easy yes?",
      "I hear you thinking. What's your biggest concern?",
      "Take your time. What would need to be true for you to move forward?"
    ],
    'Objection:Price': [
      "If we could save you 10 hours a week, what would that be worth?",
      "Is price the only thing holding us back, or are there other concerns?",
      "What's the cost of not solving this problem?"
    ],
    'Objection:Timing': [
      "What would need to happen for this to be a priority next quarter?",
      "I understand. What's driving the timing concern?",
      "If you had a solution today, when would you ideally want to start?"
    ],
    'Objection:Authority': [
      "What does your decision process typically look like?",
      "Who else should be involved in this conversation?",
      "How can I help make this easier for everyone?"
    ],
    'Objection:Value': [
      "What would success look like for you in 6 months?",
      "How do you measure ROI on tools like this?",
      "What results would justify the investment?"
    ],
    'Objection:Need': [
      "I respect that. Can I ask what prompted you to take this call in the first place?",
      "Totally understand. What would need to be true for this to be a fit?",
      "Fair enough. Just out of curiosity, what are you using today to handle this?",
      "I hear you. Before I go - what's the one thing that would change your mind?"
    ],
    'Competitor': [
      "What made you choose them initially?",
      "What's one thing you wish they did better?",
      "If you could wave a magic wand, what would you change about your current solution?"
    ],
    'Close': [
      "Should we schedule the kickoff for Tuesday or Thursday?",
      "Great! I'll send the agreement over now. Sound good?",
      "What information do you need from me to move forward today?"
    ],
    'Logistics': [
      "Perfect. What time works best for your team?",
      "I'll send a calendar invite now. Anything specific you want me to include?",
      "Looking forward to it. Is there anything else you need before we meet?"
    ]
  };

  const options = responses[stage];
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * Generate insight based on stage
 */
function generateInsight(stage: Stage): string {
  const insights: Record<Stage, string> = {
    'Greeting': "Find their 'why now' - what triggered this call",
    'Discovery': "Dig deeper with 'what else?' or 'tell me more'",
    'Hesitation': "Give space, then ask what's blocking them",
    'Objection:Price': "Focus on ROI, not discounts",
    'Objection:Timing': "Find the real blocker behind timing",
    'Objection:Authority': "Map the buying committee",
    'Objection:Value': "Quantify the pain with specifics",
    'Objection:Need': "Uncover the real objection behind 'not interested'",
    'Competitor': "Don't bash - find gaps in their solution",
    'Close': "Use assumptive close with specific next steps",
    'Logistics': "Lock in the commitment immediately"
  };
  return insights[stage];
}

/**
 * Calculate confidence (0-100)
 */
function calculateConfidence(stage: Stage, text: string): number {
  let confidence = 75; // Base

  // Boost for clear objection keywords
  if (stage.startsWith('Objection:') || stage === 'Competitor') confidence += 15;
  if (stage === 'Close') confidence += 10;

  // Penalty for very short text
  if (text.length < 10) confidence -= 20;
  if (text.length < 5) confidence -= 30;

  // Boost for longer, specific text
  if (text.length > 30) confidence += 5;

  return Math.min(Math.max(confidence, 30), 100);
}

/**
 * SLIDING WINDOW: Keep only last N turns
 */
function getSlidingWindow(turns: TranscriptTurn[], maxTurns: number = 6): TranscriptTurn[] {
  return turns.slice(-maxTurns);
}

/**
 * CORE FUNCTION: Process transcript and return coaching
 * 
 * RULES:
 * 1. If prospect speaks → generate coaching
 * 2. If salesperson speaks → only coach if they missed something
 * 3. Skip pure filler
 * 4. Return in < 50ms (no API calls for standard responses)
 */
export function processTranscriptUltraFast(
  currentTurn: TranscriptTurn,
  previousTurns: TranscriptTurn[],
  settings?: any
): CoachingResponse | null {
  const { speaker, text, isFinal } = currentTurn;

  // Filter pure filler - never coach on noise
  if (isPureFiller(text)) {
    return null;
  }

  // PRIMARY CASE: Prospect spoke - ALWAYS coach
  if (speaker === 'prospect') {
    const stage = detectStage(text);
    let say_next = generateSayNext(stage);
    let insight = generateInsight(stage);

    // Quick personalization based on settings
    let prefix = "";
    if (settings?.emotionStyle === 'Assertive') {
      prefix = "I hear you. ";
      say_next = say_next + " Let's get this done.";
      insight = "Direct approach: " + insight;
    } else if (settings?.emotionStyle === 'Empathetic') {
      prefix = "I completely understand. ";
      insight = "Trust-building: " + insight;
    } else if (settings?.emotionStyle === 'Energetic') {
      prefix = "That's great! ";
      insight = "Momentum-focused: " + insight;
    }

    // Objection Handling Personalization
    if (stage.startsWith('Objection:')) {
      if (settings?.objectionMode === 'Hard Pushback') {
        say_next = "Actually, " + say_next.charAt(0).toLowerCase() + say_next.slice(1);
      } else if (settings?.objectionMode === 'Question-Based') {
        say_next = say_next + " What's the main concern there?";
      } else if (settings?.objectionMode === 'Story-Based') {
        say_next = "We've seen this before. " + say_next;
      }
    }

    say_next = prefix + say_next;

    const confidence = calculateConfidence(stage, text);

    return {
      stage,
      say_next,
      insight,
      confidence
    };
  }

  // SECONDARY CASE: Salesperson spoke - only coach if they made a mistake
  if (speaker === 'salesperson' && isFinal) {
    // Check if they missed an objection in previous prospect turn
    const lastProspectTurn = [...previousTurns].reverse().find(t => t.speaker === 'prospect');

    if (lastProspectTurn) {
      const lastStage = detectStage(lastProspectTurn.text);
      const isObjection = lastStage.startsWith('Objection:') || lastStage === 'Competitor';

      // If prospect raised objection and salesperson didn't address it
      if (isObjection && !text.toLowerCase().includes('price') && !text.toLowerCase().includes('budget')) {
        return {
          stage: lastStage,
          say_next: generateSayNext(lastStage),
          insight: "Prospect raised objection - address it directly based on your " + (settings?.emotionStyle || "current") + " style.",
          confidence: 90
        };
      }
    }

    // No coaching needed on salesperson speech
    return null;
  }

  return null;
}

/**
 * ENHANCED COACHING: For complex scenarios, use AI
 * Only called when confidence is low or stage is unclear
 */
export async function generateAIEnhancedCoaching(
  turns: TranscriptTurn[]
): Promise<CoachingResponse | null> {
  if (!OPENAI_API_KEY) return null;

  // Sliding window - last 5 turns only
  const recentTurns = getSlidingWindow(turns, 5);

  const transcript = recentTurns
    .map(t => `${t.speaker.toUpperCase()}: "${t.text}"`)
    .join('\n');

  const systemPrompt = `You are an expert sales coach analyzing a live sales call. Your job is to listen to what the PROSPECT just said and tell the SALESPERSON exactly what to say next.

CRITICAL RULES:
1. You are coaching the SALESPERSON - never show what the prospect said
2. Analyze the prospect's last statement to identify objections, questions, or buying signals
3. Provide a natural, conversational response for the salesperson to say
4. Return ONLY valid JSON - no markdown, no explanations, no code blocks
5. The "say_next" field must be a complete sentence the salesperson can speak aloud
6. The "insight" field explains WHY this response works (strategy)`;

  const userPrompt = `ANALYZE THIS CONVERSATION AND TELL THE SALESPERSON WHAT TO SAY NEXT:

TRANSCRIPT (most recent last):
${transcript}

INSTRUCTIONS:
- Identify what the PROSPECT just said (last prospect line)
- Determine the sales stage based on their statement
- Write a response for the SALESPERSON to say next
- Confidence should reflect how clear the prospect's intent is (0-100)

VALID STAGES:
- Greeting: Initial introductions
- Discovery: Prospect asking questions or sharing info
- Hesitation: Uncertainty or pausing
- Objection:Price: Price/budget concerns
- Objection:Timing: Not ready, need time
- Objection:Authority: Need approval from others
- Objection:Value: Questioning worth/ROI
- Objection:Need: Not interested, no need
- Competitor: Mentioning other vendors
- Close: Ready to buy, asking about next steps
- Logistics: Scheduling, implementation details

REQUIRED JSON FORMAT:
{
  "stage": "ExactStageName",
  "say_next": "Exact words for salesperson to say",
  "insight": "Why this response works strategically",
  "confidence": 85
}

RESPOND NOW WITH JSON ONLY:`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 250,
        temperature: 0.3,
        response_format: { type: 'json_object' }
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      console.error('[AI] Empty content from API');
      return null;
    }

    console.log('[AI] Raw response:', content);

    let result;
    try {
      result = JSON.parse(content);
    } catch (parseError) {
      console.error('[AI] JSON parse failed:', parseError);
      console.error('[AI] Content was:', content);
      return null;
    }

    console.log('[AI] Parsed result:', result);

    if (!result.say_next || result.say_next.trim() === '') {
      console.error('[AI] Missing say_next field');
      return null;
    }

    return {
      stage: result.stage || 'Discovery',
      say_next: result.say_next,
      insight: result.insight || 'Listen to understand their perspective.',
      confidence: typeof result.confidence === 'number' ? result.confidence : 75
    };
  } catch (error) {
    console.error('[AI] Unexpected error:', error);
    return null;
  }
}

/**
 * Check audio health
 */
export function checkAudioHealth(
  lastTranscriptTime: number,
  isListening: boolean
): { status: 'LIVE' | 'NO AUDIO' | 'ERROR'; message?: string } {
  if (!isListening) {
    return { status: 'ERROR', message: 'Not listening - check mic' };
  }

  const timeSinceLastTranscript = Date.now() - lastTranscriptTime;

  if (timeSinceLastTranscript > 5000) {
    return { status: 'NO AUDIO', message: 'No audio detected' };
  }

  if (timeSinceLastTranscript > 2000) {
    return { status: 'NO AUDIO', message: 'Audio quiet - speak louder?' };
  }

  return { status: 'LIVE' };
}

/**
 * Post-call summary
 */
export async function generatePostCallSummary(
  callId: string,
  turns: TranscriptTurn[]
): Promise<any> {
  if (!OPENAI_API_KEY || turns.length === 0) {
    return {
      outcome: 'neutral',
      outcomeConfidence: 0.5,
      objections: [],
      wentWell: ['Call completed'],
      improvement: 'Practice active listening',
      focusNextCall: 'Prepare better discovery questions'
    };
  }

  const transcript = turns
    .map(t => `${t.speaker}: "${t.text}"`)
    .join('\n');

  const prompt = `Summarize this sales call in JSON:

TRANSCRIPT:
${transcript}

OUTPUT:
{
  "outcome": "booked|not_interested|follow_up|neutral",
  "outcomeConfidence": 0.85,
  "objections": [{"type": "price", "text": "...", "handled": true}],
  "wentWell": ["strength 1", "strength 2"],
  "improvement": "one area",
  "focusNextCall": "one focus"
}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.3,
        response_format: { type: 'json_object' }
      }),
    });

    if (!response.ok) throw new Error('API error');

    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (error) {
    return {
      outcome: 'neutral',
      outcomeConfidence: 0.5,
      objections: [],
      wentWell: ['Call completed'],
      improvement: 'Review call recording',
      focusNextCall: 'Prepare better questions'
    };
  }
}