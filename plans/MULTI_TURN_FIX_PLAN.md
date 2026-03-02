# Multi-Turn STT Fix Plan

## Problem Statement
The AI sales coach only responds once to prospect speech, then blocks all subsequent coaching requests with "Coaching already in progress".

## Root Cause Analysis

### From Console Logs:
```
[runCoaching] ✅ ENTRY - speaker: prospect, turns: 1, force: false
[runCoaching] Checking isCoachingInProgress: false
[Client] Sending to /api/coach/live: ...
...
[Prospect onSpeechEnd] ✅ CALLBACK FIRED with transcript: The price is too low.
[runCoaching] ✅ ENTRY - speaker: prospect, turns: 3, force: false
[runCoaching] Checking isCoachingInProgress: true
[runCoaching] ❌ BLOCKED - Coaching already in progress!
```

### The Issue:
1. The `onSpeechEnd` callback is firing TWICE for the same transcript
2. First callback sets `isCoachingInProgressRef.current = true`
3. Before the API responds, the second (duplicate) callback fires
4. Second callback is blocked because `isCoachingInProgress` is still `true`

### Why the Duplicate Callbacks:
The state reset logic in `use-stt-stream-ws.ts` is triggering the `onSpeechEnd` callback twice:
- Once when the server sends the final transcript
- Again when the client-side silence detection finalizes the partial

## Fix Strategy

### Fix 1: Add Deduplication at Callback Level (sales-coach-overlay.tsx)
Track the last transcript processed and ignore duplicates within a short time window.

```typescript
// In sales-coach-overlay.tsx
const lastProcessedTranscriptRef = useRef<string>('')
const lastProcessedTimeRef = useRef<number>(0)

const prospectStream = useSTTStream((transcript) => {
  const now = Date.now()
  const isDuplicate = 
    transcript.text === lastProcessedTranscriptRef.current &&
    now - lastProcessedTimeRef.current < 2000 // 2 second dedup window
  
  if (isDuplicate) {
    console.log(`[Prospect onSpeechEnd] ⏭️ SKIPPING duplicate transcript`)
    return
  }
  
  lastProcessedTranscriptRef.current = transcript.text
  lastProcessedTimeRef.current = now
  
  // Continue with normal processing...
})
```

### Fix 2: Prevent Double Final in use-stt-stream-ws.ts
The client-side silence finalization should NOT fire if the server already sent a final for this transcript.

```typescript
// In use-stt-stream-ws.ts
// Track the last server-sent final to avoid duplicate client-side finalization
if (data.type === 'final') {
  // Mark this text as already finalized by server
  serverFinalizedTextRef.current = data.text
  // ... rest of final handling
}

// In silence detection section:
if (silenceDuration > FINAL_SILENCE_THRESHOLD_MS) {
  // Check if server already finalized this
  if (pendingPartialRef.current.text === serverFinalizedTextRef.current) {
    console.log('[Silence] Server already finalized, skipping client finalization')
    pendingPartialRef.current = null
    finalSilenceStartRef.current = null
    return
  }
  // ... rest of silence finalization
}
```

### Fix 3: Add Force Reset Mechanism
Add a failsafe to reset `isCoachingInProgress` after a maximum timeout.

```typescript
// After setting isCoachingInProgressRef.current = true:
const safetyResetTimer = setTimeout(() => {
  if (isCoachingInProgressRef.current) {
    console.warn('[runCoaching] Safety reset triggered after 10s')
    isCoachingInProgressRef.current = false
  }
}, 10000)
```

## Implementation Order

1. **Immediate Fix**: Add transcript deduplication in `sales-coach-overlay.tsx`
2. **Root Cause Fix**: Prevent double finalization in `use-stt-stream-ws.ts`
3. **Safety Net**: Add timeout-based reset for `isCoachingInProgress`

## Expected Outcome

After fix:
- Prospect speaks → Single callback fires → Coaching generated → Card displayed
- Prospect speaks again → Single callback fires → New coaching generated → New card displayed
- No duplicate callbacks, no blocking, continuous multi-turn operation
