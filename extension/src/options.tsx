import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { STORAGE_KEYS, DEFAULTS } from './storage-keys';

function OptionsApp() {
  const [showMovableOrb, setShowMovableOrb] = useState(DEFAULTS[STORAGE_KEYS.SHOW_MOVABLE_ORB]);
  const [useFloatingWindow, setUseFloatingWindow] = useState(DEFAULTS[STORAGE_KEYS.USE_FLOATING_WINDOW]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    chrome.storage.local.get([STORAGE_KEYS.SHOW_MOVABLE_ORB, STORAGE_KEYS.USE_FLOATING_WINDOW], (result) => {
      if (result[STORAGE_KEYS.SHOW_MOVABLE_ORB] !== undefined) setShowMovableOrb(result[STORAGE_KEYS.SHOW_MOVABLE_ORB]);
      if (result[STORAGE_KEYS.USE_FLOATING_WINDOW] !== undefined) setUseFloatingWindow(result[STORAGE_KEYS.USE_FLOATING_WINDOW]);
      setLoaded(true);
    });
  }, []);

  const persist = (key: string, value: boolean) => {
    chrome.storage.local.set({ [key]: value });
  };

  const handleShowMovableOrbChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.checked;
    setShowMovableOrb(v);
    persist(STORAGE_KEYS.SHOW_MOVABLE_ORB, v);
  };

  const handleUseFloatingWindowChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.checked;
    setUseFloatingWindow(v);
    persist(STORAGE_KEYS.USE_FLOATING_WINDOW, v);
  };

  const openFloatingOrb = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_FLOATING_ORB' });
  };

  if (!loaded) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <main style={{ padding: 24, maxWidth: 420 }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Velto Sales Coach</h1>
      <p style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 24 }}>Extension settings</p>

      <label style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={showMovableOrb}
          onChange={handleShowMovableOrbChange}
        />
        <span style={{ fontSize: 14 }}>Show movable orb on pages</span>
      </label>
      <p style={{ fontSize: 12, color: '#71717a', marginLeft: 28, marginTop: -8, marginBottom: 16 }}>
        When enabled, a small orb appears on web pages. You can drag it anywhere. Click it to open the coach via the toolbar icon.
      </p>

      <label style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={useFloatingWindow}
          onChange={handleUseFloatingWindowChange}
        />
        <span style={{ fontSize: 14 }}>Allow floating orb window</span>
      </label>
      <p style={{ fontSize: 12, color: '#71717a', marginLeft: 28, marginTop: -8, marginBottom: 12 }}>
        When enabled, you can open a separate small window with the orb that can be moved anywhere on your screen (e.g. from the popup).
      </p>
      {useFloatingWindow && (
        <button
          type="button"
          onClick={openFloatingOrb}
          style={{
            marginLeft: 28,
            padding: '8px 14px',
            fontSize: 13,
            background: '#27272a',
            border: '1px solid #3f3f46',
            borderRadius: 8,
            color: '#fafafa',
            cursor: 'pointer',
          }}
        >
          Open floating orb window
        </button>
      )}
    </main>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<OptionsApp />);
}
