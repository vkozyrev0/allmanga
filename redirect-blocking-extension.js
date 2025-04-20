// ==UserScript==
// @name         Advanced Redirect Blocker for allmanga.to
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Prevents redirects to blocked domains by intercepting click events and rewriting URLs dynamically.
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
            return window.location.href; // Fallback to current URL
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
                event.preventDefault(); // Prevent default onclick behavior
                const href = target.getAttribute('href') || window.location.href;
                const newUrl = rewriteUrl(href);
                window.location.href = newUrl;
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
    window.open = function(url) {
        const newUrl = rewriteUrl(url);
        if (newUrl === url) {
            return null; // Block if not rewritten (assumes external intent)
        }
        console.log(`Blocked window.open to ${url}`);
        return null;
    };
})();