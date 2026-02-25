# Audio Source Separation Implementation Summary

## What Was Changed

### 1. **Dual Audio Stream Capture**

**SalesCoachOverlay Component** (`components/overlay/sales-coach-overlay.tsx`):

- Added separate state tracking for microphone vs system audio
- Added refs for output stream and output speech recognition
- Implemented `setupOutputAudioCapture()` function using `getDisplayMedia()`

### 2. **Speaker Labeling by Audio Source**

**Salesperson = Microphone Input:**
- Captured via `navigator.mediaDevices.getUserMedia()`
- Labeled as "salesperson" in transcripts
- Triggers feedback on what salesperson said

**Prospect = System/Output Audio:**
- Captured via `navigator.mediaDevices.getDisplayMedia({ audio: true })`
- Labeled as "prospect" in transcripts
- Triggers coaching cards with "Say this next" + "Why this works"

### 3. **Real-Time Processing**

**Separate transcript handlers:**
- `handleSalespersonTranscript()` - processes mic input
- `handleProspectTranscript()` - processes system audio
- Each updates the speaker indicator immediately

### 4. **Speaker Detection UI**

**Visual indicator added:**
- Blue dot: "Prospect Speaking (Output Audio)"
- Green dot: "You Speaking (Mic Input)"
- Gray dot: "Waiting..."

**Output Audio Warning:**
- Shows amber warning banner if output capture not available
- Message: "Prospect audio capture not available. Share your tab audio to enable prospect detection."

### 5. **Comprehensive Coaching**

Added `generateCoachingForProspectText()` function that detects:
- **Greeting**: "hi", "hello" → rapport building response
- **Discovery**: questions → deeper probing response
- **Hesitation**: "um", "uh", short phrases → space-giving response
- **Buy Signal**: "interested", "makes sense" → closing response
- **Price Query**: "price", "cost" (not full objection) → value discussion

### 6. **Cleanup on End Call**

Both streams properly stopped:
- Microphone tracks stopped
- Output audio tracks stopped
- Both speech recognition instances stopped

## How It Works

1. **User clicks "Start Listening"**
   - Microphone permission requested (Salesperson)
   - Screen share permission requested for audio (Prospect)

2. **Real-time processing**
   - Salesperson speaks → mic stream → labeled "salesperson" → feedback shown
   - Prospect speaks → output stream → labeled "prospect" → coaching card shown

3. **UI Updates**
   - Speaker indicator dot changes color based on source
   - Coaching cards appear immediately after prospect text detected
   - Cards show: Stage + "Say this next" + "Why this works"

## Key Behaviors

✅ **Immediate Response**: Every transcript event triggers coaching
✅ **Source-Based Labeling**: Mic = Salesperson, Output = Prospect
✅ **Fallback Handling**: If output not captured, continues with mic-only
✅ **No Empty UI**: Always shows current speaker and coaching
✅ **Proper Cleanup**: Both streams stopped on end call

## Testing

1. Open http://localhost:3000
2. Click "Start Listening"
3. Allow microphone (for salesperson)
4. Allow screen share with audio (for prospect)
5. Speak into mic → see "You Speaking" indicator
6. Play audio from another tab → see "Prospect Speaking" indicator + coaching cards