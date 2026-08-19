'use strict';

// Black-box behavioral tests for the userscript, run against a simulated
// allmanga.to / mkissa.to page via jsdom. The actual, unmodified script is
// loaded into the page and we assert observable behavior (navigation prevented,
// scripts removed, pop-ups blocked, history rewrites) rather than reaching into
// private internals.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SCRIPT_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'redirect-blocking-extension.js'),
  'utf8'
);

// Build a fresh page on the given host (default allmanga.to), stub window.open
// so we can see pass-throughs, load the script, and return handles for
// assertions. opts.storage seeds localStorage BEFORE the script runs
// (e.g. saved position).
function load(opts = {}) {
  const virtualConsole = new VirtualConsole();
  // Assigning window.location.href in jsdom raises a "Not implemented:
  // navigation" jsdomError. That's expected here — swallow it so test output
  // stays clean.
  virtualConsole.on('jsdomError', () => {});

  const pageUrl = opts.url || 'https://allmanga.to/';
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: pageUrl,
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

  // Optional Navigation API stub so we can fire the same event Chromium
  // emits for location.href = 'https://isekai2nd.com/...' .
  const navigateListeners = [];
  if (opts.withNavigation) {
    window.navigation = {
      addEventListener(type, fn) {
        if (type === 'navigate') navigateListeners.push(fn);
      },
    };
  }

  // Silence the script's own console.log noise.
  window.console.log = () => {};

  window.eval(SCRIPT_SOURCE);

  return { dom, window, openCalls, navigateListeners };
}

