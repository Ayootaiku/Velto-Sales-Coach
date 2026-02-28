chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OPEN_SIDE_PANEL') {
    const windowId = sender.tab?.windowId;
    if (windowId != null) {
      chrome.sidePanel.open({ windowId }).then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
    } else {
      chrome.windows.getCurrent((win) => {
        if (win?.id != null) {
          chrome.sidePanel.open({ windowId: win.id }).then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
        } else {
          sendResponse({ success: false });
        }
      });
    }
    return true;
  }
  if (message.type === 'OPEN_FLOATING_ORB') {
    chrome.windows.create({
      type: 'popup',
      url: chrome.runtime.getURL('orb-window.html'),
      width: 80,
      height: 80,
      focused: true,
    }, (win) => {
      sendResponse({ success: !!win, id: win?.id });
    });
    return true;
  }
  return true;
});
