# Velto Real-Time Streaming Implementation

## Files Modified

### Backend
1. **app/api/stt/stream/route.ts** - Complete rewrite
   - SSE endpoint for real-time transcript streaming
   - POST endpoint for audio chunk upload
   - Google STT v2 streaming integration
   - Session management with auto-cleanup

### Frontend Hooks
2. **hooks/use-stt-stream.ts** - NEW
   - WebSocket-style streaming via SSE + POST
   - Real-time transcript accumulation
   - 100ms audio chunking
   - 200ms silence detection
   - Automatic deduplication

### Frontend Components
3. **components/overlay/sales-coach-overlay.tsx** - Major refactor
   - Removed batch recording logic
   - Added dual streaming (salesperson + prospect)
   - Real-time final transcript processing
   - Removed audio capture warnings
   - Updated status indicators

### Utilities
4. **lib/turn-manager.ts** - Updated
   - Reduced debounce: 500ms → 300ms
   - Increased similarity threshold: 0.85 → 0.90
   - Added single-flight generation with cancel support

## How It Works

### Streaming Flow
```
[Browser Mic] ──POST chunks──→ [Next.js API] 
                                      │
[Browser Tab] ──POST chunks──→  [Google STT gRPC]
                                      │
UI ←────── SSE events ─────────┴── partial/final transcripts
```

### Latency Breakdown
- Audio chunking: 100ms
- Network POST: ~50ms
- Google STT processing: ~200ms
- SSE delivery: ~10ms
- Turn manager debounce: 300ms
- **Total: ~660ms** (target: <1s)

### Key Features
✅ Real-time streaming (no batch)
✅ Dual speaker support (mic + tab)
✅ 200ms silence threshold
✅ Single-flight generation (no spam)
✅ Automatic deduplication
✅ Graceful fallbacks

## Configuration

```typescript
// Latency settings
CHUNK_INTERVAL_MS = 100      // Audio chunks
SILENCE_THRESHOLD_MS = 200   // End-of-turn detection  
DEBOUNCE_MS = 300           // Anti-spam debounce
minTimeBetweenTurns = 300   // Turn manager rate limit
similarityThreshold = 0.90  // Strict dedupe
```

## Testing Checklist

- [ ] Start call → Speak "hi" → Card appears <1s
- [ ] Speak continuously → Only 1 card at end
- [ ] Same phrase twice → Only 1 card (dedupe)
- [ ] Play prospect audio → Cards appear <1s
- [ ] End call → Summary generates
- [ ] No yellow warnings visible
- [ ] Works with mic-only (no prospect stream)

## Next Steps

1. Restart dev server: `npm run dev -- --port 3001`
2. Test in browser at `http://localhost:3001`
3. Check browser console for streaming logs
4. Verify Google STT credentials are configured

## Fallback Behavior

If Google streaming fails:
- Auto-retry with backoff (3 attempts)
- Falls back to existing `/api/stt/transcribe` endpoint
- Shows subtle status indicator (no scary warnings)
