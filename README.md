Sales Coach UI + GPT-4o Agent

- UI: fixed container with scrollable insight/cards panel; line waveform visualization for listening
- Agent: GPT-4o via OpenAI API (env-based); prompts are hidden server-side; outputs are structured JSON
- Env: .env.local with OPENAI_API_KEY and OPENAI_MODEL (default to gpt-4o)
- Data: optional SQLite or JSON for sessions (we added data/sessions.json as a simple store)
- Endpoints:
  - POST /app/api/sales-agent
- Patch notes available in the PR diff.

### Extension (Velto Sales Coach side panel)

Watchdog and recovery logic runs in the client (hook + overlay). To get the latest in the Chrome extension: run `pnpm run ext:build`, then Reload the extension in chrome://extensions. In the side panel console you should see `[WATCHDOG] *** ENABLED ***` when the stream starts and `[WATCHDOG] prospect - alive` every 30s.
