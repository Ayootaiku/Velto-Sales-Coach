/**
 * Ultra Real-Time SalesCoach Client
 * Debounced, streaming, salesperson-first
 */

import { 
  processTranscriptUltraFast,
  generateAIEnhancedCoaching,
  checkAudioHealth,
  generatePostCallSummary,
  type CoachingResponse,
  type TranscriptTurn 
} from './salescoach-copilot';

export type { CoachingResponse, TranscriptTurn };

// Configuration
const DEBOUNCE_MS = 300; // Wait 300ms after speech stops before coaching
const MAX_CONTEXT_TURNS = 6; // Sliding window size
const MIN_CONFIDENCE_THRESHOLD = 60; // Don't show if below this

// State management
interface CoachState {
  turns: TranscriptTurn[];
  lastTranscriptTime: number;
  isProcessing: boolean;
  cachedResponses: Map<string, CoachingResponse>;
}

const state: CoachState = {
  turns: [],
  lastTranscriptTime: 0,
  isProcessing: false,
  cachedResponses: new Map()
};

let debounceTimer: NodeJS.Timeout | null = null;

/**
 * Process interim transcript (draft)
 * Returns immediately with low-confidence draft
 */
export function processInterimTranscript(
  text: string,
  speaker: 'salesperson' | 'prospect'
): CoachingResponse | null {
  if (!text.trim()) return null;
  
  const turn: TranscriptTurn = {
    speaker,
    text: text.trim(),
    timestamp: Date.now(),
    isFinal: false
  };
  
  // Update state
  state.lastTranscriptTime = Date.now();
  
  // Get draft coaching immediately
  const coaching = processTranscriptUltraFast(turn, state.turns);
  
  if (coaching) {
    // Mark as draft (lower confidence)
    return {
      ...coaching,
      confidence: Math.max(30, coaching.confidence - 20),
      insight: coaching.insight + ' (draft)'
    };
  }
  
  return null;
}

/**
 * Process final transcript
 * Debounced to batch rapid speech
 */
export function processFinalTranscript(
  text: string,
  speaker: 'salesperson' | 'prospect',
  onCoachingReady: (coaching: CoachingResponse | null) => void
): void {
  if (!text.trim()) {
    onCoachingReady(null);
    return;
  }
  
  // Clear previous debounce
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  
  // Debounce coaching
  debounceTimer = setTimeout(() => {
    const turn: TranscriptTurn = {
      speaker,
      text: text.trim(),
      timestamp: Date.now(),
      isFinal: true
    };
    
    // Add to sliding window
    state.turns.push(turn);
    if (state.turns.length > MAX_CONTEXT_TURNS) {
      state.turns.shift();
    }
    
    state.lastTranscriptTime = Date.now();
    
    // Get coaching
    const coaching = processTranscriptUltraFast(turn, state.turns);
    
    // Filter by confidence
    if (coaching && coaching.confidence >= MIN_CONFIDENCE_THRESHOLD) {
      onCoachingReady(coaching);
    } else {
      onCoachingReady(null);
    }
  }, DEBOUNCE_MS);
}

/**
 * Get audio health status
 */
export function getAudioHealth(isListening: boolean): {
  status: 'LIVE' | 'NO AUDIO' | 'ERROR';
  message?: string;
  secondsSinceAudio: number;
} {
  const health = checkAudioHealth(state.lastTranscriptTime, isListening);
  const secondsSinceAudio = Math.floor((Date.now() - state.lastTranscriptTime) / 1000);
  
  return {
    ...health,
    secondsSinceAudio
  };
}

/**
 * Reset coach state (new call)
 */
export function resetCoachState(): void {
  console.log('[Coach State] Resetting for new call');
  state.turns = [];
  state.lastTranscriptTime = Date.now();
  state.isProcessing = false;
  state.cachedResponses.clear();
  
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/**
 * Get current transcript count (for debugging)
 */
export function getContextSize(): number {
  return state.turns.length;
}

/**
 * Generate summary at call end
 */
export async function generateSummary(callId: string): Promise<any> {
  return generatePostCallSummary(callId, state.turns);
}