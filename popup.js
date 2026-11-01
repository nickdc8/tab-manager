/* No page scripts, remote libraries, analytics, or background process. */
const $ = (selector) => document.querySelector(selector);
const icons = {
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  move: '<path d="M4 12h16m-5-5 5 5-5 5M4 6v12"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18"/>'
};
function icon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  svg.innerHTML = icons[name];
  return svg;
}
let windows = [];
let currentWindowId;
let generation = 0;
let refreshTimer;
let pickedTab = null;
let nativeDragging = false;
let movePending = false;
let refreshDeferred = false;

function clearMove() {
  pickedTab = null;
  nativeDragging = false;
  $('#windows').classList.remove('is-moving');
  for (const section of $('#windows').querySelectorAll('.window')) section.classList.remove('drop-target', 'drop-eligible');
  for (const row of $('#windows').querySelectorAll('.tab-row')) row.classList.remove('drag-source');
  $('footer').textContent = 'Click a tab to switch to it · Drag to move';
  if (refreshDeferred) { refreshDeferred = false; scheduleRefresh(); }
}
function pickTab(tab, win, dragging = false) {
  if (movePending) return false;
  pickedTab = {id: tab.id, windowId: win.id};
  nativeDragging = dragging;
  $('#windows').classList.add('is-moving');
  for (const section of $('#windows').querySelectorAll('.window')) {
    section.classList.toggle('drop-eligible', Number(section.dataset.windowId) !== win.id);
  }
  $('footer').textContent = 'Choose another window to move this tab · Esc to cancel';
  return true;
}
async function moveTab(tabId, sourceId, destinationId) {
  if (movePending || sourceId === destinationId) return;
  const source = windows.find(win => win.id === sourceId);
  const destination = windows.find(win => win.id === destinationId);
  const tab = source?.tabs.find(tab => tab.id === tabId);
  if (!tab || !destination) { clearMove(); return; }
  clearMove();
  movePending = true;
  $('#windows').setAttribute('aria-busy', 'true');
  $('#status').textContent = '';
  try {
    // Pinned tabs remain in the pinned region of the destination window.
    const index = tab.pinned ? destination.tabs.filter(tab => tab.pinned).length : -1;
    if (isExtension) await chrome.tabs.move(tabId, {windowId: destinationId, index});
    else {
      source.tabs = source.tabs.filter(tab => tab.id !== tabId);
      destination.tabs.splice(index === -1 ? destination.tabs.length : index, 0, tab);
      windows = windows.filter(win => win.tabs.length);
    }
    collapsed.delete(destinationId);
    if (isExtension) await refresh(); else render();
    $('footer').textContent = 'Tab moved to Window ' + labels.get(destinationId);
  } catch {
    $('#status').textContent = 'Could not move this tab. The tab or window may have closed, or Chrome may not allow this move. Try again.';
    if (isExtension) await refresh();
  } finally {
    movePending = false;
    $('#windows').setAttribute('aria-busy', 'false');
  }
}

const collapsed = new Set();
const labels = new Map();
const isExtension = Boolean(globalThis.chrome?.tabs?.query);

