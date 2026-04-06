/** Set `VITE_PRODUCTION_ORIGIN` in repo root `.env.local` to your Render `https://…` URL before `pnpm ext:build`. */
const origin =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_PRODUCTION_ORIGIN
    ? String(import.meta.env.VITE_PRODUCTION_ORIGIN).replace(/\/$/, "")
    : "";

export const API_BASE_URL = origin;
export const WSS_URL = origin ? origin.replace(/^https/, "wss") : "";

export function isExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

export function getApiUrl(path: string): string {
  if (isExtensionContext()) {
    return `${API_BASE_URL}${path}`;
  }
  return path;
}

export function getWssUrl(sessionId: string, speaker: string, diarize = false): string {
  const params = `?session=${sessionId}&speaker=${speaker}${diarize ? '&diarize=true' : ''}`;
  if (isExtensionContext()) {
    return `${WSS_URL}${params}`;
  }
  return `ws://localhost:3002${params}`;
}