function fireNavigate(listeners, destUrl) {
  const event = {
    hashChange: false,
    downloadRequest: null,
    cancelable: true,
    defaultPrevented: false,
    destination: { url: destUrl },
    preventDefault() { this.defaultPrevented = true; },
  };
  for (const fn of listeners) fn(event);
  return event;
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

test('pushState rewrites an off-site manga path back to the original host', () => {
  const { window } = load();
  window.history.pushState({}, '', 'https://youtu-chan.com/manga/page?q=1#h');
  assert.strictEqual(window.location.href, 'https://allmanga.to/manga/page?q=1#h');
});

test('replaceState rewrites an off-site manga path back to the original host', () => {
  const { window } = load();
  window.history.replaceState({}, '', 'https://youtu-chan.com/manga/x');
  assert.strictEqual(window.location.href, 'https://allmanga.to/manga/x');
});

test('pushState drops an off-site article URL and stays put', () => {
  const { window } = load();
  const before = window.location.href;
  window.history.pushState({}, '', 'https://isekai2nd.com/20-recommended-science-fiction-anime');
  assert.strictEqual(window.location.href, before);
});

// --- mkissa.to (same script, different @match host) ------------------------

test('on mkissa.to, allows window.open to that site', () => {
  const { window, openCalls } = load({ url: 'https://mkissa.to/' });
  assert.strictEqual(window.open('https://mkissa.to/manga/1'), 'OPENED');
  assert.strictEqual(openCalls.length, 1);
});

test('on mkissa.to, allows navigation on a same-site link', () => {
  const { window } = load({ url: 'https://mkissa.to/' });
  assert.strictEqual(clickAnchor(window, 'https://mkissa.to/manga/42'), false);
});

test('on mkissa.to, blocks window.open to a blocked domain', () => {
  const { window, openCalls } = load({ url: 'https://mkissa.to/' });
  assert.strictEqual(window.open('https://youtu-chan.com/ad'), null);
  assert.strictEqual(openCalls.length, 0, 'original window.open must not run');
});

test('on mkissa.to, pushState rewrites an off-site manga path back to mkissa.to', () => {
  const { window } = load({ url: 'https://mkissa.to/' });
  window.history.pushState({}, '', 'https://youtu-chan.com/manga/page?q=1#h');
  assert.strictEqual(window.location.href, 'https://mkissa.to/manga/page?q=1#h');
});

test('on mkissa.to, replaceState rewrites an off-site manga path back to mkissa.to', () => {
  const { window } = load({ url: 'https://mkissa.to/' });
  window.history.replaceState({}, '', 'https://youtu-chan.com/manga/x');
  assert.strictEqual(window.location.href, 'https://mkissa.to/manga/x');
});

const ISEKAI_HIJACK =
  'https://isekai2nd.com/20-recommended-science-fiction-anime-introducing-monumental-masterpieces-and-moving-images';
const MKISSA_CHAPTER =
  'https://mkissa.to/manga/wpehGDr8dzRkXdf2Y/chapter-325-sub';

test('on mkissa.to, next-page click to isekai2nd.com is cancelled and stays on the chapter', () => {
  const { window } = load({ url: MKISSA_CHAPTER });
  assert.strictEqual(clickAnchor(window, ISEKAI_HIJACK), true);
  assert.strictEqual(window.location.href, MKISSA_CHAPTER);
});

test('on mkissa.to, window.open to isekai2nd.com is blocked', () => {
  const { window, openCalls } = load({ url: MKISSA_CHAPTER });
  assert.strictEqual(window.open(ISEKAI_HIJACK), null);
  assert.strictEqual(openCalls.length, 0);
});

test('on mkissa.to, pushState to the isekai2nd.com article is dropped', () => {
  const { window } = load({ url: MKISSA_CHAPTER });
  window.history.pushState({}, '', ISEKAI_HIJACK);
  assert.strictEqual(window.location.href, MKISSA_CHAPTER);
});

test('on mkissa.to, Navigation API cancel keeps the chapter (location.href hijack)', () => {
  const { window, navigateListeners } = load({
    url: MKISSA_CHAPTER,
    withNavigation: true,
  });
  assert.ok(navigateListeners.length, 'script should subscribe to navigate');
  const ev = fireNavigate(navigateListeners, ISEKAI_HIJACK);
  assert.strictEqual(ev.defaultPrevented, true);
  assert.strictEqual(window.location.href, MKISSA_CHAPTER);
});

test('on mkissa.to, Navigation API rewrites a manga-path hijack onto this host', () => {
  const { window, navigateListeners } = load({
    url: MKISSA_CHAPTER,
    withNavigation: true,
  });
  const ev = fireNavigate(
    navigateListeners,
    'https://youtu-chan.com/manga/wpehGDr8dzRkXdf2Y/chapter-326-sub'
  );
  assert.strictEqual(ev.defaultPrevented, true);
});

test('on mkissa.to, form submit to isekai2nd.com is cancelled', () => {
  const { window } = load({ url: MKISSA_CHAPTER });
  const form = window.document.createElement('form');
  form.action = ISEKAI_HIJACK;
  form.method = 'GET';
  window.document.body.appendChild(form);
  const ev = new window.Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(ev);
  assert.strictEqual(ev.defaultPrevented, true);
  assert.strictEqual(window.location.href, MKISSA_CHAPTER);
});

test('on mkissa.to, removes a meta refresh to isekai2nd.com', async () => {
  const { window } = load({ url: MKISSA_CHAPTER });
  const meta = window.document.createElement('meta');
  meta.httpEquiv = 'refresh';
  meta.setAttribute('http-equiv', 'refresh');
  meta.content = '0;url=' + ISEKAI_HIJACK;
  window.document.head.appendChild(meta);
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(meta.isConnected, false);
});

test('on mkissa.to, still allows a same-site next-chapter link', () => {
  const { window } = load({ url: MKISSA_CHAPTER });
  assert.strictEqual(
    clickAnchor(window, 'https://mkissa.to/manga/wpehGDr8dzRkXdf2Y/chapter-326-sub'),
    false
  );
});

test('on mkissa.to, allows window.open to allmanga.to (sister host)', () => {
  const { window, openCalls } = load({ url: 'https://mkissa.to/' });
  assert.strictEqual(window.open('https://allmanga.to/manga/1'), 'OPENED');
  assert.strictEqual(openCalls.length, 1);
});

test('blocks window.open to an unlisted off-site host', () => {
  const { window, openCalls } = load();
  assert.strictEqual(window.open('https://evil-ads.example/go'), null);
  assert.strictEqual(openCalls.length, 0);
});

test('does not cancel a target=_blank off-site social link', () => {
  const { window } = load({ url: MKISSA_CHAPTER });
  const a = window.document.createElement('a');
  a.href = 'https://discord.gg/xyz';
  a.target = '_blank';
  window.document.body.appendChild(a);
  const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  a.dispatchEvent(ev);
  assert.strictEqual(ev.defaultPrevented, false);
  assert.match(a.href, /discord\.gg/);
});

test('on mkissa.to, leaves a legitimate same-site script in place', async () => {
  const { window } = load({ url: 'https://mkissa.to/' });
  const s = window.document.createElement('script');
  s.src = 'https://mkissa.to/app.js';
  window.document.documentElement.appendChild(s);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(s.isConnected, true);
});

test('on mkissa.to, injects the status badge', () => {
  const { window } = load({ url: 'https://mkissa.to/' });
  const badge = window.document.getElementById('rb-status-icon');
  assert.ok(badge, 'badge element should be present');
  assert.match(badge.title, /0 blocked this session \(0 total\)/);
});

// --- status badge ----------------------------------------------------------

test('injects a status badge containing an SVG icon', () => {
  const { window } = load();
  const badge = window.document.getElementById('rb-status-icon');
  assert.ok(badge, 'badge element should be present');
  assert.strictEqual(badge.parentNode, window.document.documentElement);
  assert.ok(badge.querySelector('svg'), 'badge should contain an svg');
  assert.strictEqual(badge.getAttribute('popover'), null);
  assert.match(badge.title, /active/i);
  assert.strictEqual(window.document.getElementById('rb-status-bar'), null);
});

test('does not draw a white frame around the badge', () => {
  const { window } = load();
  const badge = window.document.getElementById('rb-status-icon');
  const shadow = badge.style.boxShadow || '';
  const border = badge.style.border || '';
  assert.ok(!/#fff|#ffffff|white/i.test(shadow), 'box-shadow must not be a white ring');
  assert.ok(!/#fff|#ffffff|white/i.test(border), 'border must not be a white ring');
  assert.match(badge.style.borderRadius, /50%/);
});

test('re-appends the badge if the page removes it', async () => {
  const { window } = load();
  const badge = window.document.getElementById('rb-status-icon');
  assert.ok(badge);
  badge.remove();
  assert.strictEqual(badge.isConnected, false);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(badge.isConnected, true);
  assert.strictEqual(badge.parentNode, window.document.documentElement);
});

test('moves the badge into the fullscreen element', () => {
  const { window } = load();
  const badge = window.document.getElementById('rb-status-icon');
  const stage = window.document.createElement('div');
  window.document.body.appendChild(stage);
  Object.defineProperty(window.document, 'fullscreenElement', {
    configurable: true,
    get: () => stage,
  });
  window.document.dispatchEvent(new window.Event('fullscreenchange'));
  assert.strictEqual(badge.parentNode, stage);
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
// Default is top-right, inset 12: left 990 / top 12.
// Position is stored relative to the nearest corner: { corner, dx, dy }.

test('badge defaults to the top-right corner', () => {
  const { window } = load();
  const badge = window.document.getElementById('rb-status-icon');
  assert.strictEqual(badge.style.left, '990px');
  assert.strictEqual(badge.style.top, '12px');
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
  dragBadge(window, badge, -400, 300); // from 990,12 -> 590,312
  assert.strictEqual(badge.style.left, '590px');
  assert.strictEqual(badge.style.top, '312px');

  // 590,312 is still in the top-right quadrant; insets from that corner:
  // dx = 1024-22-590 = 412, dy = 312
  const saved = JSON.parse(window.localStorage.getItem('rb-icon-pos'));
  assert.deepStrictEqual(saved, { corner: 'RT', dx: 412, dy: 312 });
});

test('dragging into the top-left quadrant anchors to that corner', () => {
  const { window } = load();
  const badge = window.document.getElementById('rb-status-icon');
  dragBadge(window, badge, -900, 20); // 990,12 -> 90,32 (top-left quadrant)
  const saved = JSON.parse(window.localStorage.getItem('rb-icon-pos'));
  assert.deepStrictEqual(saved, { corner: 'LT', dx: 90, dy: 32 });
});

test('a dragged position survives a reload', () => {
  const first = load();
  const badge1 = first.window.document.getElementById('rb-status-icon');
  dragBadge(first.window, badge1, -400, 300);
  const savedPos = first.window.localStorage.getItem('rb-icon-pos');

  // Simulate a fresh page load carrying the persisted position forward.
  const second = load({ storage: { 'rb-icon-pos': savedPos } });
  const badge2 = second.window.document.getElementById('rb-status-icon');
  assert.strictEqual(badge2.style.left, '590px');
  assert.strictEqual(badge2.style.top, '312px');
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

// --- right-click menu ------------------------------------------------------

function openIconMenu(window, badge) {
  const ev = new window.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: 990, clientY: 20,
  });
  badge.dispatchEvent(ev);
  return ev;
}

function menuItem(window, id) {
  const menu = window.document.getElementById('rb-icon-menu');
  if (!menu) return null;
  if (menu.shadowRoot) return menu.shadowRoot.getElementById(id);
  return menu.querySelector('#' + id);
}

test('right-click on the badge opens a custom menu and cancels the native one', () => {
  const { window } = load();
  const badge = window.document.getElementById('rb-status-icon');
  const ev = openIconMenu(window, badge);
  assert.strictEqual(ev.defaultPrevented, true);
  const menu = window.document.getElementById('rb-icon-menu');
  assert.ok(menu, 'custom menu should be present');
  assert.notStrictEqual(menu.style.display, 'none');
  const toggle = menuItem(window, 'rb-menu-toggle');
  const hide = menuItem(window, 'rb-menu-hide');
  assert.ok(toggle, 'toggle item should be in the menu');
  assert.ok(hide, 'hide item should be in the menu');
  assert.match(toggle.textContent, /Disable on allmanga\.to/i);
});

test('hide icon from the menu hides the badge and persists', () => {
  const { window } = load();
  const badge = window.document.getElementById('rb-status-icon');
  openIconMenu(window, badge);
  menuItem(window, 'rb-menu-hide').click();
  assert.strictEqual(badge.style.display, 'none');
  assert.strictEqual(window.localStorage.getItem('rb-icon-hidden'), '1');
});

test('a hidden icon stays hidden after reload', () => {
  const { window } = load({ storage: { 'rb-icon-hidden': '1' } });
  const badge = window.document.getElementById('rb-status-icon');
  assert.ok(badge, 'badge node is kept so it can be shown again');
  assert.strictEqual(badge.style.display, 'none');
});

test('disable on this site pauses blocking and switches to the gray intact-chain icon', () => {
  const { window, openCalls } = load();
  const badge = window.document.getElementById('rb-status-icon');
  assert.strictEqual(badge.getAttribute('data-rb-enabled'), '1');
  assert.strictEqual(badge.querySelector('#rb-disc').getAttribute('fill'), '#f76707');
  assert.strictEqual(badge.querySelectorAll('#rb-glyph path').length, 4);
  openIconMenu(window, badge);
  const toggle = menuItem(window, 'rb-menu-toggle');
  assert.match(toggle.textContent, /Disable on allmanga\.to/i);
  toggle.click();
  assert.deepStrictEqual(
    JSON.parse(window.localStorage.getItem('rb-disabled-hosts')),
    ['allmanga.to']
  );
  assert.match(badge.title, /disabled on allmanga\.to/i);
  assert.strictEqual(badge.getAttribute('data-rb-enabled'), '0');
  assert.strictEqual(badge.querySelector('#rb-disc').getAttribute('fill'), '#495057');
  assert.strictEqual(badge.querySelectorAll('#rb-glyph path').length, 2);
  assert.strictEqual(window.open('https://youtu-chan.com/ad'), 'OPENED');
  assert.strictEqual(openCalls.length, 1);
});

test('enable on this site restores blocking and the orange broken-chain icon', () => {
  const { window, openCalls } = load({
    storage: { 'rb-disabled-hosts': JSON.stringify(['allmanga.to']) },
  });
  const badge = window.document.getElementById('rb-status-icon');
  assert.match(badge.title, /disabled on allmanga\.to/i);
  assert.strictEqual(badge.querySelector('#rb-disc').getAttribute('fill'), '#495057');
  openIconMenu(window, badge);
  const toggle = menuItem(window, 'rb-menu-toggle');
  assert.match(toggle.textContent, /Enable on allmanga\.to/i);
  toggle.click();
  assert.deepStrictEqual(
    JSON.parse(window.localStorage.getItem('rb-disabled-hosts')),
    []
  );
  assert.match(badge.title, /active on allmanga\.to/i);
  assert.strictEqual(badge.querySelector('#rb-disc').getAttribute('fill'), '#f76707');
  assert.strictEqual(badge.querySelectorAll('#rb-glyph path').length, 4);
  assert.strictEqual(window.open('https://youtu-chan.com/ad'), null);
  assert.strictEqual(openCalls.length, 0);
});

test('disabled host persists across reloads', () => {
  const { window, openCalls } = load({
    storage: { 'rb-disabled-hosts': JSON.stringify(['allmanga.to']) },
  });
  assert.strictEqual(window.open('https://youtu-chan.com/ad'), 'OPENED');
  assert.strictEqual(openCalls.length, 1);
});

test('legacy rb-enabled=0 migrates to disabling the current host', () => {
  const { window, openCalls } = load({ storage: { 'rb-enabled': '0' } });
  assert.deepStrictEqual(
    JSON.parse(window.localStorage.getItem('rb-disabled-hosts')),
    ['allmanga.to']
  );
  assert.strictEqual(window.localStorage.getItem('rb-enabled'), null);
  assert.strictEqual(window.open('https://youtu-chan.com/ad'), 'OPENED');
  assert.strictEqual(openCalls.length, 1);
});

test('disabling on allmanga.to does not disable mkissa.to', () => {
  const manga = load();
  const badge = manga.window.document.getElementById('rb-status-icon');
  openIconMenu(manga.window, badge);
  menuItem(manga.window, 'rb-menu-toggle').click();
  const saved = manga.window.localStorage.getItem('rb-disabled-hosts');

  const kiss = load({ url: 'https://mkissa.to/', storage: { 'rb-disabled-hosts': saved } });
  assert.strictEqual(kiss.window.open('https://youtu-chan.com/ad'), null);
  assert.strictEqual(kiss.openCalls.length, 0);
  const kissBadge = kiss.window.document.getElementById('rb-status-icon');
  assert.strictEqual(kissBadge.getAttribute('data-rb-enabled'), '1');
  assert.strictEqual(kissBadge.querySelector('#rb-disc').getAttribute('fill'), '#f76707');
});

test('menu on mkissa.to names that host', () => {
  const { window } = load({ url: 'https://mkissa.to/' });
  const badge = window.document.getElementById('rb-status-icon');
  openIconMenu(window, badge);
  assert.match(menuItem(window, 'rb-menu-toggle').textContent, /Disable on mkissa\.to/i);
});

test('right-click does not start a drag', () => {
  const { window } = load();
  const badge = window.document.getElementById('rb-status-icon');
  const startLeft = badge.style.left;
  const startTop = badge.style.top;
  badge.dispatchEvent(new window.MouseEvent('mousedown', {
    bubbles: true, button: 2, clientX: 500, clientY: 500,
  }));
  window.dispatchEvent(new window.MouseEvent('mousemove', {
    bubbles: true, clientX: 400, clientY: 400,
  }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  assert.strictEqual(badge.style.left, startLeft);
  assert.strictEqual(badge.style.top, startTop);
});
