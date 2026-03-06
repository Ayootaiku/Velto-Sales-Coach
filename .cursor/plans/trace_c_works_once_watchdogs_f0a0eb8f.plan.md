---
name: Trace C works once watchdogs
overview: "Trace C only works once then the new WebSocket closes (TRACE-E); watchdogs and reset logic exist in the hook but the \"restart after every prospect turn\" causes the server to close the new connection. Plan: align client reconnect and post-turn behavior with how the system is designed to stay alive (watchdogs, optional skip of post-turn restart, reconnect with fresh session ID)."
todos: []
isProject: false
---

# Fix "Trace C only works once" and restore watchdogs / keep-alive behavior

## What the logs show

1. **First turn works:** Prospect speaks, TRACE-C partial, TRACE-D final, `onSpeechEnd` -> handleTranscript -> API -> AI response.
2. **Overlay then restarts stream:** `[Prospect AI Response] Turn complete. Starting NEW prospect stream...` -> `prospectStream.startAutomatic()`.
3. **New stream connects then closes:** TRACE-A (Cloud WSS CONNECTED), TRACE-B (STT stream CREATED), then immediately **TRACE-E (WebSocket CLOSED, finals received: 0)**. So the **new** WebSocket is closed by the server (or network) right after connect; no TRACE-C/TRACE-D on the second stream.
4. **Watchdogs in your screenshots:** IN-ROOM WATCHDOG "Refreshing audio pulse", SILENT BUFFER BUG "FORCING HARDWARE RESET", and the hook’s no-audio-for-5s watchdog are all present in the code and run as designed. The failure is not “watchdog missing” but “new stream dies right after we create it.”

So the issue is: **after one successful turn we tear down the prospect stream and open a new one; that new connection is closed (likely by the server) so Trace C never runs again until you redeploy.**

---

## How the system is designed (before vs now)

At checkpoint **267f481** (“Checkpoint: working sales coach before extension conversion”) the overlay **already** had:

- “Turn complete. Starting NEW prospect stream” and `prospectStream.startAutomatic()` after each AI response.
- HEARTBEAT / IN-ROOM WATCHDOG calling `salespersonStream.startAutomatic()` on diarize turn and on silence.
- Same hook logic: watchdogs (no-audio 5s, silent buffer 4s), `resumeCheckInterval`, visibility resume.

So “before any changes” the **design** was already: restart prospect stream after every turn and use watchdogs to recover from silence/suspended context. The difference is likely **environment**: locally the server kept accepting new connections; on **Railway** the second connection is being closed (server closes it or Google STT stream errors), so Trace C only works once until redeploy.

---

## Current keep-alive and reset mechanisms (unchanged in intent)

These are already in [hooks/use-stt-stream-ws.ts](hooks/use-stt-stream-ws.ts) and match the doc [docs/STT_TRACE_AND_WATCHDOG.md](docs/STT_TRACE_AND_WATCHDOG.md):


| Mechanism                   | Where                             | Purpose                                                                                                                                  |
| --------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **lastAudioProcessTimeRef** | Top of `onaudioprocess`           | Any callback run counts as “audio seen” so the no-audio watchdog does not fire on brief gaps.                                            |
| **No-audio watchdog**       | `watchdogIntervalRef` every 2s    | If no `onaudioprocess` for **> 5s** while streaming, call `startAutomatic()` so capture/context can recover.                             |
| **Silent buffer bug**       | Inside `onaudioprocess` after RMS | If **4s** with no RMS > 0.0001 while streaming, call `startAutomatic()` (hardware reset).                                                |
| **Resume check**            | `resumeCheckIntervalRef` every 3s | If `AudioContext.state === 'suspended'` and still streaming, call `ctx.resume()`.                                                        |
| **Visibility resume**       | `visibilitychange`                | When document becomes visible, resume suspended AudioContext.                                                                            |
| **Reconnect on close**      | `ws.onclose`                      | If `isStreaming` and under reconnect limit, after backoff call `connectWebSocket(speaker, newSessionId, ...)` and re-attach `onmessage`. |


The overlay ([components/overlay/sales-coach-overlay.tsx](components/overlay/sales-coach-overlay.tsx)) also has:

- **IN-ROOM WATCHDOG:** silence timer and “Refreshing audio pulse” calling `salespersonStream.startAutomatic()` (diarized mode).
- **Post–AI response:** “Turn complete” -> in non-diarized mode `prospectStream.startAutomatic()`, in diarized mode `salespersonStream.startAutomatic()` after 100ms.

So the “list” of how you kept it alive is: same stream until timeout/silence; watchdogs force restart when no audio or silent buffer; post-turn restart to get a fresh stream. The bug is that on Railway the **post-turn restart** produces a new connection that is closed immediately.

---

## Root cause (why the new stream closes)

