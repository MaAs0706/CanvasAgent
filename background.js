chrome.action.onClicked.addListener((tab) => toggleHudInTab(tab));

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-viewport-hud') return;
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([tab]) => toggleHudInTab(tab));
});

async function toggleHudInTab(tab) {
  if (!tab?.id || !tab.url?.startsWith('http')) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'VIEWPORT_HUD_TOGGLE' });
  } catch (_) {
    // Covers pages opened before an extension reload, and browsers that defer
    // automatic content-script injection until an explicit user gesture.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'VIEWPORT_HUD_TOGGLE' });
  }
}
