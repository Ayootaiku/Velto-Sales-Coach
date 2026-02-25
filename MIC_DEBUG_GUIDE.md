# Microphone Debugging Guide

## Current Status
✅ Prospect audio capture - WORKING
❓ Salesperson microphone - NEEDS TESTING

## What I Just Added

### Enhanced Logging
I've added detailed console logging to track every step of the microphone capture process:

1. **Startup Logs** (when you click "Start Listening"):
   ```
   [Start] Initializing coaching session...
   [Start] Starting microphone...
   [Start] Microphone started. Stream: [MediaStream object]
   [Start] Starting speech recognition...
   [Start] Speech recognition started. isListening: true
   [Start] Starting output audio capture...
   [Start] All systems started!
   ```

2. **Transcript Handler Logs** (when you speak):
   ```
   [Speech Recognition] Interim: [your words as you speak]
   [Speech Recognition] Final: [complete sentence]
   [handleTranscript] Called with: [your text]
   [handleTranscript] Updated transcript: [full transcript]
   [handleTranscript] Added to transcriptTurns. Total turns: X
   [Audio] Mic Final: [your text]
   ```

## How to Test

### Step 1: Open Browser Console
1. Go to http://localhost:3000
2. Press F12 to open Developer Tools
3. Click on the "Console" tab

### Step 2: Start the Session
1. Click "Start Listening"
2. Allow microphone permission
3. Allow screen share (with "Share audio" checked)

### Step 3: Check Console Logs
Look for the startup sequence. You should see:
- `[Start] Initializing coaching session...`
- `[Start] Microphone started. Stream: MediaStream`
- `[Start] Speech recognition started. isListening: true`

### Step 4: Speak into Your Microphone
Say something clearly like "Hello, this is a test"

**Expected Console Output:**
```
[Speech Recognition] Interim: Hello
[Speech Recognition] Interim: Hello this
[Speech Recognition] Interim: Hello this is
[Speech Recognition] Final: Hello this is a test
[handleTranscript] Called with: Hello this is a test
[handleTranscript] Updated transcript:  [You]: Hello this is a test
[handleTranscript] Added to transcriptTurns. Total turns: 1
[Audio] Mic Final: Hello this is a test
```

## Troubleshooting

### If You See NO Logs When Speaking:

**Problem**: Speech Recognition isn't picking up audio

**Possible Causes**:
1. **Microphone Permission Denied**
   - Check browser address bar for microphone icon
   - Click it and ensure microphone is allowed

2. **Wrong Microphone Selected**
   - Browser might be using the wrong mic
   - Check browser settings (chrome://settings/content/microphone)

3. **Browser Not Supported**
   - Web Speech API only works in Chrome/Edge
   - Check console for: `[Start] Speech recognition NOT supported!`

### If You See Interim Logs But NO Final Logs:

**Problem**: Speech Recognition is working but not finalizing

**Solution**: 
- Speak more clearly
- Pause for 1-2 seconds after speaking
- The API needs silence to finalize the transcript

### If You See "[handleTranscript] Skipped - duplicate":

**Problem**: The same text is being processed multiple times

**Solution**: This is actually GOOD - it means the deduplication is working!

### If You See "[handleTranscript] Skipped - empty text":

**Problem**: Empty transcripts are being sent

**Solution**: This is normal - the system filters them out

## What Should Be Working

### ✅ Visual Indicators
- **Green dot** next to "You" should pulse when you speak
- **Green audio bar** should move when you speak
- **Blue dot** next to "Hearing prospect" should pulse when prospect speaks
- **Blue audio bar** should move when prospect speaks

### ✅ Data Storage
When you speak, the system:
1. Captures your audio via Web Speech API
2. Converts it to text
3. Adds it to `transcript` state (visible in UI eventually)
4. Adds it to `transcriptTurnsRef.current` array
5. This array is used for:
   - AI coaching generation
   - Post-call summary
   - Conversation history

### ✅ Backend Integration
The `transcriptTurnsRef.current` array contains:
```typescript
{
  speaker: 'salesperson',  // or 'prospect'
  text: 'What you said',
  timestamp: '2026-02-12T20:30:00.000Z'
}
```

This is sent to:
- `/api/coach/live` - For real-time coaching
- `/api/coach/summary` - For post-call summary

## Next Steps

1. **Test and Report**: 
   - Open the console
   - Start a session
   - Speak into your mic
   - Copy/paste the console logs and send them to me

2. **If It's Not Working**:
   - Check if you see `[Speech Recognition]` logs
   - Check if you see `[handleTranscript]` logs
   - Send me the exact error messages

3. **If It IS Working**:
   - You should see your words in the console
   - The green bar should move
   - Your transcript should be stored in `transcriptTurnsRef`
   - It will be included in the AI summary at the end

## Browser Compatibility

**Supported**:
- ✅ Chrome (desktop)
- ✅ Edge (desktop)

**NOT Supported**:
- ❌ Firefox (no Web Speech API)
- ❌ Safari (limited support)
- ❌ Mobile browsers (inconsistent)

Make sure you're using Chrome or Edge!