- **Client:** After turn complete we call `stopStream(true)` (old WS closed, `onclose` nulled), wait 800ms, then `startStream(..., existingStream)` with a **new** session ID. New WebSocket connects (TRACE-A/B).
- **Server:** [server/combined-server.js](server/combined-server.js) accepts the new WS, creates a new Google `streamingRecognize` stream, sends `{ type: 'connected' }`. When the Google stream emits `error` / `end` / `close`, or when the client WS closes, the server calls `closeSession(ws)` and closes the client WS.
- So TRACE-E with “finals received: 0” means the **server** (or Google) is closing the new connection before any transcript is sent. Likely: Google stream errors on the second connection (e.g. quota, config, or stream lifecycle), or the server throws and closes the session.

---

## Plan (changes aligned with how the system works)

### 1. Reconnect with a fresh session ID (hook)

**File:** [hooks/use-stt-stream-ws.ts](hooks/use-stt-stream-ws.ts)

In `ws.onclose`, the auto-reconnect currently uses `newSessionId` from the closure (the session that just closed). Some backends treat a closed session as invalid for reuse. Reconnect with a **new** session ID and update the ref so the rest of the hook and the server see one consistent session per connection.

- In the `setTimeout` inside `ws.onclose`, **generate a new session ID** (e.g. same pattern as in `startStream`: `\`${speaker}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`).
- Set `sessionIdRef.current = newSessionIdForReconnect` and call `connectWebSocket(speaker, newSessionIdForReconnect, isDiarizedRef.current)`.
- Re-attach the **same** message handler (or a new one that uses the same logic) so TRACE-B/C/D continue to work after reconnect.

This keeps the existing “reconnect when the server closes us” behavior but gives the server a clean session instead of reusing the closed one.

### 2. Optional: do not restart prospect stream after every turn (overlay)

**File:** [components/overlay/sales-coach-overlay.tsx](components/overlay/sales-coach-overlay.tsx)

Today, after each prospect AI response we call `prospectStream.startAutomatic()` (non-diarized), which closes the current WebSocket and opens a new one. On Railway that new connection is the one that immediately closes.

- **Option A (recommended to try first):** **Stop** calling `prospectStream.startAutomatic()` (and the 100ms-delayed `salespersonStream.startAutomatic()` in diarized mode) when “Turn complete” / “Error turn complete”. Rely on:
  - The hook’s “ALWAYS send audio” and the server heartbeat so the **same** WebSocket stays open.
  - The existing watchdogs (no-audio 5s, silent buffer 4s) to call `startAutomatic()` only when the stream is actually stuck (no callbacks or only silence).
- **Option B:** If you must keep a “fresh stream” after each turn, add a **longer delay** before calling `startAutomatic()` (e.g. 1.5–2s) so the server has time to tear down the old session and accept a new one; and ensure the hook reconnects with a new session ID (step 1).

Implement Option A first; if you need per-turn refresh for product reasons, add Option B (delay + keep step 1).

### 3. Server-side: log why the session is closed (Railway)

**File:** [server/combined-server.js](server/combined-server.js)

To confirm why the second connection closes:

- In `closeSession(ws)`, log a short reason: e.g. “client close”, “client error”, “stream end”, “stream error”, “stream close”. You can infer “client” vs “stream” by whether the close came from `ws.on('close'|'error')` or from `stream.on('end'|'close'|'error')` (e.g. pass a reason string into `closeSession` or set a flag before calling it).
- In `stream.on('error')`, log the full error message so you can see if Google is rejecting the second stream.

No behavior change, only logs so you can see in Railway logs whether the second connection is closed by Google stream error, stream end, or client.

### 4. No change to watchdog or reset logic

- Do **not** remove or weaken the existing watchdogs (no-audio 5s, silent buffer 4s, resume check, visibility).
- Do **not** change the IN-ROOM WATCHDOG or the diarized HEARTBEAT logic beyond the optional removal of the “Turn complete” restart (step 2).

---

## Summary


| Item                  | Action                                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hook reconnect**    | In `ws.onclose` auto-reconnect, use a **new** session ID and set `sessionIdRef.current` so the server gets a fresh session.                                                                                                                                        |
| **Overlay post-turn** | Prefer **not** calling `prospectStream.startAutomatic()` (and the delayed salesperson restart) on “Turn complete” / “Error turn complete”; rely on same-stream + watchdogs. Optional: if you keep post-turn restart, add a 1.5–2s delay before `startAutomatic()`. |
| **Server**            | Add minimal logging in `closeSession` and in `stream.on('error')` to see why the second connection closes on Railway.                                                                                                                                              |
| **Watchdogs**         | Leave as-is; they already implement “reset on silence / no audio / suspended context” as before.                                                                                                                                                                   |


This keeps the “before” design (watchdogs, keep-alive, resume) and fixes “Trace C only works once” by (1) making reconnect use a fresh session and (2) avoiding an immediate post-turn restart that triggers a second connection the server currently closes.