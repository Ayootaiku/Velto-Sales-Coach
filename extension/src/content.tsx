const OVERLAY_ID = 'velto-sales-coach-overlay';

function createOverlay() {
  if (document.getElementById(OVERLAY_ID)) return;

  const host = document.createElement('div');
  host.id = OVERLAY_ID;
  host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;';
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
  `;
  shadow.appendChild(style);

  const fab = document.createElement('button');
  fab.className = 'velto-fab';
  fab.title = 'Open Velto Sales Coach';
  fab.innerHTML = '<span class="pulse"></span>';
  fab.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
  });
  shadow.appendChild(fab);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createOverlay);
} else {
  createOverlay();
}
