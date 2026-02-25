# Deep Architecture Walkthrough: Real-Time SalesCoach

This document provides a comprehensive "deep dive" into the logic and flow of the Presence Orb SalesCoach component. 

---

## 🏗️ 1. The Core Data Flow (The "Pipe")

The system operates as a reactive pipeline. Every millisecond of audio travels through these stages:

### A. Audio Capture (`useSTTStream.ts`)
- **Dual Streams**: We capture `salesperson` (Mic) and `prospect` (System/Tab Audio) separately.
- **Analysis**: We use `AudioContext` and `AnalyserNode` to monitor real-time audio levels (the pulsing green/blue bars in the UI).
- **VAD (Voice Activity Detection)**: A 200ms silence threshold triggers the "Turn End" event.

### B. Transcription Bridge (`app/api/stt/stream/route.ts`)
- **SSE (Server-Sent Events)**: To avoid the latency of polling, we use a persistent SSE connection.
- **Google STT v2**: The server streams raw Opus audio to Google Cloud. Google returns `partial` transcripts (what the speaker is currently saying) and `final` transcripts (the full sentence once they stop).

### C. The Intelligence Layer (`sales-coach-overlay.tsx`)
- **Ultra-Fast Path (< 100ms)**: When a `partial` transcript is heard from the prospect, we immediately run `processTranscriptUltraFast`. This uses local keyword-matching (Regex) to guess the stage and show a "Draft Card". This is why the UI feels instant.
- **Refined Path (200ms - 800ms)**: Once a `final` transcript is received, the **Turn Manager** takes over.

---

## 🧠 2. Deep Turn Management (`lib/turn-manager.ts`)

The `TurnManager` is the "brain" that prevents the AI from getting confused. It handles:

1.  **Deduplication**: In low-latency streams, Google sometimes sends the same sentence twice. We use **Levenshtein Distance** (fuzzy matching) to compare the new transcript with the last one. If they match > 80%, we ignore the duplicate.
2.  **Rate Limiting**: We enforce a `minTimeBetweenTurns` (100ms) to ensure we don't spam the AI API if the speaker is talking fast.
3.  **Single-Flight Execution**: Only one AI call happens at a time. If the prospect keeps talking while the AI is thinking, we **abort** the current request and start a new one with the combined context.
4.  **Buffer Management**: It keeps track of `pendingTurns` to ensure no speech is lost during high-latency spikes.

---

## 🤖 3. The 15-Stage Strategy (`lib/salescoach-ai-server.ts`)

When a final transcript is validated, we call the server-side AI. 

- **Sliding Window**: We only send the last 2-5 turns. Sending the whole call history would take too long to process.
- **Strict Categorization**: The AI is forced to classify the conversation into one of 15 tactical stages (e.g., *Pain, Impact, Objection:Price*).
- **Tactical Fallbacks**: If the AI takes longer than 1.5 seconds, the server automatically returns a high-quality fallback coaching hint to ensure the Salesperson is never left without guidance.

---

## ⚡ 4. Latency Optimization Summary

| Component | Optimization | Result |
| :--- | :--- | :--- |
| **STT** | `latest_short` model | 2x faster finalization |
| **Turn Manager** | 100ms Buffer | Instant processing |
| **AI Prompt** | JSON-only + Token Limit | 400ms generation |
| **Fallback** | 1500ms hard timeout | No "waiting" UI states |

---

## 🧪 5. Verification Checklist

1.  **Greeting**: Say "Hi there" → Instant "Greeting" card.
2.  **Objection**: Say "That costs too much" → "Objection: Price" card with strategy.
3.  **Interruption**: Interrupt the prospect → Turn Manager cancels old AI call and starts new one.
4.  **Silence**: Stop talking → Pulse ring fades out, indicator remains LIVE.

**The system is now optimized for the "Elite Salesperson" experience—zero lag, high accuracy, and tactical brilliance.**
