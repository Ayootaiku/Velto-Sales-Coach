# STT Trace and Watchdog — How the stream is kept alive

This doc traces every step from connection to transcripts and how we avoid the stream "dying" (no TRACE-C/TRACE-D, or WebSocket closed with no recovery). It matches the logic in `hooks/use-stt-stream-ws.ts` so the extension can behave the same as the web app.

---

## 1. Trace points (in order)

| Trace | When | Meaning |
|-------|------|--------|
| **TRACE** | `startStream()` called | Session ID generated, stream start requested. |
| **TRACE-A** | `connectWebSocket()` | Connecting to cloud WSS or trying localhost ports. Logs either "Connecting to cloud WSS" or "Trying WebSocket on port N". |
| **TRACE-A** (2nd) | `ws.onopen` | "Cloud WSS CONNECTED" or "WebSocket CONNECTED on port N". |
| **TRACE-B** | Server sends `type: 'connected'` | STT stream created; client is ready to send PCM and receive partials/finals. |
| **TRACE-C** | Server sends `type: 'partial'` | Interim transcript; audio is being received and recognized. |
| **TRACE-D** | Server sends `type: 'final'` | Final transcript; triggers `onSpeechEnd` and coaching. |
| **TRACE-E** | `ws.onclose` | WebSocket closed; logs "finals received: N". |
| **TRACE-AUTO** | `startAutomatic()` | Restarting stream (e.g. after watchdog or silent buffer). |
| **TRACE-STOP** | `stopStream()` | Stream and AudioContext torn down (or kept for rollover). |

Flow that means "it works": **A → B → C (repeated) → D (repeated) → E only when the user ends**. If you see A and B but never C/D, audio is not reaching the server (capture or context suspended). If you see E right after B with no C/D, the connection or server path is failing.

---

## 2. Watchdog — "NO AUDIO CAPTURE" (stream not dying from silence)

- **Where:** `watchdogIntervalRef` in `startStream`, runs every **2s**.
- **Condition:** `lastAudioProcessTimeRef` not updated for **> 5s** while `isStreamingRef.current` is true.
- **Update:** `lastAudioProcessTimeRef` is set at the **start** of `scriptProcessor.onaudioprocess` (so any callback run counts, even if we later return early).
- **Action:** Calls `startAutomatic()` → stopStream(keepTracks=true) with `forceKillContext` → 800ms delay → `startStream(speaker, existingStream, diarize)` again.
- **Purpose:** If `onaudioprocess` stops being called (e.g. AudioContext suspended), we don’t sit there forever; we force a restart so capture can recover and TRACE-C/D can resume.

---

## 3. Silent buffer bug — hardware stuck at zero

- **Where:** Inside `onaudioprocess`, after RMS is computed.
- **Condition:** `now - lastActiveTimeRef.current > 4000` and `isStreamingRef.current`. (We haven’t seen RMS > 0.0001 for 4s.)
- **Action:** `startAutomatic()` (same as watchdog).
- **Purpose:** If the browser gives us only silence for a long time (e.g. hardware/driver stuck), we force a full restart instead of waiting for the 5s watchdog.

---

## 4. AudioContext resume — so TRACE-C/D can happen in the extension

- **lastAudioProcessTimeRef at top of callback:** So the watchdog sees "we’re getting callbacks" even when the WebSocket is briefly closed (e.g. reconnect). Avoids unnecessary restarts.
- **visibilitychange:** When `document.visibilityState === 'visible'`, if `audioContextRef.current.state === 'suspended'`, call `ctx.resume()`. In the side panel, focus/visibility often restores the context so callbacks and TRACE-C/D resume.
- **resumeCheckIntervalRef (every 3s):** If `audioContext.state === 'suspended'` and we’re still streaming, call `ctx.resume()`. Keeps the stream alive when the panel was in the background.

---

## 5. Extension vs web — same behavior

- **WSS URL:** In extension, `cloudBase` is always set (setter, then `VITE_RAILWAY_WSS`, then hardcoded Railway URL). No localhost fallback in the extension so TRACE-A always goes to cloud.
- **Mic:** In-room requests mic from the overlay (getUserMedia) and passes the stream into `startStream`; the hook does not request mic when a stream is provided. Manifest declares capabilities (e.g. `audioCapture` if supported) so the extension can prompt for mic like the web.
- **Traces and watchdog:** Unchanged; same TRACE-A/B/C/D/E, same watchdog and silent-buffer logic, same resume behavior. The extension uses the same hook so "how we made it not die" is identical.

---

## 6. Manifest (extension)

The manifest is set up so the extension can behave like the web app:

- **sidePanel** — UI and STT run in the side panel.
- **activeTab** — For tab context when needed.
- **storage** — For settings/state.
- **tabCapture** — For tab audio in dual-stream (prospect) mode.
- **audioCapture** — Declares intent to use the microphone (getUserMedia); same capability as the web page so the flow (request mic → startStream → TRACE-A through E, watchdog, resume) is the same.
- **host_permissions** — Railway API and WSS so TRACE-A connects to the same backend as the web.

No change to the STT or watchdog logic is required for the extension; only the manifest declares the same capabilities (including mic) so the browser allows the same flow.
