'use strict';

const HOST_RE = /(^|\.)(mkissa\.to|mkissa\.net|allmanga\.to)$/i;

function hostOf(url) {
    try { return new URL(url).hostname; } catch (e) { return ''; }
}

function inject(tabId) {
    if (tabId == null) return;
    chrome.scripting.executeScript({
        target: { tabId: tabId, allFrames: true },
        files: ['inject.js'],
        world: 'ISOLATED',
        injectImmediately: true,
    }).catch(function () { /* no host access yet */ });
}

chrome.tabs.onUpdated.addListener(function (tabId, info, tab) {
    if (!tab || !tab.url) return;
    if (!HOST_RE.test(hostOf(tab.url))) return;
    if (info.status === 'loading' || info.status === 'complete') inject(tabId);
});

chrome.action.onClicked.addListener(function (tab) {
    if (tab && tab.id != null) inject(tab.id);
});
