import React from 'react';
import { createRoot } from 'react-dom/client';
import { SalesCoachOverlay } from '@/components/overlay/sales-coach-overlay';
import { setApiBaseUrl } from '@/lib/salescoach-ai';
import { setWssBaseUrl } from '@/hooks/use-stt-stream-ws';
import { API_BASE_URL, WSS_URL } from './config';
import '@/app/globals.css';

setApiBaseUrl(API_BASE_URL);
setWssBaseUrl(WSS_URL);

function SidePanelApp() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0a0a] text-[#ffffff]">
      <SalesCoachOverlay />
    </main>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<SidePanelApp />);
}
