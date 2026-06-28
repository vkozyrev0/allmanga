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
// opts.storage seeds localStorage BEFORE the script runs (e.g. saved position).
function load(opts = {}) {
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

  // Seed localStorage before the script reads it.
  for (const [key, value] of Object.entries(opts.storage || {})) {
    window.localStorage.setItem(key, value);
  }

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

// Simulate a drag of the badge from its current spot by (dx, dy) pixels.
function dragBadge(window, badge, dx, dy) {
  const startLeft = parseFloat(badge.style.left) || 0;
  const startTop = parseFloat(badge.style.top) || 0;
  badge.dispatchEvent(new window.MouseEvent('mousedown', {
    bubbles: true, clientX: 500, clientY: 500,
  }));
  window.dispatchEvent(new window.MouseEvent('mousemove', {
    bubbles: true, clientX: 500 + dx, clientY: 500 + dy,
  }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  return { startLeft, startTop };
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

// --- blocked-redirect counter ---------------------------------------------

test('tooltip starts at zero blocks', () => {
  const { window } = load();
  const badge = window.document.getElementById('rb-status-icon');
  assert.match(badge.title, /0 blocked this session \(0 total\)/);
});

test('tooltip counts each blocked redirect this session', () => {
  const { window } = load();
  const badge = window.document.getElementById('rb-status-icon');
  window.open('https://youtu-chan.com/a');
  assert.match(badge.title, /1 blocked this session/);
  window.history.pushState({}, '', 'https://youtu-chan.com/b');
  assert.match(badge.title, /2 blocked this session/);
});

test('total count persists across loads via localStorage', () => {
  const { window } = load({ storage: { 'rb-blocked-total': '5' } });
  const badge = window.document.getElementById('rb-status-icon');
  assert.match(badge.title, /\(5 total\)/);
  window.open('https://youtu-chan.com/a');
  assert.match(badge.title, /1 blocked this session \(6 total\)/);
  assert.strictEqual(window.localStorage.getItem('rb-blocked-total'), '6');
});

// --- draggable badge with remembered position ------------------------------
// jsdom defaults: innerWidth 1024, innerHeight 768; ICON_SIZE 22, MARGIN 12.
// So default (bottom-right, inset 12) = left 990 / top 734.
// Position is stored relative to the nearest corner: { corner, dx, dy }.

test('badge defaults to the bottom-right corner', () => {
  const { window } = load();
  const badge = window.document.getElementById('rb-status-icon');
  assert.strictEqual(badge.style.left, '990px');
  assert.strictEqual(badge.style.top, '734px');
});

test('restores a top-left corner offset', () => {
  const { window } = load({
    storage: { 'rb-icon-pos': JSON.stringify({ corner: 'LT', dx: 0, dy: 0 }) },
  });
  const badge = window.document.getElementById('rb-status-icon');
  assert.strictEqual(badge.style.left, '0px');
  assert.strictEqual(badge.style.top, '0px');
});

test('restores a bottom-right corner offset', () => {
  const { window } = load({
    storage: { 'rb-icon-pos': JSON.stringify({ corner: 'RB', dx: 0, dy: 0 }) },
  });
  const badge = window.document.getElementById('rb-status-icon');
  // flush against bottom-right: left = 1024-22, top = 768-22
  assert.strictEqual(badge.style.left, '1002px');
  assert.strictEqual(badge.style.top, '746px');
});

test('dragging saves position relative to the nearest corner', () => {
  const { window } = load();
  const badge = window.document.getElementById('rb-status-icon');
  dragBadge(window, badge, -400, -300); // from 990,734 -> 590,434
  assert.strictEqual(badge.style.left, '590px');
  assert.strictEqual(badge.style.top, '434px');

  // 590,434 is still in the bottom-right quadrant; insets from that corner:
  // dx = 1024-22-590 = 412, dy = 768-22-434 = 312
  const saved = JSON.parse(window.localStorage.getItem('rb-icon-pos'));
  assert.deepStrictEqual(saved, { corner: 'RB', dx: 412, dy: 312 });
});

test('dragging into the top-left quadrant anchors to that corner', () => {
  const { window } = load();
  const badge = window.document.getElementById('rb-status-icon');
  dragBadge(window, badge, -900, -700); // 990,734 -> 90,34 (top-left quadrant)
  const saved = JSON.parse(window.localStorage.getItem('rb-icon-pos'));
  assert.deepStrictEqual(saved, { corner: 'LT', dx: 90, dy: 34 });
});

test('a dragged position survives a reload', () => {
  const first = load();
  const badge1 = first.window.document.getElementById('rb-status-icon');
  dragBadge(first.window, badge1, -400, -300);
  const savedPos = first.window.localStorage.getItem('rb-icon-pos');

  // Simulate a fresh page load carrying the persisted position forward.
  const second = load({ storage: { 'rb-icon-pos': savedPos } });
  const badge2 = second.window.document.getElementById('rb-status-icon');
  assert.strictEqual(badge2.style.left, '590px');
  assert.strictEqual(badge2.style.top, '434px');
});

test('keeps its distance from the anchored corner when the viewport shrinks', () => {
  const { window } = load({
    storage: { 'rb-icon-pos': JSON.stringify({ corner: 'RB', dx: 12, dy: 12 }) },
  });
  const badge = window.document.getElementById('rb-status-icon');
  assert.strictEqual(badge.style.left, '990px'); // 1024-22-12

  window.innerWidth = 800;
  window.innerHeight = 600;
  window.dispatchEvent(new window.Event('resize'));

  // Still 12px from the bottom-right corner: left = 800-22-12, top = 600-22-12
  assert.strictEqual(badge.style.left, '766px');
  assert.strictEqual(badge.style.top, '566px');
});
