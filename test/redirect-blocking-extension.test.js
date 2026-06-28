'use strict';

// Black-box behavioral tests for the userscript, run against a simulated
// allmanga.to page via jsdom. The actual, unmodified script is loaded into the
// page and we assert observable behavior (navigation prevented, scripts removed,
// pop-ups blocked, history rewrites) rather than reaching into private internals.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SCRIPT_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'redirect-blocking-extension.js'),
  'utf8'
);

// Build a fresh allmanga.to page, stub window.open so we can see pass-throughs,
// load the script, and return handles for assertions.
function load() {
  const virtualConsole = new VirtualConsole();
  // Assigning window.location.href in jsdom raises a "Not implemented:
  // navigation" jsdomError. That's expected here — swallow it so test output
  // stays clean.
  virtualConsole.on('jsdomError', () => {});

  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: 'https://allmanga.to/',
    runScripts: 'outside-only',
    virtualConsole,
  });

  const { window } = dom;

  // Replace window.open BEFORE loading the script so the script captures this
  // stub as its `originalWindowOpen`. A call reaching the stub == "allowed".
  const openCalls = [];
  window.open = function (...args) {
    openCalls.push(args);
    return 'OPENED';
  };

  // Silence the script's own console.log noise.
  window.console.log = () => {};

  window.eval(SCRIPT_SOURCE);

  return { dom, window, openCalls };
}

// Dispatch a real click on a freshly-created anchor and report whether the
// script cancelled the navigation.
function clickAnchor(window, href) {
  const a = window.document.createElement('a');
  a.href = href;
  a.textContent = 'link';
  window.document.body.appendChild(a);
  const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  a.dispatchEvent(ev);
  return ev.defaultPrevented;
}

// --- window.open / rewriteUrl branch coverage -----------------------------

test('blocks window.open to a blocked domain', () => {
  const { window, openCalls } = load();
  assert.strictEqual(window.open('https://youtu-chan.com/ad'), null);
  assert.strictEqual(openCalls.length, 0, 'original window.open must not run');
});

test('blocks window.open to a blocked subdomain (substring match)', () => {
  const { window } = load();
  assert.strictEqual(window.open('https://ads.youtu-chan.com/ad'), null);
});

test('allows window.open to the same site', () => {
  const { window, openCalls } = load();
  assert.strictEqual(window.open('https://allmanga.to/manga/1'), 'OPENED');
  assert.strictEqual(openCalls.length, 1);
});

test('passes an unparseable URL through unchanged (catch-returns-input regression)', () => {
  const { window, openCalls } = load();
  const weird = 'http://[invalid';
  assert.strictEqual(window.open(weird), 'OPENED');
  assert.strictEqual(openCalls[0][0], weird);
});

test('passes a falsy URL through unchanged (null-guard regression)', () => {
  const { window, openCalls } = load();
  assert.strictEqual(window.open(''), 'OPENED');
  assert.strictEqual(openCalls.length, 1);
});

// --- click interception ----------------------------------------------------

test('prevents navigation on a link to a blocked domain', () => {
  const { window } = load();
  assert.strictEqual(clickAnchor(window, 'https://youtu-chan.com/go'), true);
});

test('allows navigation on a same-site link', () => {
  const { window } = load();
  assert.strictEqual(clickAnchor(window, 'https://allmanga.to/manga/42'), false);
});

// --- MutationObserver script removal --------------------------------------

test('removes an injected script from a blocked domain', async () => {
  const { window } = load();
  const s = window.document.createElement('script');
  s.src = 'https://youtu-chan.com/redirect.js';
  window.document.documentElement.appendChild(s);
  await new Promise((r) => setTimeout(r, 10)); // observer callback is async
  assert.strictEqual(s.isConnected, false);
});

test('leaves a legitimate same-site script in place', async () => {
  const { window } = load();
  const s = window.document.createElement('script');
  s.src = 'https://allmanga.to/app.js';
  window.document.documentElement.appendChild(s);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(s.isConnected, true);
});

// --- history wrappers ------------------------------------------------------

test('pushState with a null URL does not throw and keeps the current URL', () => {
  const { window } = load();
  const before = window.location.href;
  assert.doesNotThrow(() => window.history.pushState({}, '', null));
  assert.strictEqual(window.location.href, before);
});

test('pushState rewrites a blocked URL back to the original host', () => {
  const { window } = load();
  window.history.pushState({}, '', 'https://youtu-chan.com/page?q=1#h');
  assert.strictEqual(window.location.href, 'https://allmanga.to/page?q=1#h');
});

test('replaceState rewrites a blocked URL back to the original host', () => {
  const { window } = load();
  window.history.replaceState({}, '', 'https://youtu-chan.com/x');
  assert.strictEqual(window.location.href, 'https://allmanga.to/x');
});

// --- status badge ----------------------------------------------------------

test('injects a status badge containing an SVG icon', () => {
  const { window } = load();
  const badge = window.document.getElementById('rb-status-icon');
  assert.ok(badge, 'badge element should be present');
  assert.strictEqual(badge.parentNode, window.document.body);
  assert.ok(badge.querySelector('svg'), 'badge should contain an svg');
  assert.match(badge.title, /active/i);
});

test('does not inject a duplicate badge', () => {
  const { window } = load();
  // Re-running the injector must be a no-op (id guard).
  window.eval(SCRIPT_SOURCE);
  assert.strictEqual(
    window.document.querySelectorAll('#rb-status-icon').length,
    1
  );
});
