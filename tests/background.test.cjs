const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup() {
  const listeners = {};
  const calls = [];
  let count = 11;
  let fail = false;
  let pendingQuery = null;
  const event = name => ({addListener(fn) {listeners[name] = fn;}});
  const chrome = {
    action: Object.fromEntries(['setBadgeBackgroundColor','setBadgeText','setTitle'].map(name => [name, async value => {calls.push([name, value]);}])),
    runtime: {onInstalled: event('install'), onStartup: event('startup')},
    tabs: {
      query: async query => {
        assert.equal(query.windowType, 'normal');
        if (fail) throw new Error('temporary failure');
        if (pendingQuery) {const fn = pendingQuery; pendingQuery = null; return fn();}
        return Array(count).fill({});
      },
      ...Object.fromEntries(['onCreated','onRemoved','onAttached','onDetached','onReplaced'].map(name => [name, event(name)]))
    },
    windows: {onCreated: event('windowCreated'), onRemoved: event('windowRemoved')}
  };
  const context = vm.createContext({chrome, console: {warn() {}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), context);
  return {listeners, calls, run: code => vm.runInContext(code, context), setCount: value => {count = value;}, setFailure: value => {fail = value;}, delayQuery: fn => {pendingQuery = fn;}};
}
const badge = h => h.calls.filter(([name]) => name === 'setBadgeText').at(-1)[1].text;

test('initial count, startup, install, tab and window events update the badge without the popup', async () => {
  const h = setup(); await h.run('updating');
  assert.equal(badge(h), '11');
  for (const [index, listener] of Object.values(h.listeners).entries()) {
    h.setCount(index + 1); await listener(); assert.equal(badge(h), String(index + 1));
  }
  assert.equal(h.calls.find(([name]) => name === 'setBadgeBackgroundColor')[1].color, '#276747');
});

test('zero, singular and large counts have accurate tooltip text', async () => {
  const h = setup(); await h.run('updating');
  for (const count of [0, 1, 101, 9999, 10000]) {
    h.setCount(count); await h.listeners.onCreated();
    assert.equal(badge(h), count > 9999 ? '10k+' : String(count));
    const title = h.calls.filter(([name]) => name === 'setTitle').at(-1)[1].title;
    assert.equal(title, 'Tabs — ' + count + ' open ' + (count === 1 ? 'tab' : 'tabs'));
  }
});

test('overlapping updates finish with the latest count', async () => {
  const h = setup(); await h.run('updating');
  let resolve;
  h.delayQuery(() => new Promise(r => {resolve = r;}));
  const first = h.listeners.onCreated();
  h.setCount(3); const second = h.listeners.onRemoved();
  resolve(Array(12).fill({}));
  await Promise.all([first, second]);
  assert.equal(badge(h), '3');
});

test('a failed query can recover on the next event', async () => {
  const h = setup(); await h.run('updating');
  h.setFailure(true); await h.listeners.onRemoved();
  h.setFailure(false); h.setCount(8); await h.listeners.onCreated();
  assert.equal(badge(h), '8');
});
