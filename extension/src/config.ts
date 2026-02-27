export const API_BASE_URL = "https://velto-sales-coach-production.up.railway.app";
export const WSS_URL = "wss://velto-sales-coach-production.up.railway.app";

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
