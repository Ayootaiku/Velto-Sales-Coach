/**
 * Client-side SalesCoach AI Service
 * Calls server-side API routes (so API key stays secure)
 */

let _apiBaseUrl = '';
export function setApiBaseUrl(url: string) { _apiBaseUrl = url; }
function apiUrl(path: string) { return _apiBaseUrl ? `${_apiBaseUrl}${path}` : path; }

export interface TranscriptTurn {
  speaker: 'salesperson' | 'prospect';
  text: string;
  timestamp?: string;
}

export type Stage = 'Greeting' | 'Rapport' | 'Discovery' | 'Pain' | 'Impact' | 'Qualification' | 'Value' | 'Confusion' | 'Comparison' | 'Objection' | 'Hesitation' | 'Buy-Signal' | 'Close' | 'Logistics' | 'Stall'
export type ObjectionType = 'Price' | 'Timing' | 'Trust' | 'Authority' | 'Need' | 'Competition'

interface CoachingSuggestion {
  speaker: 'Prospect' | 'Salesperson' | 'Unclear';
  stage: Stage;
  objection_type?: ObjectionType | null;
  say_next: string;
  insight: string;
  confidence: number;
}

interface PostCallSummary {
  outcome: {
    result: string;
    confidence_score: number;
    primary_blocker: string;
    overall_tone: string;
  };
  objections: Array<{ type: string; handled: string; reasoning: string }>;
  prospect_signals: {
    buying_signals: string[];
    curiosity_signals: string[];
    resistance_signals: string[];
    tone_shift_detected: boolean;
  };
  salesperson_performance: {
    strengths: string[];
    weaknesses: string[];
    missed_opportunities: string[];
    control_score: number;
  };
  improvement_focus: {
    better_phrase_example: string;
    objection_handling_upgrade: string;
    recommended_next_action: string;
  };
}

/**
 * Analyze conversation and generate live coaching suggestion
 * Calls server-side API so API key stays secure
 */
export async function generateLiveCoaching(
  recentTranscript: TranscriptTurn[],
  lastSpeaker: 'salesperson' | 'prospect',
  onUpdate?: (partial: Partial<CoachingSuggestion>) => void,
  settings?: any
): Promise<CoachingSuggestion> {
  const isProspect = lastSpeaker === 'prospect';
  const shouldStream = !!onUpdate;

  try {
    console.log('[Client] Sending to /api/coach/live:', { speaker: lastSpeaker, turns: recentTranscript.length, stream: shouldStream });

    const response = await fetch(apiUrl('/api/coach/live'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transcript: recentTranscript,
        lastSpeaker,
        stream: shouldStream,
        settings
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('[Live Coaching Client Error] Response not OK:', response.status, errorData);
      throw new Error(`API Error: ${response.status}`);
    }

    // HANDLE STREAMING RESPONSE
    if (shouldStream && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let result: CoachingSuggestion = {
        speaker: isProspect ? 'Prospect' : 'Salesperson',
        stage: 'Discovery',
        say_next: '',
        insight: '',
        confidence: 75
      };

      while (true) {
        const { done, value } = await reader.read();

        const chunk = decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = chunk.split('\n');

        let shouldBreak = false;
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine === 'data: [DONE]') {
            shouldBreak = true;
            break;
          }

          if (trimmedLine.startsWith('data: ')) {
            const dataStr = trimmedLine.slice(6).trim();
            try {
              const data = JSON.parse(dataStr);
              const content = data.choices[0]?.delta?.content || '';
              fullText += content;

              // Parse custom format: STAGE: [stage] INSIGHT: [insight] SAY_NEXT: [words]
              const cleanText = fullText.trim();

              // Helper to clean up values
              const cleanupValue = (val: string) => {
                let cleaned = val.trim();
                if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
                  (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
                  cleaned = cleaned.slice(1, -1).trim();
                }
                cleaned = cleaned.replace(/^(INSIGHT:|SAY_NEXT:|STAGE:)\s*/i, '');
                return cleaned;
              };

              if (cleanText.toLowerCase().includes('stage:')) {
                const stagePart = cleanText.split(/INSIGHT:|SAY_NEXT:/i)[0];
                const stageMatch = stagePart.match(/STAGE:\s*(.*)/i);
                if (stageMatch) result.stage = cleanupValue(stageMatch[1]) as Stage;
              }

              if (cleanText.toLowerCase().includes('insight:')) {
                const parts = cleanText.split(/SAY_NEXT:/i);
                const insightPart = parts[0];
                const insightMatch = insightPart.match(/INSIGHT:\s*([\s\S]*)/i);
                if (insightMatch) result.insight = cleanupValue(insightMatch[1]);
              }

              if (cleanText.toLowerCase().includes('say_next:')) {
                const parts = cleanText.split(/SAY_NEXT:/i);
                const sayNextPart = parts[1];
                if (sayNextPart) {
                  result.say_next = cleanupValue(sayNextPart);
                }
              }

              onUpdate(result);
            } catch (e) {
              // Ignore partial JSON
            }
          }
        }

        if (done || shouldBreak) break;
      }
      return result;
    }

    // HANDLE REGULAR JSON RESPONSE
    const result = await response.json();
    console.log('[Client] Received from API:', result);

    // Ensure we always have a valid say_next
    if (!result.say_next || result.say_next.trim().length < 5) {
      console.warn('[Client] API returned empty say_next, using fallback');
      result.say_next = isProspect
        ? "I hear you. Can you tell me more about what you're looking for?"
        : "Acknowledge their point and ask a clarifying question.";
      result.insight = result.insight || 'Fallback response';
    }

    return result;
  } catch (error) {
    console.error('[Live Coaching Client Error]', error);
    // Return a proper fallback response instead of empty
    return {
      speaker: isProspect ? 'Prospect' : 'Salesperson',
      stage: 'Discovery',
      say_next: isProspect
        ? "I hear you. Can you tell me more about what you're looking for?"
        : "Acknowledge their point and ask a clarifying question.",
      insight: 'Network or API error - using fallback response',
      confidence: 50
    };
  }
}

