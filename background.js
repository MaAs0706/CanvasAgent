chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-viewport-hud') return;

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([tab]) => {
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'VIEWPORT_HUD_TOGGLE' });
  });
});
