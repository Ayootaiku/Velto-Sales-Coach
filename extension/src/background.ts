chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'OPEN_SIDE_PANEL') {
    // Popup cannot be opened programmatically; FAB click is a no-op. Optional: content script shows toast.
    sendResponse({ success: true });
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
