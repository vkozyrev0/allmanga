// Isolated-world injector. Page CSP does not apply here, so this still runs
// when world:MAIN is blocked by Cloudflare. DOM is shared with the page.
(function () {
    'use strict';

    var BAR_ID = 'rb-status-bar';
    var ICON_ID = 'rb-status-icon';
    var POS_KEY = 'rb-icon-pos';
    var ICON_SIZE = 36;
    var ICON_MARGIN = 12;

    var iconEl = null;
    var dragging = false;
    var dragBound = false;

    function root() {
        return document.documentElement || document.body;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }
    function maxLeft() { return Math.max(0, window.innerWidth - ICON_SIZE); }
    function maxTop() { return Math.max(0, window.innerHeight - ICON_SIZE); }

    function nearestCorner(left, top) {
        var h = (left + ICON_SIZE / 2) < window.innerWidth / 2 ? 'L' : 'R';
        var v = (top + ICON_SIZE / 2) < window.innerHeight / 2 ? 'T' : 'B';
        return h + v;
    }

    function positionFor(corner, dx, dy) {
        var left = corner[0] === 'L' ? dx : window.innerWidth - ICON_SIZE - dx;
        var top = corner[1] === 'T' ? dy : window.innerHeight - ICON_SIZE - dy;
        return { left: clamp(left, 0, maxLeft()), top: clamp(top, 0, maxTop()) };
    }

    function offsetsFor(corner, left, top) {
        var dx = corner[0] === 'L' ? left : window.innerWidth - ICON_SIZE - left;
        var dy = corner[1] === 'T' ? top : window.innerHeight - ICON_SIZE - top;
        return { dx: Math.max(0, Math.round(dx)), dy: Math.max(0, Math.round(dy)) };
    }

    function storageGet(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            if (raw === null) return fallback;
            return JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    }
    function storageSet(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
    }

    function resolvePosition() {
        var saved = storageGet(POS_KEY, null);
        if (saved && typeof saved.corner === 'string'
            && typeof saved.dx === 'number' && typeof saved.dy === 'number') {
            return positionFor(saved.corner, saved.dx, saved.dy);
        }
        return positionFor('RT', ICON_MARGIN, ICON_MARGIN);
    }

    function applyPosition(left, top) {
        if (!iconEl) return;
        iconEl.style.setProperty('left', Math.round(clamp(left, 0, maxLeft())) + 'px', 'important');
        iconEl.style.setProperty('top', Math.round(clamp(top, 0, maxTop())) + 'px', 'important');
        iconEl.style.setProperty('right', 'auto', 'important');
        iconEl.style.setProperty('bottom', 'auto', 'important');
    }

    function savePosition(left, top) {
        var corner = nearestCorner(left, top);
        var off = offsetsFor(corner, left, top);
        storageSet(POS_KEY, JSON.stringify({ corner: corner, dx: off.dx, dy: off.dy }));
    }

    function styleIcon(icon) {
        icon.style.cssText = [
            'display:block',
            'position:fixed',
            'width:' + ICON_SIZE + 'px',
            'height:' + ICON_SIZE + 'px',
            'border-radius:' + (ICON_SIZE / 2) + 'px',
            'background:#f76707',
            'color:#fff',
            'font:700 12px/' + ICON_SIZE + 'px sans-serif',
            'text-align:center',
            'z-index:2147483647',
            'box-shadow:0 0 0 3px #fff,0 2px 8px rgba(0,0,0,.45)',
            'pointer-events:auto',
            'user-select:none',
            'cursor:grab'
        ].join(';');
        icon.style.setProperty('display', 'block', 'important');
        icon.style.setProperty('position', 'fixed', 'important');
        icon.style.setProperty('z-index', '2147483647', 'important');
    }

    function enableDrag() {
        if (dragBound || !iconEl) return;
        dragBound = true;

        var moved = false;
        var startMouseX = 0, startMouseY = 0;
        var startLeft = 0, startTop = 0;

        iconEl.addEventListener('mousedown', function (event) {
            dragging = true;
            moved = false;
            startMouseX = event.clientX;
            startMouseY = event.clientY;
            startLeft = parseFloat(iconEl.style.left) || 0;
            startTop = parseFloat(iconEl.style.top) || 0;
            iconEl.style.cursor = 'grabbing';
            event.preventDefault();
        });

        window.addEventListener('mousemove', function (event) {
            if (!dragging) return;
            var dx = event.clientX - startMouseX;
            var dy = event.clientY - startMouseY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
            applyPosition(startLeft + dx, startTop + dy);
        });

        window.addEventListener('mouseup', function () {
            if (!dragging) return;
            dragging = false;
            iconEl.style.cursor = 'grab';
            if (moved) {
                savePosition(parseFloat(iconEl.style.left) || 0, parseFloat(iconEl.style.top) || 0);
            }
        });

        window.addEventListener('resize', function () {
            var pos = resolvePosition();
            applyPosition(pos.left, pos.top);
        });
    }

    function paint() {
        var parent = root();
        if (!parent) return false;

        var bar = document.getElementById(BAR_ID);
        if (!bar) {
            bar = document.createElement('div');
            bar.id = BAR_ID;
            bar.setAttribute('data-rb', '1');
            parent.appendChild(bar);
        }
        bar.style.cssText = [
            'display:block',
            'position:fixed',
            'top:0',
            'left:0',
            'right:0',
            'height:8px',
            'background:#f76707',
            'z-index:2147483647',
            'pointer-events:none'
        ].join(';');

        var icon = document.getElementById(ICON_ID);
        if (!icon) {
            icon = document.createElement('div');
            icon.id = ICON_ID;
            icon.textContent = 'RB';
            icon.title = 'Redirect Blocker — drag to move';
            parent.appendChild(icon);
            iconEl = icon;
            dragBound = false;
            styleIcon(icon);
            enableDrag();
        } else if (iconEl !== icon) {
            iconEl = icon;
            dragBound = false;
            styleIcon(icon);
            enableDrag();
        }
        if (icon.parentNode !== parent) parent.appendChild(icon);

        if (!dragging) {
            var pos = resolvePosition();
            applyPosition(pos.left, pos.top);
        }
        return true;
    }

    function start() {
        paint();
        if (document.documentElement) {
            try {
                new MutationObserver(function () {
                    if (!document.getElementById(ICON_ID) || !document.getElementById(BAR_ID)) {
                        paint();
                    }
                }).observe(document.documentElement, { childList: true, subtree: true });
            } catch (e) { /* ignore */ }
        }
        if (typeof navigator === 'undefined' || !/jsdom/i.test(navigator.userAgent)) {
            var n = 0;
            var t = setInterval(function () {
                paint();
                if (++n >= 30) clearInterval(t);
            }, 500);
        }
    }

    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start);
})();
