const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup({extension = true} = {}) {
  let document;
  const elements = {};
  class Element {
    constructor(tag) {
      Object.assign(this, {tag, children: [], dataset: {}, attrs: {}, listeners: {}, value: '', textContent: '', scrollTop: 0});
      this.classList = {
        contains: name => (this.className || '').split(' ').includes(name),
        add: (...names) => {this.className = [...new Set([...(this.className || '').split(' ').filter(Boolean), ...names])].join(' ');},
        remove: (...names) => {this.className = (this.className || '').split(' ').filter(name => !names.includes(name)).join(' ');},
        toggle: (name, on) => on ? this.classList.add(name) : this.classList.remove(name)
      };
    }
    append(...els) { for (const el of els) {el.parent = this; this.children.push(el);} }
    replaceChildren(...els) {
      if (this.contains(document.activeElement)) document.activeElement = null;
      this.children = []; this.scrollTop = 0; this.append(...els);
    }
    setAttribute(k, v) {this.attrs[k] = v;}
    addEventListener(k, f) {this.listeners[k] = f;}
    contains(el) {return el === this || this.children.some(child => child.contains(el));}
    matches(selector) {
      if (selector === '[data-key]') return Boolean(this.dataset.key);
      if (selector === ':focus') return this === document.activeElement;
      const [tag, cls] = selector.split('.');
      return (!tag || this.tag === tag) && (!cls || this.classList.contains(cls));
    }
    closest(selector) {return selector.split(', ').some(s => this.matches(s)) ? this : this.parent?.closest(selector);}
    querySelectorAll(selector) {
      const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
      if (selector === '*') return all;
      if (selector === '.drop-eligible .window-heading') return all.filter(el => el.matches('.window-heading') && el.parent?.classList.contains('drop-eligible'));
      return all.filter(el => el.matches(selector));
    }
    querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
    focus(options) {document.activeElement = this; if (!options?.preventScroll) elements['#windows'].scrollTop = 0;}
  }
  for (const key of ['#search', '#summary', '#windows', '#status', 'footer']) elements[key] = new Element(key);
  document = {activeElement: null, listeners: {}, querySelector: s => elements[s], createElement: t => new Element(t), createElementNS: (_, t) => new Element(t), addEventListener(k, f) {this.listeners[k] = f;}};
  let windows = [
    {id: 7, tabs: [{id: 1, title: '<img onerror=alert(1)>', url: 'https://example.com', pinned: true, index: 0}, {id: 2, title: 'Inbox', url: 'https://mail.google.com', index: 1}]},
    {id: 8, tabs: [{id: 3, title: 'Docs', url: 'https://docs.google.com', pinned: true, index: 0}, {id: 4, title: 'News', index: 1}]}
  ];
  const calls = [];
  let failMove = false;
  const event = {addListener() {}};
  const chrome = {
    runtime: {getURL: p => 'chrome-extension://test' + p},
    tabs: {
      query() {},
      update: async (...args) => calls.push(['update', ...args]),
      remove: async id => {windows.forEach(win => {win.tabs = win.tabs.filter(tab => tab.id !== id);});},
      move: async (id, properties) => {
        calls.push(['move', id, {...properties}]);
        if (failMove) throw new Error('Window closed');
        const source = windows.find(win => win.tabs.some(tab => tab.id === id));
        const tab = source.tabs.find(tab => tab.id === id);
        source.tabs = source.tabs.filter(tab => tab.id !== id);
        const destination = windows.find(win => win.id === properties.windowId);
        destination.tabs.splice(properties.index === -1 ? destination.tabs.length : properties.index, 0, tab);
        windows = windows.filter(win => win.tabs.length);
        windows.forEach(win => win.tabs.forEach((tab, i) => {tab.index = i;}));
      },
      ...Object.fromEntries(['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onAttached', 'onDetached', 'onActivated'].map(k => [k, event]))
    },
    windows: {getCurrent: async () => ({id: 7}), getAll: async () => {calls.push(['getAll']); return structuredClone(windows);}, update: async (...args) => calls.push(['focus', ...args]), onCreated: event, onRemoved: event}
  };
  const context = vm.createContext({document, ...(extension ? {chrome} : {}), URL, setTimeout, clearTimeout, window: {close: () => calls.push(['closed'])}});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8'), context);
  return {elements, document, calls, run: code => vm.runInContext(code, context), failMove: () => {failMove = true;}};
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function dragEvent(target) {
  return {target, prevented: false, preventDefault() {this.prevented = true;}, dataTransfer: {setData() {}, dropEffect: '', effectAllowed: ''}};
}

test('dragging moves a real tab to another window and preserves scroll', async () => {
  const h = setup(); await settle();
  const list = h.elements['#windows']; list.scrollTop = 240;
  const sourceRow = list.children[0].children[1].children[1];
  const target = list.children[1];
  sourceRow.listeners.dragstart(dragEvent(sourceRow.children[0]));
  assert.equal(list.classList.contains('is-moving'), true);
  const over = dragEvent(target); target.listeners.dragover(over);
  assert.equal(over.prevented, true);
  assert.equal(over.dataTransfer.dropEffect, 'move');
  assert.equal(target.classList.contains('drop-target'), true);
  target.listeners.drop(dragEvent(target)); await settle();
  assert.deepEqual(h.calls.find(call => call[0] === 'move'), ['move', 2, {windowId: 8, index: -1}]);
  assert.equal(h.run('windows.find(w => w.id === 8).tabs.at(-1).id'), 2);
  assert.equal(list.scrollTop, 240);
  assert.equal(list.attrs['aria-busy'], 'false');
});

test('collapsed destinations accept drops, pinned tabs stay in pinned region', async () => {
  const h = setup(); await settle();
  h.run('collapsed.add(8); render()');
  const list = h.elements['#windows'];
  const target = list.children[1];
  assert.equal(target.children[1].hidden, true);
  const row = list.children[0].children[1].children[0];
  row.listeners.dragstart(dragEvent(row.children[0]));
  target.listeners.drop(dragEvent(target)); await settle();
  assert.deepEqual(h.calls.find(call => call[0] === 'move'), ['move', 1, {windowId: 8, index: 1}]);
  assert.equal(h.run('collapsed.has(8)'), false);
});

test('search-hidden windows become destinations and move buttons work without dragging', async () => {
  const h = setup(); await settle();
  h.elements['#search'].value = 'Inbox'; h.elements['#search'].listeners.input();
  const list = h.elements['#windows'];
  assert.equal(list.children[1].hidden, true);
  list.children[0].children[1].children[0].children[2].listeners.click();
  assert.equal(list.classList.contains('is-moving'), true);
  assert.equal(list.children[1].classList.contains('drop-eligible'), true);
  assert.equal(h.document.activeElement, list.children[1].children[0]);
  list.children[1].children[0].listeners.click(); await settle();
  assert.equal(h.calls.find(call => call[0] === 'move')[1], 2);
});

test('same-window/external drops do nothing; Escape cancels', async () => {
  const h = setup(); await settle();
  const list = h.elements['#windows'];
  list.children[1].listeners.drop(dragEvent(list.children[1]));
  const row = list.children[0].children[1].children[0];
  row.listeners.dragstart(dragEvent(row.children[0]));
  list.children[0].listeners.drop(dragEvent(list.children[0]));
  assert.equal(h.calls.some(call => call[0] === 'move'), false);
  h.document.listeners.keydown({key: 'Escape', preventDefault() {}, stopPropagation() {}});
  assert.equal(h.run('pickedTab'), null);
  assert.equal(list.classList.contains('is-moving'), false);
});

test('refreshes are deferred during drag and failure leaves tabs intact', async () => {
  const h = setup(); await settle();
  const list = h.elements['#windows']; const row = list.children[0].children[1].children[0];
  row.listeners.dragstart(dragEvent(row.children[0]));
  const before = h.calls.length;
  await h.run('refresh()'); assert.equal(h.calls.length, before);
  assert.equal(h.run('refreshDeferred'), true);
  row.listeners.dragend();
  assert.equal(h.run('nativeDragging'), false);
  h.failMove();
  await h.run('moveTab(1, 7, 8)');
  assert.match(h.elements['#status'].textContent, /Could not move/);
  assert.equal(h.run('windows.find(w => w.id === 7).tabs.length'), 2);
  assert.equal(h.run('movePending'), false);
});

test('preview moves the final source tab and removes the empty window', async () => {
  const h = setup({extension: false}); await settle();
  await h.run('moveTab(8, 3, 2)');
  await h.run('moveTab(9, 3, 2)');
  assert.equal(h.run('windows.some(w => w.id === 3)'), false);
  assert.equal(h.elements['#summary'].textContent, '9 tabs · 2 windows');
});

test('closing still preserves scroll and safe titles remain text', async () => {
  const h = setup(); await settle();
  const list = h.elements['#windows']; list.scrollTop = 240;
  const row = list.children[0].children[1].children[0];
  assert.equal(row.children[0].children[1].textContent, '<img onerror=alert(1)>');
  await row.children[1].listeners.click();
  assert.equal(list.scrollTop, 240);
  assert.equal(h.elements['#summary'].textContent, '3 tabs · 2 windows');
});