/**
 * Generate post-call summary after call ends
 * Calls server-side API so API key stays secure
 * Returns safe fallback on any error - never throws
 */
export async function generatePostCallSummary(
  transcripts: TranscriptTurn[]
): Promise<PostCallSummary> {
  console.log('[Summary Client] Starting summary generation...', { transcriptCount: transcripts?.length });

  const safeTranscripts = Array.isArray(transcripts) ? transcripts : [];
  console.log('[Summary Client] Normalized transcripts:', safeTranscripts.length);

  // Safe fallback that matches PostCallSummary interface
  const safeFallback: PostCallSummary = {
    outcome: { result: "Follow up", confidence_score: 50, primary_blocker: "N/A", overall_tone: "Neutral" },
    objections: [],
    prospect_signals: { buying_signals: [], curiosity_signals: [], resistance_signals: [], tone_shift_detected: false },
    salesperson_performance: { strengths: ["Call completed successfully"], weaknesses: ["Continue practicing"], missed_opportunities: [], control_score: 5 },
    improvement_focus: { better_phrase_example: "", objection_handling_upgrade: "Unable to generate detailed summary.", recommended_next_action: "Schedule follow-up" }
  };

  try {
    console.log('[Summary Client] Making fetch request to /api/coach/summary...');

    // Add timeout to fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch(apiUrl('/api/coach/summary'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transcripts: safeTranscripts,
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log('[Summary Client] Fetch response received:', response.status, response.statusText);

    if (!response.ok) {
      console.error('[Summary Client] API error:', response.status, response.statusText);
      const errorText = await response.text().catch(() => 'No error details');
      console.error('[Summary Client] Error response body:', errorText);
      return safeFallback;
    }

    const result = await response.json();
    console.log('[Summary Client] Response parsed successfully:', Object.keys(result));

    // NESTED NULL GUARDS & DEFAULTS
    return {
      outcome: {
        result: result?.outcome?.result || safeFallback.outcome.result,
        confidence_score: result?.outcome?.confidence_score ?? safeFallback.outcome.confidence_score,
        primary_blocker: result?.outcome?.primary_blocker || safeFallback.outcome.primary_blocker,
        overall_tone: result?.outcome?.overall_tone || safeFallback.outcome.overall_tone
      },
      objections: Array.isArray(result?.objections) ? result.objections : safeFallback.objections,
      prospect_signals: {
        buying_signals: Array.isArray(result?.prospect_signals?.buying_signals) ? result.prospect_signals.buying_signals : safeFallback.prospect_signals.buying_signals,
        curiosity_signals: Array.isArray(result?.prospect_signals?.curiosity_signals) ? result.prospect_signals.curiosity_signals : safeFallback.prospect_signals.curiosity_signals,
        resistance_signals: Array.isArray(result?.prospect_signals?.resistance_signals) ? result.prospect_signals.resistance_signals : safeFallback.prospect_signals.resistance_signals,
        tone_shift_detected: result?.prospect_signals?.tone_shift_detected ?? safeFallback.prospect_signals.tone_shift_detected
      },
      salesperson_performance: {
        strengths: Array.isArray(result?.salesperson_performance?.strengths) ? result.salesperson_performance.strengths : safeFallback.salesperson_performance.strengths,
        weaknesses: Array.isArray(result?.salesperson_performance?.weaknesses) ? result.salesperson_performance.weaknesses : safeFallback.salesperson_performance.weaknesses,
        missed_opportunities: Array.isArray(result?.salesperson_performance?.missed_opportunities) ? result.salesperson_performance.missed_opportunities : safeFallback.salesperson_performance.missed_opportunities,
        control_score: result?.salesperson_performance?.control_score ?? safeFallback.salesperson_performance.control_score
      },
      improvement_focus: {
        better_phrase_example: result?.improvement_focus?.better_phrase_example || safeFallback.improvement_focus.better_phrase_example,
        objection_handling_upgrade: result?.improvement_focus?.objection_handling_upgrade || safeFallback.improvement_focus.objection_handling_upgrade,
        recommended_next_action: result?.improvement_focus?.recommended_next_action || safeFallback.improvement_focus.recommended_next_action
      }
    };
  } catch (error) {
    console.error('[Summary Client Error]', error);
    // Always return safe fallback, never throw
    return safeFallback;
  }
}
