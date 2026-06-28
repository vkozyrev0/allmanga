// ==UserScript==
// @name         Advanced Redirect Blocker for allmanga.to
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Prevents redirects to blocked domains by intercepting click events and rewriting URLs dynamically. Shows a small status badge while active.
// @author       You
// @match        *://allmanga.to/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    // Define blocked domains
    const blockedDomains = ['youtu-chan.com'];
    const originalHostname = window.location.hostname;
    
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
                    window.location.href = newUrl; // Navigate to corrected URL
                }
            }
            // Check for onclick handlers
            else if (target.onclick || target.getAttribute('onclick')) {
                // Only proceed if href actually exists
                const href = target.getAttribute('href');
                if (href) {
                    event.preventDefault(); // Prevent default onclick behavior
                    const newUrl = rewriteUrl(href);
                    window.location.href = newUrl;
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
        return originalPushState.call(history, state, title, newUrl);
    };
    
    const originalReplaceState = history.replaceState;
    history.replaceState = function(state, title, url) {
        const newUrl = rewriteUrl(url);
        return originalReplaceState.call(history, state, title, newUrl);
    };
    
    // Block pop-ups and external window openings
    const originalWindowOpen = window.open;
    window.open = function(url, ...args) {
        const newUrl = rewriteUrl(url);
        // Block when the URL was rewritten (blocked domain detected)
        if (newUrl !== url) {
            console.log(`Blocked window.open to ${url}`);
            return null;
        }
        // Allow same-domain opens or pass through to original
        return originalWindowOpen.call(window, newUrl, ...args);
    };

    // Inject a small status badge so it's visible the script is active
    function injectStatusIcon() {
        if (document.getElementById('rb-status-icon')) return; // avoid duplicates
        const badge = document.createElement('div');
        badge.id = 'rb-status-icon';
        badge.title = 'Redirect Blocker active';
        badge.setAttribute('aria-label', 'Redirect Blocker active');
        badge.style.cssText = [
            'position:fixed',
            'bottom:12px',
            'right:12px',
            'width:22px',
            'height:22px',
            'z-index:2147483647',
            'opacity:0.55',
            'cursor:default',
            'transition:opacity 0.2s ease',
            'pointer-events:auto'
        ].join(';');
        badge.addEventListener('mouseenter', () => { badge.style.opacity = '1'; });
        badge.addEventListener('mouseleave', () => { badge.style.opacity = '0.55'; });
        // Shield with a check mark
        badge.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22">' +
            '<path fill="#2e7d32" d="M12 2 4 5v6c0 5 3.4 8.4 8 11 4.6-2.6 8-6 8-11V5l-8-3z"/>' +
            '<path fill="#ffffff" d="m10.6 14.6-2.3-2.3-1.1 1.1 3.4 3.4 6-6-1.1-1.1z"/>' +
            '</svg>';
        document.body.appendChild(badge);
    }

    if (document.body) {
        injectStatusIcon();
    } else {
        document.addEventListener('DOMContentLoaded', injectStatusIcon);
    }
})();
