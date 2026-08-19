'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const INJECT_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'chrome-extension', 'inject.js'),
  'utf8'
);

function load(opts = {}) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});

  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: opts.url || 'https://mkissa.to/',
    runScripts: 'outside-only',
    virtualConsole,
  });
  const { window } = dom;
  for (const [key, value] of Object.entries(opts.storage || {})) {
    window.localStorage.setItem(key, value);
  }
  window.eval(INJECT_SOURCE);
  return { window };
}

function dragBadge(window, badge, dx, dy) {
  badge.dispatchEvent(new window.MouseEvent('mousedown', {
    bubbles: true, clientX: 500, clientY: 500,
  }));
  window.dispatchEvent(new window.MouseEvent('mousemove', {
    bubbles: true, clientX: 500 + dx, clientY: 500 + dy,
  }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
}

// jsdom 1024x768; ICON_SIZE 36, MARGIN 12 → default RT left 976 / top 12

test('inject.js paints a draggable RB disc at top-right', () => {
  const { window } = load();
  const icon = window.document.getElementById('rb-status-icon');
  assert.ok(icon);
  assert.strictEqual(icon.textContent, 'RB');
  assert.strictEqual(icon.style.left, '976px');
  assert.strictEqual(icon.style.top, '12px');
  assert.strictEqual(icon.style.cursor, 'grab');
});

test('inject.js restores a saved corner-relative position', () => {
  const { window } = load({
    storage: { 'rb-icon-pos': JSON.stringify({ corner: 'LT', dx: 40, dy: 80 }) },
  });
  const icon = window.document.getElementById('rb-status-icon');
  assert.strictEqual(icon.style.left, '40px');
  assert.strictEqual(icon.style.top, '80px');
});

test('inject.js drag saves position relative to the nearest corner', () => {
  const { window } = load();
  const icon = window.document.getElementById('rb-status-icon');
  dragBadge(window, icon, -400, 300); // 976,12 -> 576,312
  assert.strictEqual(icon.style.left, '576px');
  assert.strictEqual(icon.style.top, '312px');
  const saved = JSON.parse(window.localStorage.getItem('rb-icon-pos'));
  // 576,312 is still top-right: dx = 1024-36-576 = 412, dy = 312
  assert.deepStrictEqual(saved, { corner: 'RT', dx: 412, dy: 312 });
});

test('inject.js dragged position survives a reload', () => {
  const first = load();
  const icon1 = first.window.document.getElementById('rb-status-icon');
  dragBadge(first.window, icon1, -400, 300);
  const savedPos = first.window.localStorage.getItem('rb-icon-pos');

  const second = load({ storage: { 'rb-icon-pos': savedPos } });
  const icon2 = second.window.document.getElementById('rb-status-icon');
  assert.strictEqual(icon2.style.left, '576px');
  assert.strictEqual(icon2.style.top, '312px');
});

test('inject.js keeps distance from the anchored corner on resize', () => {
  const { window } = load({
    storage: { 'rb-icon-pos': JSON.stringify({ corner: 'RB', dx: 12, dy: 12 }) },
  });
  const icon = window.document.getElementById('rb-status-icon');
  assert.strictEqual(icon.style.left, '976px'); // 1024-36-12
  assert.strictEqual(icon.style.top, '720px'); // 768-36-12

  window.innerWidth = 800;
  window.innerHeight = 600;
  window.dispatchEvent(new window.Event('resize'));

  assert.strictEqual(icon.style.left, '752px'); // 800-36-12
  assert.strictEqual(icon.style.top, '552px'); // 600-36-12
});

test('inject.js re-appends the disc if the page removes it and keeps the saved spot', async () => {
  const { window } = load({
    storage: { 'rb-icon-pos': JSON.stringify({ corner: 'LT', dx: 20, dy: 30 }) },
  });
  const icon = window.document.getElementById('rb-status-icon');
  icon.remove();
  await new Promise((r) => setTimeout(r, 10));
  const again = window.document.getElementById('rb-status-icon');
  assert.ok(again);
  assert.strictEqual(again.isConnected, true);
  assert.strictEqual(again.style.left, '20px');
  assert.strictEqual(again.style.top, '30px');
});
