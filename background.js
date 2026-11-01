// Recount from Chrome rather than storing a count that can drift after restarts.
let updating = null;
let updateRequested = false;

function updateTabCount() {
  updateRequested = true;
  if (updating) return updating;
  updating = (async () => {
    while (updateRequested) {
      updateRequested = false;
      try {
        // Match the normal browser windows shown in the popup.
        const tabs = await chrome.tabs.query({windowType: 'normal'});
        const count = tabs.length;
        await chrome.action.setBadgeBackgroundColor({color: '#276747'});
        await chrome.action.setBadgeText({text: count > 9999 ? '10k+' : String(count)});
        await chrome.action.setTitle({title: 'Tabs — ' + count + ' open ' + (count === 1 ? 'tab' : 'tabs')});
      } catch (error) {
        console.warn('Could not update the tab count badge.', error);
      }
    }
  })().finally(() => { updating = null; });
  return updating;
}

// Register synchronously so Chrome can wake the worker while the popup is closed.
chrome.runtime.onInstalled.addListener(updateTabCount);
chrome.runtime.onStartup.addListener(updateTabCount);
for (const event of ['onCreated', 'onRemoved', 'onAttached', 'onDetached', 'onReplaced']) {
  chrome.tabs[event].addListener(updateTabCount);
}
chrome.windows.onCreated.addListener(updateTabCount);
chrome.windows.onRemoved.addListener(updateTabCount);
void updateTabCount();
