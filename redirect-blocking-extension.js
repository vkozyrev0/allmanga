// ==UserScript==
// @name         Advanced Redirect Blocker for allmanga.to
// @namespace    http://tampermonkey.net/
// @version      1.5
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
                // FIXED: Added parentheses around template literal
                // console.log`Rewrote URL from ${url} to ${correctedUrl}`);
                console.log(`Rewrote URL from ${url} to ${correctedUrl}`);
                return correctedUrl;
            }
            return url;
        } catch (e) {
            // FIXED: Added parentheses around template literal
            // console.log`Invalid URL: ${url}, error: ${e}`);
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
                // FIXED: Only proceed if href actually exists
                const href = target.getAttribute('href');
                if (href) {
                    event.preventDefault(); // Prevent default onclick behavior
                    const newUrl = rewriteUrl(href);
                    window.location.href = newUrl;
                }
                // OLD CODE: Fallback to current URL didn't make sense for buttons without href
                // const href = target.getAttribute('href') || window.location.href;
                // const newUrl = rewriteUrl(href);
                // window.location.href = newUrl;
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
                        // FIXED: Added parentheses around template literal
                        // console.log`Removed script with src: ${src}`);
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
    // FIXED: Preserved original window.open and inverted logic
    const originalWindowOpen = window.open;
    window.open = function(url, ...args) {
        const newUrl = rewriteUrl(url);
        // FIXED: Block when URL WAS rewritten (blocked domain detected)
        if (newUrl !== url) {
            // FIXED: Added parentheses around template literal
            // console.log`Blocked window.open to ${url}`);
            console.log(`Blocked window.open to ${url}`);
            return null;
        }
        // Allow same-domain opens or pass through to original
        return originalWindowOpen.call(window, newUrl, ...args);
        
        // OLD CODE: Logic was backwards - blocked legitimate opens
        // if (newUrl === url) {
        //     return null; // Block if not rewritten (assumes external intent)
        // }
        // console.log`Blocked window.open to ${url}`);
        // return null;
    };
})();
