import React from 'react';
import { createRoot } from 'react-dom/client';
import { SalesCoachOverlay } from '@/components/overlay/sales-coach-overlay';
import { setApiBaseUrl } from '@/lib/salescoach-ai';
import { setWssBaseUrl } from '@/hooks/use-stt-stream-ws';
import { useRestartDeployment } from '@/hooks/useRestartDeployment';
import { API_BASE_URL, WSS_URL } from './config';
import '@/app/globals.css';
import './extension.css';

setApiBaseUrl(API_BASE_URL);
setWssBaseUrl(WSS_URL);

function SidePanelApp() {
  const { restartDeployment } = useRestartDeployment();

  const handleInRoomStart = async () => {
    if (!API_BASE_URL) {
      console.error('[Velto] Set VITE_PRODUCTION_ORIGIN in repo root .env.local to your Render https URL, then run pnpm ext:build.');
      return;
    }
    // 1. Fire restart immediately (don't wait)
    restartDeployment().catch(e => console.error("Background restart failed:", e));
    
    // 2. Open website immediately
    const websiteUrl = API_BASE_URL
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: `${websiteUrl}?start=inroom` })
    } else {
      window.open(`${websiteUrl}?start=inroom`, '_blank')
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0a0a] text-[#ffffff]">
      <SalesCoachOverlay onInRoomStart={handleInRoomStart} />
    </main>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<SidePanelApp />);
}
