---
name: Plan of the system
overview: "Numbered master list: finish Render cutover (1–3), then backlog (4–6). Say fix plan 1 or items 1–3 to mean the WSS/URL work."
todos:
  - id: "1-urls"
    content: "(1) Single hostname — API + WSS + extension + manifest → Render only."
  - id: "2-restart"
    content: "(2) POST /api/restart → Render REST + RENDER_* env; remove Railway restart."
  - id: "3-ext"
    content: "(3) pnpm ext:build, reload extension, verify session + WSS + STT."
  - id: "4-style"
    content: "(4) Beginner word-for-word vs Advanced bullets."
  - id: "5-kb"
    content: "(5) KB upload + storage (TBD)."
  - id: "6-subagent"
    content: "(6) Sub-agent salesperson context without slowing main path."
isProject: false
---

# Plan of the system

Velto Sales Coach is a Next.js app plus one production Node process (`combined-server.js`) for HTTP and WebSocket STT; the Chrome extension reuses the same UI. This file is the **only** master plan. Use **`[x]`** when done; optional **`~~strikethrough~~`** for retired lines.

**Say “fix plan **1**” or “do **1–3**”** to mean the numbered items below—no need to re-describe the work.

---

## Numbered to-do list (master)

1. **[ ]** **Single hostname everywhere** — Production `https://` and `wss://` use **only** your **Render** URL (same host for both). Replace every `railway.app` / old Railway base in: `app/page.tsx`, STT hook production path (`use-stt-stream-ws`), `useRestartDeployment.ts`, `extension/src/config.ts`, `extension/manifest.json` host permissions, and any other hardcoded Railway string.

2. **[ ]** **`POST /api/restart` on Render** — Server calls Render `POST /v1/services/{id}/restart` with `RENDER_API_KEY` + `RENDER_SERVICE_ID`; remove Railway GraphQL and `RAILWAY_*` env when cutover is done.

3. **[ ]** **Extension + verify** — Run `pnpm run ext:build`, reload the extension in Chrome, start a new session, confirm logs show **Render** `wss://` (not Railway) and STT receives audio end-to-end.

4. **[ ]** **Response style (Beginner vs Advanced)** — Beginner = **word-for-word** full style; Advanced = **bullet-only** (UI + prompts)—**not started** until you ask.

5. **[ ]** **KB upload** — Upload knowledge files for later use (DB / storage / vector **TBD**). No agent access to your DB until you connect tools or define storage.

6. **[ ]** **Sub-agent** — Secondary listener on **salesperson** audio for **extra context** without delaying the main coach path—**not started** until you ask.

**Cross-cutting:** **Speed** — any of 4–6 must not noticeably slow live coaching.

---

## Shipped / baseline

- [x] **Hosting:** App runs on **Render** (Web Service, combined server).

---

## How you fix the WSS error (no code here—what to do)

The browser error happens because the **client still opens WebSocket to Railway** while the **live STT server is on Render** (or Railway is down). The fix is **not** “fix the microphone first”—it is **align every production API and WSS base URL with the host where `combined-server` actually runs**.

- **Do items 1–3** in order: (1) point all URLs at Render, (2) wire restart to Render if you still use `/api/restart`, (3) rebuild extension so the packaged app matches the website.
- After (1), open DevTools → Network/Console: you should see **`wss://` + your Render hostname** in TRACE-A, not `railway.app`.
- If (1) is done but WSS still fails, check Render service is **live**, `GET /api/health` on that host, and that **TLS** uses `wss://` (not `ws://`) in production.

---

## User case: before vs after (items 1–3)

| Before (broken) | After (fixed) |
|-----------------|---------------|
| User opens the site or extension and taps **Start** / begins a session. | Same. |
| Console: TRACE-A shows `wss://…railway.app`; WebSocket handshake fails or closes with **1006**; `[WS STT] Error starting stream`. | Console: TRACE-A shows `wss://…onrender.com` (your Render host); WebSocket opens; partial/final transcripts appear. |
| Mic/tab audio may run, but **STT never attaches**—so it “doesn’t listen” in practice. | Audio flows to the socket on **the same host as the page API**; coaching pipeline runs. |

**Mapping:** Fixing this specific error = completing **1** (required), plus **2** if restart flows must work against Render, plus **3** for the extension. Saying **“fix plan 1–3”** = full cutover for web + extension + restart behavior.

---

## Agent context (one line)

Read this file first; stack = Next overlay + `combined-server.js` WS STT + extension; production URLs must match the real host.
