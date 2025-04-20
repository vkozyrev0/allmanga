// ==UserScript==
// @name         Block Redirects and Prevent Tracking on allmanga.to and other sites
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Blocks unwanted redirects from allmanga.to to youtu-chan.com (+more sites), clears local storage, cookies, and prevents other tracking techniques.
// @author       You
// @match        *://allmanga.to/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Block specific domains like youtu-chan.com
    const blockedDomains = ['youtu-chan.com'];

    // Skip Redirect in window.open
    const originalWindowOpen = window.open;
    window.open = function(url) {
        const newUrl = new URL(url);
        if (blockedDomains.some(domain => newUrl.hostname.includes(domain))) {
            console.log(`Blocked redirect to ${newUrl.hostname}`);
            return null; // Block the redirect
        }
        return originalWindowOpen.apply(this, arguments);
    };

    // Override window.location changes
    const originalLocationSetter = Object.getOwnPropertyDescriptor(window, 'location').set;
    Object.defineProperty(window, 'location', {
        set: function(newUrl) {
            const urlObj = new URL(newUrl);
            if (blockedDomains.some(domain => urlObj.hostname.includes(domain))) {
                console.log(`Blocked redirect to ${urlObj.hostname}`);
                return; // Block the redirect
            }
            return originalLocationSetter.call(this, newUrl);
        }
    });

    // Clear local storage and cookies only for specific domains
    if (
		window.location.hostname.includes('allmanga.to') 
		|| window.location.hostname.includes('drakecomic.org')
		|| window.location.hostname.includes('lunarscan.org')
		|| window.location.hostname.includes('xcalibrscans.com')
	) {
        // Clear local storage
        window.localStorage.clear();

        // Delete all cookies
        document.cookie.split(";").forEach(function(c) {
            document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
        });
    }

    // Unregister service workers
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for (let registration of registrations) {
            registration.unregister();
        }
    });

    // Prevent canvas fingerprinting
    HTMLCanvasElement.prototype.toDataURL = function() {
        return "";
    };

    // Stop autoplay videos
    const videos = document.getElementsByTagName('video');
    for (let video of videos) {
        video.autoplay = false;
    }
    
    // Block pop-ups
    window.open = function() {
        console.log('Blocked a pop-up');
        return null;
    };
})();
