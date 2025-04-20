// ==UserScript==
// @name         Block Redirects and Prevent Tracking on allmanga.to and other sites
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Blocks unwanted redirects from allmanga.to to youtu-chan.com (+more sites), preserves original URL path and query, clears local storage, cookies, and prevents tracking.
// @author       You
// @match        *://allmanga.to/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Define blocked domains
    const blockedDomains = ['youtu-chan.com'];

    // **Original window.open override to block specific domains**
    const originalWindowOpen = window.open;
    window.open = function(url) {
        if (url) {
            try {
                const newUrl = new URL(url);
                if (blockedDomains.some(domain => newUrl.hostname.includes(domain))) {
                    console.log(`Blocked opening window to ${newUrl.hostname}`);
                    return null; // Block the redirect, preserving current URL
                }
            } catch (e) {
                console.log(`Invalid URL in window.open: ${url}`);
            }
        }
        return originalWindowOpen.apply(this, arguments);
    };

    // **Original window.open override to block ALL pop-ups (kept as per request)**
    window.open = function() {
        return null;
    };

    // **Original window.location setter override (kept as per request)**
    Object.defineProperty(window, 'location', {
        set: function(url) {
            try {
                const urlObj = new URL(url);
                if (blockedDomains.some(domain => urlObj.hostname.includes(domain))) {
                    console.log(`Blocked redirect to ${url}`);
                    return; // Prevent the redirect, preserving original URL
                }
                window.location.href = url; // Allow non-blocked redirects
            } catch (e) {
                console.log(`Invalid URL in location setter: ${url}`);
            }
        },
        get: function() {
            return window.location;
        }
    });

    // **Added window.location.assign override to enhance redirect blocking**
    const originalAssign = window.location.assign;
    window.location.assign = function(url) {
        try {
            const urlObj = new URL(url);
            if (blockedDomains.some(domain => urlObj.hostname.includes(domain))) {
                console.log(`Blocked navigation via assign to ${url}`);
                return; // Prevent navigation, preserving original URL
            }
        } catch (e) {
            console.log(`Invalid URL in assign: ${url}`);
        }
        return originalAssign.call(window.location, url);
    };

    // **Added window.location.replace override to enhance redirect blocking**
    const originalReplace = window.location.replace;
    window.location.replace = function(url) {
        try {
            const urlObj = new URL(url);
            if (blockedDomains.some(domain => urlObj.hostname.includes(domain))) {
                console.log(`Blocked navigation via replace to ${url}`);
                return; // Prevent navigation, preserving original URL
            }
        } catch (e) {
            console.log(`Invalid URL in replace: ${url}`);
        }
        return originalReplace.call(window.location, url);
    };

    // **Original code to clear local storage and cookies**
    if (
        window.location.hostname.includes('allmanga.to') ||
        window.location.hostname.includes('drakecomic.org') ||
        window.location.hostname.includes('lunarscan.org') ||
        window.location.hostname.includes('xcalibrscans.com')
    ) {
        // Clear local storage
        window.localStorage.clear();

        // Delete all cookies
        document.cookie.split(";").forEach(function(c) {
            document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
        });
    }

    // **Original code to unregister service workers**
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for (let registration of registrations) {
            registration.unregister();
        }
    });

    // **Original code to prevent canvas fingerprinting**
    HTMLCanvasElement.prototype.toDataURL = function() {
        return "";
    };

    // **Original code to stop autoplay videos**
    const videos = document.getElementsByTagName('video');
    for (let video of videos) {
        video.autoplay = false;
    }
})();