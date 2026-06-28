// ==UserScript==
// @name         Advanced Redirect Blocker for allmanga.to
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Prevents redirects to blocked domains by intercepting click events and rewriting URLs dynamically. Shows a draggable status badge with a blocked-redirect counter.
// @author       You
// @match        *://allmanga.to/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    // Define blocked domains
    const blockedDomains = ['youtu-chan.com'];
    const originalHostname = window.location.hostname;

    // --- Status / persistence -------------------------------------------------
    const POS_KEY = 'rb-icon-pos';       // saved badge position (viewport ratios)
    const TOTAL_KEY = 'rb-blocked-total'; // cumulative blocks across page loads
    const ICON_SIZE = 22;                 // badge width/height in px
    const ICON_MARGIN = 12;               // default gap from the viewport edge

    let badgeEl = null;
    let sessionBlocked = 0;               // blocks during this page load
    let totalBlocked = storageGet(TOTAL_KEY, 0, parseIntSafe); // persisted total

    // Small, defensive localStorage helpers (storage can throw in private mode)
    function storageGet(key, fallback, parse) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return fallback;
            const value = parse ? parse(raw) : raw;
            return value === undefined ? fallback : value;
        } catch (e) {
            return fallback;
        }
    }
    function storageSet(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
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
        const label = `Redirect Blocker active — ${sessionBlocked} blocked this session (${totalBlocked} total)`;
        badgeEl.title = label;
        badgeEl.setAttribute('aria-label', label);
    }

    // Function to rewrite URL to original domain
    function rewriteUrl(url) {
        // Leave falsy URLs untouched (e.g. history.pushState(state, '', null))
        if (!url) return url;
        try {
            const urlObj = new URL(url, window.location.origin);
            if (blockedDomains.some(domain => urlObj.hostname.includes(domain))) {
                const correctedUrl = `https://${originalHostname}${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
                console.log(`Rewrote URL from ${url} to ${correctedUrl}`);
                return correctedUrl;
            }
            return url;
        } catch (e) {
            console.log(`Invalid URL: ${url}, error: ${e}`);
            return url; // Leave unparseable URLs unchanged
        }
    }
    
    // Intercept click events on the document
    document.addEventListener('click', function(event) {
        const target = event.target.closest('a, button, [onclick]');
        if (target) {
            // Check for href (anchor tags)
            if (target.tagName === 'A' && target.href) {
                const newUrl = rewriteUrl(target.href);
                if (newUrl !== target.href) {
                    event.preventDefault(); // Stop original navigation
                    recordBlock();
                    window.location.href = newUrl; // Navigate to corrected URL
                }
            }
            // Check for onclick handlers
            else if (target.onclick || target.getAttribute('onclick')) {
                // Only act when an href actually points at a blocked domain
                const href = target.getAttribute('href');
                if (href) {
                    const newUrl = rewriteUrl(href);
                    if (newUrl !== href) {
                        event.preventDefault(); // Prevent default onclick behavior
                        recordBlock();
                        window.location.href = newUrl;
                    }
                }
            }
        }
    }, true); // Use capture phase to intercept early
    
    // Monitor dynamically added scripts that might trigger redirects
    const scriptObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.tagName === 'SCRIPT') {
                    const src = node.src || '';
                    if (blockedDomains.some(domain => src.includes(domain))) {
                        node.remove(); // Remove suspicious scripts
                        recordBlock();
                        console.log(`Removed script with src: ${src}`);
                    }
                }
            });
        });
    });
    
    scriptObserver.observe(document.documentElement, { childList: true, subtree: true });
    
    // Override navigation methods as a fallback
    const originalPushState = history.pushState;
    history.pushState = function(state, title, url) {
        const newUrl = rewriteUrl(url);
        if (newUrl !== url) recordBlock();
        return originalPushState.call(history, state, title, newUrl);
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function(state, title, url) {
        const newUrl = rewriteUrl(url);
        if (newUrl !== url) recordBlock();
        return originalReplaceState.call(history, state, title, newUrl);
    };
    
    // Block pop-ups and external window openings
    const originalWindowOpen = window.open;
    window.open = function(url, ...args) {
        const newUrl = rewriteUrl(url);
        // Block when the URL was rewritten (blocked domain detected)
        if (newUrl !== url) {
            recordBlock();
            console.log(`Blocked window.open to ${url}`);
            return null;
        }
        // Allow same-domain opens or pass through to original
        return originalWindowOpen.call(window, newUrl, ...args);
    };

    // --- Status badge (draggable, position-remembering) ----------------------

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    // Largest valid top-left coords so the badge stays fully on screen
    function maxLeft() { return Math.max(0, window.innerWidth - ICON_SIZE); }
    function maxTop() { return Math.max(0, window.innerHeight - ICON_SIZE); }

    // Position is stored relative to the nearest viewport corner so the badge
    // keeps the same distance from that corner when the window is resized.
    // corner is a two-char code: horizontal 'L'/'R' + vertical 'T'/'B'.

    // Which corner is the badge (at left/top) closest to?
    function nearestCorner(left, top) {
        const h = (left + ICON_SIZE / 2) < window.innerWidth / 2 ? 'L' : 'R';
        const v = (top + ICON_SIZE / 2) < window.innerHeight / 2 ? 'T' : 'B';
        return h + v;
    }

    // Pixel position for a corner + its (dx, dy) inset from that corner's edges
    function positionFor(corner, dx, dy) {
        const left = corner[0] === 'L' ? dx : window.innerWidth - ICON_SIZE - dx;
        const top = corner[1] === 'T' ? dy : window.innerHeight - ICON_SIZE - dy;
        return { left: clamp(left, 0, maxLeft()), top: clamp(top, 0, maxTop()) };
    }

    // Inset of left/top from the given corner's edges
    function offsetsFor(corner, left, top) {
        const dx = corner[0] === 'L' ? left : window.innerWidth - ICON_SIZE - left;
        const dy = corner[1] === 'T' ? top : window.innerHeight - ICON_SIZE - top;
        return { dx: Math.max(0, Math.round(dx)), dy: Math.max(0, Math.round(dy)) };
    }

    // Resolve the badge's pixel position: saved corner-relative offset if
    // present, else default to the bottom-right corner. Returns { left, top }.
    function resolvePosition() {
        const saved = storageGet(POS_KEY, null, JSON.parse);
        if (saved && typeof saved.corner === 'string'
            && typeof saved.dx === 'number' && typeof saved.dy === 'number') {
            return positionFor(saved.corner, saved.dx, saved.dy);
        }
        return positionFor('RB', ICON_MARGIN, ICON_MARGIN);
    }

    function applyPosition(left, top) {
        badgeEl.style.left = Math.round(clamp(left, 0, maxLeft())) + 'px';
        badgeEl.style.top = Math.round(clamp(top, 0, maxTop())) + 'px';
        badgeEl.style.right = 'auto';
        badgeEl.style.bottom = 'auto';
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
            dragging = true;
            moved = false;
            startMouseX = event.clientX;
            startMouseY = event.clientY;
            startLeft = parseFloat(badgeEl.style.left) || 0;
            startTop = parseFloat(badgeEl.style.top) || 0;
            badgeEl.style.cursor = 'grabbing';
            event.preventDefault(); // avoid text selection while dragging
        });

        window.addEventListener('mousemove', (event) => {
            if (!dragging) return;
            const dx = event.clientX - startMouseX;
            const dy = event.clientY - startMouseY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
            applyPosition(startLeft + dx, startTop + dy);
        });

        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            badgeEl.style.cursor = 'grab';
            if (moved) {
                savePosition(parseFloat(badgeEl.style.left) || 0, parseFloat(badgeEl.style.top) || 0);
            }
        });

        // Keep the relative position when the window is resized
        window.addEventListener('resize', () => {
            const pos = resolvePosition();
            applyPosition(pos.left, pos.top);
        });
    }

    // Inject a small status badge so it's visible the script is active
    function injectStatusIcon() {
        if (document.getElementById('rb-status-icon')) return; // avoid duplicates
        const badge = document.createElement('div');
        badge.id = 'rb-status-icon';
        badge.style.cssText = [
            'position:fixed',
            'width:' + ICON_SIZE + 'px',
            'height:' + ICON_SIZE + 'px',
            'z-index:2147483647',
            'opacity:0.55',
            'cursor:grab',
            'transition:opacity 0.2s ease',
            'pointer-events:auto',
            'user-select:none'
        ].join(';');
        badge.addEventListener('mouseenter', () => { badge.style.opacity = '1'; });
        badge.addEventListener('mouseleave', () => { badge.style.opacity = '0.55'; });
        // Shield with a check mark
        badge.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + ICON_SIZE + '" height="' + ICON_SIZE + '" style="pointer-events:none">' +
            '<path fill="#2e7d32" d="M12 2 4 5v6c0 5 3.4 8.4 8 11 4.6-2.6 8-6 8-11V5l-8-3z"/>' +
            '<path fill="#ffffff" d="m10.6 14.6-2.3-2.3-1.1 1.1 3.4 3.4 6-6-1.1-1.1z"/>' +
            '</svg>';
        document.body.appendChild(badge);

        badgeEl = badge;
        const pos = resolvePosition();
        applyPosition(pos.left, pos.top);
        updateBadgeTooltip();
        enableDrag();
    }

    if (document.body) {
        injectStatusIcon();
    } else {
        document.addEventListener('DOMContentLoaded', injectStatusIcon);
    }
})();
