const OVERLAY_ID = 'velto-sales-coach-overlay';

const STORAGE_KEYS = {
  SHOW_MOVABLE_ORB: 'showMovableOrb',
  FAB_POSITION: 'fabPosition',
} as const;

const DEFAULT_POSITION = { bottom: 24, right: 24 };

function applyPosition(host: HTMLElement, pos: { x: number; y: number } | null) {
  if (pos != null) {
    host.style.left = `${pos.x}px`;
    host.style.top = `${pos.y}px`;
    host.style.right = '';
    host.style.bottom = '';
  } else {
    host.style.left = '';
    host.style.top = '';
    host.style.right = `${DEFAULT_POSITION.right}px`;
    host.style.bottom = `${DEFAULT_POSITION.bottom}px`;
  }
}

function createOverlay(fabPosition: { x: number; y: number } | null) {
  if (document.getElementById(OVERLAY_ID)) return;

  const host = document.createElement('div');
  host.id = OVERLAY_ID;
  host.style.cssText = 'position:fixed;z-index:2147483647;';
  applyPosition(host, fabPosition);
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    .velto-fab {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: linear-gradient(135deg, #18181b 0%, #27272a 100%);
      border: 2px solid #3f3f46;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      transition: all 0.3s ease;
      position: relative;
    }
    .velto-fab:hover {
      border-color: #d4ff32;
      transform: scale(1.08);
      box-shadow: 0 8px 32px rgba(212,255,50,0.15);
    }
    .velto-fab::after {
      content: '';
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: radial-gradient(circle, #d4ff32 0%, #a3cc00 100%);
      box-shadow: 0 0 12px rgba(212,255,50,0.4);
    }
    .velto-fab .pulse {
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      border: 2px solid #d4ff32;
      animation: fab-pulse 2.5s ease-out infinite;
      opacity: 0;
    }
    @keyframes fab-pulse {
      0% { transform: scale(1); opacity: 0.6; }
      100% { transform: scale(1.8); opacity: 0; }
    }
    .velto-fab.dragging {
      cursor: grabbing;
    }
    .velto-toast {
      position: fixed;
      bottom: 88px;
      right: 0;
      max-width: 220px;
      padding: 10px 14px;
      background: #27272a;
      border: 1px solid #3f3f46;
      border-radius: 10px;
      color: #fafafa;
      font-size: 12px;
      line-height: 1.4;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      z-index: 2147483647;
      animation: velto-toast-in 0.2s ease-out;
    }
    @keyframes velto-toast-in {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  shadow.appendChild(style);

  const fab = document.createElement('button');
  fab.className = 'velto-fab';
  fab.title = 'Open Velto Sales Coach';
  fab.innerHTML = '<span class="pulse"></span>';

  let dragStartX = 0;
  let dragStartY = 0;
  let hostStartLeft = 0;
  let hostStartTop = 0;
  let didDrag = false;

  fab.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    didDrag = false;
    fab.setPointerCapture(e.pointerId);
    fab.classList.add('dragging');
    const rect = host.getBoundingClientRect();
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    hostStartLeft = rect.left;
    hostStartTop = rect.top;

    const onMove = (e: PointerEvent) => {
      didDrag = true;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      host.style.left = `${hostStartLeft + dx}px`;
      host.style.top = `${hostStartTop + dy}px`;
      host.style.right = '';
      host.style.bottom = '';
    };
    const onUp = (e: PointerEvent) => {
      fab.releasePointerCapture(e.pointerId);
      fab.classList.remove('dragging');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const rect = host.getBoundingClientRect();
      chrome.storage.local.set({
        [STORAGE_KEYS.FAB_POSITION]: { x: Math.round(rect.left), y: Math.round(rect.top) },
      });
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp, { once: true });
  });

  fab.addEventListener('click', () => {
    if (didDrag) return;
    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
    const toast = document.createElement('div');
    toast.className = 'velto-toast';
    toast.textContent = 'Click the Velto icon in the toolbar to open.';
    shadow.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  });

  shadow.appendChild(fab);
}

function removeOverlay() {
  const host = document.getElementById(OVERLAY_ID);
  if (host) host.remove();
}

function init() {
  chrome.storage.local.get([STORAGE_KEYS.SHOW_MOVABLE_ORB, STORAGE_KEYS.FAB_POSITION], (result) => {
    const show = result[STORAGE_KEYS.SHOW_MOVABLE_ORB] !== false;
    const pos = result[STORAGE_KEYS.FAB_POSITION] ?? null;
    if (show) createOverlay(pos);
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[STORAGE_KEYS.SHOW_MOVABLE_ORB]) {
    const show = changes[STORAGE_KEYS.SHOW_MOVABLE_ORB].newValue !== false;
    if (show) {
      chrome.storage.local.get([STORAGE_KEYS.FAB_POSITION], (result) => {
        createOverlay(result[STORAGE_KEYS.FAB_POSITION] ?? null);
      });
    } else {
      removeOverlay();
    }
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
