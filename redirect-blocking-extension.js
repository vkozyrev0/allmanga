// ==UserScript==
// @name         Advanced Redirect Blocker for allmanga.to and mkissa.to
// @namespace    http://tampermonkey.net/
// @version      1.16
// @description  Prevents off-site redirects on allmanga.to and mkissa.to (next-page hijacks, location.assign/href, pop-ups). Shows a draggable status badge with a blocked-redirect counter.
// @author       You
// @match        *://allmanga.to/*
// @match        *://www.allmanga.to/*
// @match        *://mkissa.to/*
// @match        *://www.mkissa.to/*
// @match        *://*.mkissa.to/*
// @match        *://*.mkissa.net/*
// @match        https://mkissa.to/*
// @match        https://www.mkissa.to/*
// @include      https://mkissa.to/*
// @include      https://www.mkissa.to/*
// @include      http://mkissa.to/*
// @include      https://allmanga.to/*
// @run-at       document-start
// @inject-into  page
// @downloadURL  https://raw.githubusercontent.com/vkozyrev0/allmanga/main/redirect-blocking-extension.js
// @updateURL    https://raw.githubusercontent.com/vkozyrev0/allmanga/main/redirect-blocking-extension.js
// @grant        unsafeWindow
// ==/UserScript==

(function() {
    'use strict';

    // AdGuard/TM may sandbox this script. Prefer the real page window so
    // DOM writes and history/open hooks actually affect the site.
    const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
    const D = W.document;

    try {
        boot();
    } catch (err) {
        try {
            const bar = D.createElement('div');
            bar.id = 'rb-status-bar';
            bar.textContent = 'RB error: ' + (err && err.message ? err.message : err);
            bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#c92a2a;color:#fff;font:12px/20px sans-serif;padding:2px 8px';
            (D.documentElement || D.body).appendChild(bar);
        } catch (e2) { /* last resort failed */ }
    }

    function boot() {
    // Known ad/script hosts. Navigation blocks ANY other host; this list
    // is only for stripping injected <script> tags (third-party CDNs stay).
    const blockedDomains = ['youtu-chan.com', 'isekai2nd.com'];
    const originalHostname = W.location.hostname;
    const allowedHostSuffixes = ['allmanga.to', 'mkissa.to', 'mkissa.net'];

    // --- Status / persistence -------------------------------------------------
    const POS_KEY = 'rb-icon-pos';       // saved badge position (viewport ratios)
    const TOTAL_KEY = 'rb-blocked-total'; // cumulative blocks across page loads
    const HIDDEN_KEY = 'rb-icon-hidden';  // '1' = status badge hidden
    const ENABLED_KEY = 'rb-enabled';     // '0' = redirect blocking paused
    const ICON_SIZE = 22;                 // badge width/height in px
    const ICON_MARGIN = 12;               // default gap from the viewport edge

    let badgeEl = null;
    let menuEl = null;
    let hideItem = null;
    let toggleItem = null;
    let menuOpen = false;
    let sessionBlocked = 0;               // blocks during this page load
    let totalBlocked = storageGet(TOTAL_KEY, 0, parseIntSafe); // persisted total
    let iconHidden = storageGet(HIDDEN_KEY, false, (raw) => raw === '1');
    let blockerEnabled = storageGet(ENABLED_KEY, true, (raw) => raw !== '0');

    // Small, defensive localStorage helpers (storage can throw in private mode)
    function storageGet(key, fallback, parse) {
        try {
            const raw = W.localStorage.getItem(key);
            if (raw === null) return fallback;
            const value = parse ? parse(raw) : raw;
            return value === undefined ? fallback : value;
        } catch (e) {
            return fallback;
        }
    }
    function storageSet(key, value) {
        try { W.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
    }
    function parseIntSafe(raw) {
        const n = parseInt(raw, 10);
        return Number.isNaN(n) ? undefined : n;
    }

    // Count a blocked redirect and refresh the badge tooltip
    function recordBlock() {
        sessionBlocked++;
        totalBlocked++;
        storageSet(TOTAL_KEY, String(totalBlocked));
        updateBadgeTooltip();
    }
    function updateBadgeTooltip() {
        if (!badgeEl) return;
        const label = blockerEnabled
            ? `Redirect Blocker active — ${sessionBlocked} blocked this session (${totalBlocked} total)`
            : 'Redirect Blocker disabled — right-click to enable';
        badgeEl.title = label;
        badgeEl.setAttribute('aria-label', label);
    }

    function syncBadgeVisual() {
        if (!badgeEl) return;
        const circle = badgeEl.querySelector('circle');
        if (circle) circle.setAttribute('fill', blockerEnabled ? '#f76707' : '#868e96');
        badgeEl.style.setProperty('display', iconHidden ? 'none' : 'block', 'important');
        updateBadgeTooltip();
    }

    function setBlockerEnabled(on) {
        blockerEnabled = !!on;
        storageSet(ENABLED_KEY, blockerEnabled ? '1' : '0');
        syncBadgeVisual();
    }

    function setIconHidden(hidden) {
        iconHidden = !!hidden;
        storageSet(HIDDEN_KEY, iconHidden ? '1' : '0');
        syncBadgeVisual();
        if (iconHidden) {
            hideMenu();
            console.log('Redirect Blocker icon hidden. To show it again, run: localStorage.removeItem("rb-icon-hidden"); location.reload()');
        }
    }

    function hostnameOf(url) {
        try {
            return new URL(String(url), W.location.origin).hostname.toLowerCase();
        } catch (e) {
            return '';
        }
    }

    function isAllowedHost(hostname) {
        const h = String(hostname || '').toLowerCase();
        if (!h) return true; // about:blank, javascript:, mailto:
        const orig = originalHostname.toLowerCase();
        if (h === orig || h === 'www.' + orig || orig === 'www.' + h) return true;
        if (h.endsWith('.' + orig) || orig.endsWith('.' + h)) return true;
        return allowedHostSuffixes.some((s) => h === s || h === 'www.' + s || h.endsWith('.' + s));
    }

    // Paths that still look like this site if they were copied onto an ad host
    // (e.g. youtu-chan.com/manga/<id>/chapter-326). Article URLs like
    // isekai2nd.com/20-recommended-... must NOT be rewritten here — that 404s.
    function looksLikeSitePath(pathname) {
        if (!pathname || pathname === '/') return false;
        const p = pathname.toLowerCase();
        if (['/manga/', '/anime/', '/watch/', '/read/', '/chapter/'].some((pre) => p.startsWith(pre))) {
            return true;
        }
        const cur = W.location.pathname.split('/').filter(Boolean);
        const dest = pathname.split('/').filter(Boolean);
        return cur.length >= 2 && dest.length >= 2 && cur[0] === dest[0] && cur[1] === dest[1];
    }

    // Classify a navigation URL: allow, rewrite onto this host, or block (stay).
    function decide(url) {
        if (!blockerEnabled) return { action: 'allow', url: url };
        if (!url) return { action: 'allow', url: url };
        try {
            const urlObj = new URL(String(url), W.location.origin);
            if (isAllowedHost(urlObj.hostname)) return { action: 'allow', url: url };
            if (looksLikeSitePath(urlObj.pathname)) {
                const rewritten = `https://${originalHostname}${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
                return { action: 'rewrite', url: rewritten };
            }
            return { action: 'block', url: url };
        } catch (e) {
            console.log(`Invalid URL: ${url}, error: ${e}`);
            return { action: 'allow', url: url };
        }
    }

    function noteDecision(decision, via, original) {
        if (decision.action === 'allow') return decision;
        recordBlock();
        if (decision.action === 'rewrite') {
            console.log(`Rewrote ${via} from ${original} to ${decision.url}`);
        } else {
            console.log(`Blocked ${via} to ${original}`);
        }
        return decision;
    }

    function hrefOf(el) {
        if (!el) return '';
        if (typeof el.href === 'string' && el.href) return el.href;
        try {
            const raw = el.getAttribute('href') || (el.href && el.href.baseVal) || '';
            return raw ? new URL(raw, W.location.origin).href : '';
        } catch (e) {
            return '';
        }
    }

    function interceptAnchorEvent(event) {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        const fromPath = path.find((n) => n && (n.tagName === 'A' || n.tagName === 'AREA') && hrefOf(n));
        const target = (event.target && event.target.closest)
            ? event.target.closest('a[href], area[href]')
            : null;
        const anchor = fromPath || target;
        if (!anchor) return;
        const href = hrefOf(anchor);
        if (!href) return;
        const decision = decide(href);
        if (decision.action === 'allow') return;
        const targetAttr = (anchor.getAttribute('target') || '').toLowerCase();
        const newTab = event.type === 'auxclick' || event.button === 1
            || event.ctrlKey || event.metaKey || event.shiftKey
            || targetAttr === '_blank' || targetAttr === 'blank';
        // Same-tab off-site is the next-page hijack. New-tab (Discord, etc.) stays.
        if (newTab && decision.action === 'block') return;
        event.preventDefault();
        event.stopPropagation();
        noteDecision(decision, 'click', href);
        if (decision.action === 'rewrite') {
            W.location.href = decision.url;
        }
    }

    D.addEventListener('click', interceptAnchorEvent, true);
    D.addEventListener('auxclick', interceptAnchorEvent, true);

    D.addEventListener('submit', function(event) {
        const form = event.target;
        if (!form || !form.action) return;
        const decision = decide(form.action);
        if (decision.action === 'allow') return;
        event.preventDefault();
        event.stopPropagation();
        noteDecision(decision, 'form', form.action);
        if (decision.action === 'rewrite') {
            form.action = decision.url;
            try { form.submit(); } catch (e) { /* ignore */ }
        }
    }, true);

    function isBlockedScriptSrc(src) {
        if (!src) return false;
        const host = hostnameOf(src);
        return blockedDomains.some((domain) => host.includes(domain) || String(src).includes(domain));
    }

    function sanitizeMetaRefresh(node) {
        if (!node || node.tagName !== 'META') return;
        const equiv = (node.httpEquiv || node.getAttribute('http-equiv') || '').toLowerCase();
        if (equiv !== 'refresh') return;
        const content = node.content || node.getAttribute('content') || '';
        const match = String(content).match(/url\s*=\s*['"]?([^'"\s]+)/i);
        if (!match) return;
        const decision = decide(match[1]);
        if (decision.action === 'allow') return;
        node.remove();
        noteDecision(decision, 'meta-refresh', match[1]);
    }

    function sanitizeAnchor(node) {
        if (!node || (node.tagName !== 'A' && node.tagName !== 'AREA')) return;
        const href = hrefOf(node);
        if (!href) return;
        const decision = decide(href);
        // Only rewrite manga-shaped hijacks in the DOM. Leave article/ad hrefs
        // in place so a target=_blank social link still works; same-tab
        // navigation is stopped by the click / location / navigate guards.
        if (decision.action !== 'rewrite') return;
        node.setAttribute('href', decision.url);
        noteDecision(decision, 'href', href);
    }

    function sanitizeNode(node) {
        if (!node || node.nodeType !== 1) return;
        if (!blockerEnabled) return;
        if (node.tagName === 'SCRIPT' && isBlockedScriptSrc(node.src)) {
            node.remove();
            recordBlock();
            console.log(`Removed script with src: ${node.src}`);
            return;
        }
        sanitizeMetaRefresh(node);
        sanitizeAnchor(node);
    }

    function sanitizeTree(root) {
        if (!root) return;
        sanitizeNode(root);
        if (!root.querySelectorAll) return;
        root.querySelectorAll('script[src], meta[http-equiv], a[href], area[href]').forEach(sanitizeNode);
    }

    const scriptObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                sanitizeTree(node);
            });
        });
    });

    function observeScripts() {
        if (!D.documentElement) return;
        try {
            scriptObserver.observe(D.documentElement, { childList: true, subtree: true });
        } catch (e) {
            console.log('Redirect blocker: script observer failed', e);
        }
        sanitizeTree(D);
    }
    observeScripts();

    const originalPushState = W.history.pushState;
    W.history.pushState = function(state, title, url) {
        const decision = decide(url);
        if (decision.action === 'block') {
            noteDecision(decision, 'pushState', url);
            return;
        }
        if (decision.action === 'rewrite') noteDecision(decision, 'pushState', url);
        return originalPushState.call(W.history, state, title, decision.action === 'rewrite' ? decision.url : url);
    };

    const originalReplaceState = W.history.replaceState;
    W.history.replaceState = function(state, title, url) {
        const decision = decide(url);
        if (decision.action === 'block') {
            noteDecision(decision, 'replaceState', url);
            return;
        }
        if (decision.action === 'rewrite') noteDecision(decision, 'replaceState', url);
        return originalReplaceState.call(W.history, state, title, decision.action === 'rewrite' ? decision.url : url);
    };

    const originalWindowOpen = W.open;
    W.open = function(url, ...args) {
        const decision = decide(url);
        if (decision.action !== 'allow') {
            noteDecision(decision, 'window.open', url);
            return null;
        }
        return originalWindowOpen.call(W, url, ...args);
    };

    // location.assign / replace / href — next-page hijacks often skip <a> tags.
    function guardLocationCall(via, url, proceed) {
        const decision = decide(url);
        if (decision.action === 'block') {
            noteDecision(decision, via, url);
            return;
        }
        if (decision.action === 'rewrite') {
            noteDecision(decision, via, url);
            return proceed(decision.url);
        }
        return proceed(url);
    }

    function wrapLocationFn(obj, name) {
        if (!obj) return;
        try {
            const orig = obj[name];
            if (typeof orig !== 'function') return;
            obj[name] = function(url) {
                return guardLocationCall('location.' + name, url, (next) => orig.call(this, next));
            };
        } catch (e) { /* non-writable in some engines */ }
    }

    function wrapLocationHref(obj) {
        if (!obj) return;
        try {
            const desc = Object.getOwnPropertyDescriptor(obj, 'href');
            if (!desc || !desc.set || desc.configurable === false) return;
            Object.defineProperty(obj, 'href', {
                configurable: true,
                enumerable: desc.enumerable,
                get: desc.get ? function() { return desc.get.call(this); } : undefined,
                set: function(url) {
                    guardLocationCall('location.href', url, (next) => desc.set.call(this, next));
                }
            });
        } catch (e) { /* not configurable */ }
    }

    const LocationProto = W.Location && W.Location.prototype;
    wrapLocationFn(LocationProto, 'assign');
    wrapLocationFn(LocationProto, 'replace');
    wrapLocationHref(LocationProto);
    wrapLocationFn(W.location, 'assign');
    wrapLocationFn(W.location, 'replace');
    wrapLocationHref(W.location);

    // Chromium Navigation API: catches location.href = offsite even when
    // Location.prototype is frozen. This is what stops mkissa next-page ads.
    if (W.navigation && typeof W.navigation.addEventListener === 'function') {
        W.navigation.addEventListener('navigate', (event) => {
            try {
                if (event.hashChange || event.downloadRequest) return;
                const dest = event.destination && event.destination.url;
                if (!dest) return;
                const decision = decide(dest);
                if (decision.action === 'allow') return;
                if (event.cancelable) event.preventDefault();
                noteDecision(decision, 'navigate', dest);
                if (decision.action === 'rewrite') {
                    try { W.location.replace(decision.url); } catch (e2) { /* ignore */ }
                }
            } catch (e) { /* ignore */ }
        });
    }

    // --- Status badge (draggable, position-remembering) ----------------------

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    // Largest valid top-left coords so the badge stays fully on screen
    function maxLeft() { return Math.max(0, W.innerWidth - ICON_SIZE); }
    function maxTop() { return Math.max(0, W.innerHeight - ICON_SIZE); }

    // Position is stored relative to the nearest viewport corner so the badge
    // keeps the same distance from that corner when the window is resized.
    // corner is a two-char code: horizontal 'L'/'R' + vertical 'T'/'B'.

    // Which corner is the badge (at left/top) closest to?
    function nearestCorner(left, top) {
        const h = (left + ICON_SIZE / 2) < W.innerWidth / 2 ? 'L' : 'R';
        const v = (top + ICON_SIZE / 2) < W.innerHeight / 2 ? 'T' : 'B';
        return h + v;
    }

    // Pixel position for a corner + its (dx, dy) inset from that corner's edges
    function positionFor(corner, dx, dy) {
        const left = corner[0] === 'L' ? dx : W.innerWidth - ICON_SIZE - dx;
        const top = corner[1] === 'T' ? dy : W.innerHeight - ICON_SIZE - dy;
        return { left: clamp(left, 0, maxLeft()), top: clamp(top, 0, maxTop()) };
    }

    // Inset of left/top from the given corner's edges
    function offsetsFor(corner, left, top) {
        const dx = corner[0] === 'L' ? left : W.innerWidth - ICON_SIZE - left;
        const dy = corner[1] === 'T' ? top : W.innerHeight - ICON_SIZE - top;
        return { dx: Math.max(0, Math.round(dx)), dy: Math.max(0, Math.round(dy)) };
    }

    // Resolve the badge's pixel position: saved corner-relative offset if
    // present, else default to the top-right corner. Returns { left, top }.
    function resolvePosition() {
        const saved = storageGet(POS_KEY, null, JSON.parse);
        if (saved && typeof saved.corner === 'string'
            && typeof saved.dx === 'number' && typeof saved.dy === 'number') {
            return positionFor(saved.corner, saved.dx, saved.dy);
        }
        // Top-right: manga readers put next/prev chrome in the bottom-right
        return positionFor('RT', ICON_MARGIN, ICON_MARGIN);
    }

    function applyPosition(left, top) {
        badgeEl.style.setProperty('left', Math.round(clamp(left, 0, maxLeft())) + 'px', 'important');
        badgeEl.style.setProperty('top', Math.round(clamp(top, 0, maxTop())) + 'px', 'important');
        badgeEl.style.setProperty('right', 'auto', 'important');
        badgeEl.style.setProperty('bottom', 'auto', 'important');
    }

    // Persist position relative to whichever corner it ended up nearest
    function savePosition(left, top) {
        const corner = nearestCorner(left, top);
        const { dx, dy } = offsetsFor(corner, left, top);
        storageSet(POS_KEY, JSON.stringify({ corner, dx, dy }));
    }

    // Drag handling tracked in JS state (no layout reads), with a small
    // threshold so a plain click isn't treated as a drag
    function enableDrag() {
        let dragging = false;
        let moved = false;
        let startMouseX = 0, startMouseY = 0;
        let startLeft = 0, startTop = 0;

        badgeEl.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return; // left-click only; right-click is the menu
            dragging = true;
            moved = false;
            startMouseX = event.clientX;
            startMouseY = event.clientY;
            startLeft = parseFloat(badgeEl.style.left) || 0;
            startTop = parseFloat(badgeEl.style.top) || 0;
            badgeEl.style.cursor = 'grabbing';
            event.preventDefault(); // avoid text selection while dragging
        });

        W.addEventListener('mousemove', (event) => {
            if (!dragging) return;
            const dx = event.clientX - startMouseX;
            const dy = event.clientY - startMouseY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
            applyPosition(startLeft + dx, startTop + dy);
        });

        W.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            badgeEl.style.cursor = 'grab';
            if (moved) {
                savePosition(parseFloat(badgeEl.style.left) || 0, parseFloat(badgeEl.style.top) || 0);
            }
        });

        // Keep the relative position when the window is resized
        W.addEventListener('resize', () => {
            const pos = resolvePosition();
            applyPosition(pos.left, pos.top);
        });
    }

    // Broken-link glyph on an orange disc — built with DOM APIs so Trusted
    // Types / innerHTML CSP on the host page cannot strip the icon.
    function createBadgeSvg() {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = D.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', String(ICON_SIZE));
        svg.setAttribute('height', String(ICON_SIZE));
        svg.style.pointerEvents = 'none';

        const circle = D.createElementNS(ns, 'circle');
        circle.setAttribute('cx', '12');
        circle.setAttribute('cy', '12');
        circle.setAttribute('r', '11');
        circle.setAttribute('fill', '#f76707');
        svg.appendChild(circle);

        const g = D.createElementNS(ns, 'g');
        g.setAttribute('fill', 'none');
        g.setAttribute('stroke', '#ffffff');
        g.setAttribute('stroke-width', '2');
        g.setAttribute('stroke-linecap', 'round');
        g.setAttribute('stroke-linejoin', 'round');
        [
            'M9 12l-2 2a2.5 2.5 0 0 0 3.5 3.5l2 -2',
            'M15 12l2 -2a2.5 2.5 0 0 0 -3.5 -3.5l-2 2',
            'M6.5 6.5l-1 -1',
            'M18.5 18.5l1 1'
        ].forEach((d) => {
            const path = D.createElementNS(ns, 'path');
            path.setAttribute('d', d);
            g.appendChild(path);
        });
        svg.appendChild(g);
        return svg;
    }

    function createBadgeElement() {
        const badge = D.createElement('div');
        badge.id = 'rb-status-icon';
        // Do not use the popover attribute: UA CSS is `display:none !important`
        // until showPopover() succeeds, and AdGuard's page world often has no
        // Popover API — the icon would exist in the DOM but stay invisible.
        badge.style.cssText = [
            'display:block',
            'position:fixed',
            'width:' + ICON_SIZE + 'px',
            'height:' + ICON_SIZE + 'px',
            'z-index:2147483647',
            'opacity:1',
            'cursor:grab',
            'transition:opacity 0.2s ease',
            'pointer-events:auto',
            'user-select:none',
            'margin:0',
            'padding:0',
            'border:none',
            'border-radius:50%',
            'overflow:hidden',
            'background:transparent',
            'box-shadow:none',
            'outline:none'
        ].join(';');
        badge.style.setProperty('display', 'block', 'important');
        badge.style.setProperty('visibility', 'visible', 'important');
        badge.style.setProperty('position', 'fixed', 'important');
        badge.style.setProperty('z-index', '2147483647', 'important');
        badge.style.setProperty('box-shadow', 'none', 'important');
        badge.style.setProperty('border', 'none', 'important');
        badge.style.setProperty('outline', 'none', 'important');
        badge.addEventListener('mouseenter', () => { badge.style.opacity = '1'; });
        badge.addEventListener('mouseleave', () => { badge.style.opacity = '1'; });
        badge.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            showMenu(event.clientX, event.clientY);
        });
        badge.appendChild(createBadgeSvg());
        return badge;
    }

    function styleMenuItem(item) {
        item.style.cssText = [
            'display:block',
            'width:100%',
            'box-sizing:border-box',
            'margin:0',
            'padding:7px 12px',
            'border:none',
            'background:transparent',
            'color:#f8f9fa',
            'font:13px/1.3 system-ui,sans-serif',
            'text-align:left',
            'cursor:pointer',
            'border-radius:4px'
        ].join(';');
        item.addEventListener('mouseenter', () => { item.style.background = '#f76707'; });
        item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
    }

    function createMenuElement() {
        const menu = D.createElement('div');
        menu.id = 'rb-icon-menu';
        menu.style.cssText = [
            'display:none',
            'position:fixed',
            'z-index:2147483647',
            'min-width:200px',
            'padding:4px',
            'margin:0',
            'background:#1a1b1e',
            'color:#f8f9fa',
            'border:1px solid #373a40',
            'border-radius:6px',
            'box-shadow:0 8px 24px rgba(0,0,0,0.45)',
            'user-select:none'
        ].join(';');
        menu.style.setProperty('position', 'fixed', 'important');
        menu.style.setProperty('z-index', '2147483647', 'important');

        toggleItem = D.createElement('button');
        toggleItem.id = 'rb-menu-toggle';
        toggleItem.type = 'button';
        toggleItem.textContent = 'Disable redirect blocker';
        styleMenuItem(toggleItem);
        toggleItem.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setBlockerEnabled(!blockerEnabled);
            hideMenu();
        });

        hideItem = D.createElement('button');
        hideItem.id = 'rb-menu-hide';
        hideItem.type = 'button';
        hideItem.textContent = 'Hide icon';
        styleMenuItem(hideItem);
        hideItem.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setIconHidden(true);
        });

        menu.appendChild(toggleItem);
        menu.appendChild(hideItem);
        return menu;
    }

    function updateMenuLabels() {
        if (!toggleItem) return;
        toggleItem.textContent = blockerEnabled ? 'Disable redirect blocker' : 'Enable redirect blocker';
    }

    function hideMenu() {
        menuOpen = false;
        if (menuEl) menuEl.style.setProperty('display', 'none', 'important');
    }

    function showMenu(clientX, clientY) {
        if (!menuEl || iconHidden) return;
        updateMenuLabels();
        menuEl.style.setProperty('display', 'block', 'important');
        const w = menuEl.offsetWidth || 210;
        const h = menuEl.offsetHeight || 68;
        let left = clientX;
        let top = clientY;
        if (left + w > W.innerWidth - 4) left = Math.max(4, W.innerWidth - w - 4);
        if (top + h > W.innerHeight - 4) top = Math.max(4, W.innerHeight - h - 4);
        if (left < 4) left = 4;
        if (top < 4) top = 4;
        menuEl.style.setProperty('left', Math.round(left) + 'px', 'important');
        menuEl.style.setProperty('top', Math.round(top) + 'px', 'important');
        menuEl.style.setProperty('right', 'auto', 'important');
        menuEl.style.setProperty('bottom', 'auto', 'important');
        menuOpen = true;
    }

    function enableMenuDismiss() {
        W.addEventListener('mousedown', (event) => {
            if (!menuOpen || !menuEl) return;
            if (menuEl.contains(event.target)) return;
            hideMenu();
        }, true);
        W.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') hideMenu();
        });
        W.addEventListener('resize', hideMenu);
        D.addEventListener('scroll', hideMenu, true);
    }

    function nativeAppend(parent, node) {
        if (!parent || !node || node.parentNode === parent) return;
        Element.prototype.appendChild.call(parent, node);
    }

    // Prefer <html> over <body>: SvelteKit (mkissa chapter reader) replaces
    // body during hydrate. If the reader goes fullscreen, move the badge
    // into the fullscreen element or it disappears.
    function mountBadge() {
        const parent = D.fullscreenElement || D.documentElement;
        if (!parent) return;
        try {
            if (badgeEl) nativeAppend(parent, badgeEl);
            if (menuEl) nativeAppend(parent, menuEl);
        } catch (e) {
            console.log('Redirect blocker: mount failed', e);
        }
        if (badgeEl) {
            const pos = resolvePosition();
            applyPosition(pos.left, pos.top);
            syncBadgeVisual();
        }
    }

    function injectStatusIcon() {
        const existing = D.getElementById('rb-status-icon');
        if (existing && existing !== badgeEl) return; // another copy already mounted
        if (!badgeEl) {
            badgeEl = createBadgeElement();
            menuEl = createMenuElement();
            syncBadgeVisual();
            enableDrag();
            enableMenuDismiss();
            D.addEventListener('fullscreenchange', mountBadge);
            const keep = new MutationObserver(() => {
                if ((badgeEl && !badgeEl.isConnected) || (menuEl && !menuEl.isConnected)) {
                    mountBadge();
                }
            });
            if (D.documentElement) {
                try {
                    keep.observe(D.documentElement, { childList: true, subtree: true });
                } catch (e) { /* document not ready */ }
            }
        }
        mountBadge();
        observeScripts();
    }

    function registerShowIconCommand() {
        try {
            const gm = (typeof GM_registerMenuCommand === 'function')
                ? GM_registerMenuCommand
                : (typeof GM !== 'undefined' && GM && typeof GM.registerMenuCommand === 'function'
                    ? GM.registerMenuCommand.bind(GM)
                    : null);
            if (!gm) return;
            gm('Show Redirect Blocker icon', () => {
                setIconHidden(false);
                mountBadge();
            });
        } catch (e) { /* page world often has no GM menu API */ }
    }

    function bootBadge() {
        registerShowIconCommand();
        injectStatusIcon();
        if (D.readyState === 'loading') {
            D.addEventListener('DOMContentLoaded', injectStatusIcon);
        }
        W.addEventListener('load', injectStatusIcon);
        // SPA hydrate / reader overlay can strip or cover the node after load.
        // Skip the poll in jsdom so the test suite does not sit on the timer.
        if (typeof navigator === 'undefined' || !/jsdom/i.test(navigator.userAgent)) {
            let attempts = 0;
            const timer = setInterval(() => {
                attempts++;
                injectStatusIcon();
                if (attempts >= 20) clearInterval(timer);
            }, 500);
            if (typeof timer.unref === 'function') timer.unref();
        }
    }
    bootBadge();
    }
})();
