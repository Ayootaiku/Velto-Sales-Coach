/**
 * MCP Client for Supabase Operations
 * Provides typed access to MCP tools from the frontend
 */

const MCP_SERVER_URL = process.env.NEXT_PUBLIC_MCP_SERVER_URL || 'http://localhost:3001';

interface MCPResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Call an MCP tool
async function callMCPTool<T>(toolName: string, args: any): Promise<MCPResponse<T>> {
  try {
    // For now, we'll call the tools through an API route
    // In production, this would connect to the MCP server directly
    const response = await fetch('/api/mcp-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: toolName, args }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Create a new call
export async function createCall(participantType: string = 'prospect') {
  return callMCPTool('create_call', { participant_type: participantType });
}

// Add a transcript segment
export async function addTranscript(
  callId: string,
  speaker: 'salesperson' | 'prospect',
  text: string,
  sequenceNumber: number
) {
  return callMCPTool('add_transcript', {
    call_id: callId,
    speaker,
    text,
    sequence_number: sequenceNumber,
  });
}

// Add a coaching event
export async function addCoachingEvent(
  callId: string,
  speakerDetected: string,
  objectionType: string | undefined,
  objectionText: string | undefined,
  suggestionText: string,
  rationale: string,
  triggerTranscriptId?: string
) {
  return callMCPTool('add_coaching_event', {
    call_id: callId,
    speaker_detected: speakerDetected,
    objection_type: objectionType,
    objection_text: objectionText,
    suggestion_text: suggestionText,
    rationale,
    trigger_transcript_id: triggerTranscriptId,
  });
}

// Update call status
export async function updateCallStatus(
  callId: string,
  status: 'active' | 'completed' | 'cancelled',
  outcome?: string,
  outcomeConfidence?: number,
  durationSeconds?: number
) {
  return callMCPTool('update_call_status', {
    call_id: callId,
    status,
    outcome,
    outcome_confidence: outcomeConfidence,
    duration_seconds: durationSeconds,
  });
}

// Create post-call summary
export async function createSummary(
  callId: string,
  summary: {
    outcome_guess: string;
    outcome_confidence: number;
    objections_handled: any[];
    strengths: string[];
    improvement_areas: string[];
    focus_next_call: string[];
    ai_summary_text: string;
    summary_quality_score: number;
  }
) {
  return callMCPTool('create_summary', {
    call_id: callId,
    ...summary,
  });
}

// Get call transcripts
export async function getCallTranscripts(callId: string) {
  return callMCPTool('get_call_transcripts', { call_id: callId });
}

// Get call coaching events
export async function getCallCoachingEvents(callId: string) {
  return callMCPTool('get_call_coaching_events', { call_id: callId });
}

// Get call summary
export async function getCallSummary(callId: string) {
  return callMCPTool('get_call_summary', { call_id: callId });
}