function titleOf(tab) { return tab.title || tab.url || 'Untitled tab'; }
function matchingTabs(tabs, query) {
  return tabs.filter(tab => (titleOf(tab) + ' ' + (tab.url || '')).toLocaleLowerCase().includes(query));
}
function render() {
  const focused = document.activeElement?.dataset;
  const focusKey = focused?.key;
  const query = $('#search').value.trim().toLocaleLowerCase();
  const container = $('#windows');
  const scroll = container.scrollTop;
  const total = windows.reduce((sum, win) => sum + win.tabs.length, 0);
  $('#summary').textContent = total + ' ' + (total === 1 ? 'tab' : 'tabs') + ' · ' + windows.length + ' ' + (windows.length === 1 ? 'window' : 'windows');
  container.replaceChildren();
  let visibleCount = 0;
  for (const win of windows) {
    const tabs = matchingTabs(win.tabs, query);
    visibleCount += tabs.length;
    const section = document.createElement('section');
    section.className = 'window';
    section.dataset.windowId = String(win.id);
    section.hidden = !tabs.length;
    if (pickedTab && pickedTab.windowId !== win.id) section.classList.add('drop-eligible');
    section.addEventListener('dragover', event => {
      if (!nativeDragging || !pickedTab || pickedTab.windowId === win.id || movePending) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      section.classList.add('drop-target');
    });
    section.addEventListener('dragleave', event => {
      if (!section.contains(event.relatedTarget)) section.classList.remove('drop-target');
    });
    section.addEventListener('drop', event => {
      if (!nativeDragging || !pickedTab || pickedTab.windowId === win.id || movePending) return;
      event.preventDefault();
      const {id, windowId} = pickedTab;
      void moveTab(id, windowId, win.id);
    });
    const heading = document.createElement('button');
    heading.className = 'window-heading';
    heading.dataset.key = 'window-' + win.id;
    const expanded = query !== '' || !collapsed.has(win.id);
    heading.setAttribute('aria-expanded', String(expanded));
    heading.setAttribute('aria-controls', 'tabs-' + win.id);
    heading.append(icon('window'));
    const name = document.createElement('span');
    name.className = 'window-name';
    name.textContent = 'Window ' + labels.get(win.id);
    heading.append(name);
    if (win.id === currentWindowId) {
      const badge = document.createElement('span');
      badge.className = 'current';
      badge.textContent = 'Current';
      heading.append(badge);
    }
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = query ? tabs.length + '/' + win.tabs.length : win.tabs.length;
    heading.append(count, icon('chevron', 'chevron'));
    heading.addEventListener('click', () => {
      if (pickedTab) { void moveTab(pickedTab.id, pickedTab.windowId, win.id); return; }
      if (query) return;
      collapsed.has(win.id) ? collapsed.delete(win.id) : collapsed.add(win.id);
      render();
    });
    const list = document.createElement('div');
    list.id = 'tabs-' + win.id;
    list.hidden = !expanded;
    for (const tab of tabs) {
      const row = document.createElement('div');
      row.className = 'tab-row';
      row.draggable = true;
      row.addEventListener('dragstart', event => {
        if (event.target.closest('.close, .move') || !pickTab(tab, win, true)) { event.preventDefault(); return; }
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-tabs-tab', String(tab.id));
        row.classList.add('drag-source');
      });
      row.addEventListener('dragend', clearMove);
      const link = document.createElement('button');
      link.className = 'tab-link';
      link.dataset.key = 'tab-' + tab.id;
      link.title = titleOf(tab) + (tab.url ? '\n' + tab.url : '');
      const fallback = icon('globe', 'favicon fallback');
      if (isExtension && tab.url) {
        const img = document.createElement('img');
        img.className = 'favicon';
        img.alt = '';
        img.draggable = false;
        const url = new URL(chrome.runtime.getURL('/_favicon/'));
        url.searchParams.set('pageUrl', tab.url);
        url.searchParams.set('size', '32');
        img.src = url.href;
        img.addEventListener('error', () => img.replaceWith(fallback), {once: true});
        link.append(img);
      } else link.append(fallback);
      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = titleOf(tab);
      link.append(title);
      link.addEventListener('click', async () => {
        if (!isExtension) { $('#status').textContent = 'Preview only. Load the extension to switch real tabs.'; return; }
        try {
          await chrome.tabs.update(tab.id, {active: true});
          await chrome.windows.update(win.id, {focused: true});
          window.close();
        } catch { $('#status').textContent = 'This tab is no longer available.'; await refresh(); }
      });
      const close = document.createElement('button');
      close.className = 'close';
      close.dataset.key = 'close-' + tab.id;
      close.title = 'Close tab';
      close.setAttribute('aria-label', 'Close ' + titleOf(tab));
      close.append(icon('close'));
      close.addEventListener('click', async () => {
        close.disabled = true;
        try {
          if (isExtension) await chrome.tabs.remove(tab.id);
          else windows = windows.map(w => ({...w, tabs: w.tabs.filter(t => t.id !== tab.id)})).filter(w => w.tabs.length);
          $('#status').textContent = '';
          if (isExtension) await refresh(); else render();
          if (!container.querySelector(':focus')) {
            const next = container.querySelector('button.tab-link');
            (next || $('#search')).focus({preventScroll: true});
          }
        } catch {
          $('#status').textContent = 'Could not close this tab. Please try again.';
          close.disabled = false;
        }
      });
      const move = document.createElement('button');
      move.className = 'move';
      move.dataset.key = 'move-' + tab.id;
      move.title = 'Move tab to another window';
      move.setAttribute('aria-label', 'Move ' + titleOf(tab) + ' to another window');
      move.append(icon('move'));
      move.addEventListener('click', () => {
        if (pickTab(tab, win)) {
          const destination = [...container.querySelectorAll('.drop-eligible .window-heading')][0];
          destination?.focus({preventScroll: true});
        }
      });
      row.append(link, close, move);
      list.append(row);
    }
    section.append(heading, list);
    container.append(section);
  }
  if (!visibleCount) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = query ? 'No tabs match “' + $('#search').value.trim() + '”' : 'No open tabs.';
    container.append(empty);
  }
  container.scrollTop = scroll;
  if (focusKey) {
    const target = [...container.querySelectorAll('[data-key]')].find(el => el.dataset.key === focusKey);
    if (target) target.focus({preventScroll: true});
  }
}
async function refresh() {
  if (nativeDragging) { refreshDeferred = true; return; }
  const request = ++generation;
  try {
    const result = await chrome.windows.getAll({populate: true, windowTypes: ['normal']});
    if (request !== generation) return;
    if (nativeDragging) { refreshDeferred = true; return; }
    windows = result.filter(w => w.tabs?.length).map(w => ({...w, tabs: w.tabs.sort((a,b) => a.index - b.index)}));
    windows.sort((a,b) => Number(b.id === currentWindowId) - Number(a.id === currentWindowId));
    for (const win of windows) if (!labels.has(win.id)) labels.set(win.id, labels.size + 1);
    render();
  } catch { $('#status').textContent = 'Could not load tabs. Reopen the extension to try again.'; }
}
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 70); }
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && pickedTab) {
    event.preventDefault(); event.stopPropagation();
    clearMove();
  }
}, true);
$('#search').addEventListener('input', render);
$('#search').addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#search').value) {
    event.preventDefault(); event.stopPropagation(); $('#search').value = ''; render();
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault(); $('#windows .tab-link')?.focus();
  }
});
async function start() {
  if (isExtension) {
    try { currentWindowId = (await chrome.windows.getCurrent()).id; } catch {}
    for (const event of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onAttached', 'onDetached', 'onActivated']) chrome.tabs[event].addListener(scheduleRefresh);
    chrome.windows.onCreated.addListener(scheduleRefresh);
    chrome.windows.onRemoved.addListener(scheduleRefresh);
    await refresh();
  } else {
    currentWindowId = 1;
    const groups = [
      [['Inbox — Gmail','mail.google.com'],['tab-manager · GitHub','github.com'],['Extension explorations — Figma','figma.com'],['Project notes — Google Docs','docs.google.com']],
      [['Khruangbin — Live at Sydney Opera House','youtube.com'],['Chrome extensions — Wikipedia','wikipedia.org'],['Minimal tab manager inspiration','google.com']],
      [['BBC News','bbc.co.uk'],['Discover Weekly — Spotify','spotify.com']]
    ];
    let id = 0;
    windows = groups.map((tabs, index) => ({id: index + 1, tabs: tabs.map(([title, host]) => ({id: ++id, title, url: 'https://' + host}))}));
    windows.forEach(w => labels.set(w.id, w.id));
    render();
  }
}
start();
