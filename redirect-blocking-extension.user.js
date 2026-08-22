// ==UserScript==
// @name         Redirect Blocker
// @namespace    http://tampermonkey.net/
// @version      1.25
// @description  Prevents off-site redirects. The status badge appears on every site so you can add the current host (or any URL) from the settings modal.
// @author       You
// @match        http://*/*
// @match        https://*/*
// @noframes
// @run-at       document-start
// @inject-into  page
// @downloadURL  https://raw.githubusercontent.com/vkozyrev0/allmanga/refs/heads/main/redirect-blocking-extension.user.js
// @updateURL    https://raw.githubusercontent.com/vkozyrev0/allmanga/refs/heads/main/redirect-blocking-extension.user.js
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
    const ENABLED_KEY = 'rb-enabled';     // legacy global pause ('0'); migrated to hosts
    const DISABLED_HOSTS_KEY = 'rb-disabled-hosts'; // JSON list of hostnames where blocking is off
    const SITES_KEY = 'rb-source-sites'; // JSON [{ host, enabled }] sister/source hosts
    const TARGETS_KEY = 'rb-target-sites'; // JSON [{ host, enabled }] destinations to block
    const MAPS_KEY = 'rb-url-maps';      // JSON [{ source, target, enabled }] rewrite rules
    const ICON_SIZE = 22;                 // badge width/height in px
    const ICON_MARGIN = 12;               // default gap from the viewport edge

    let badgeEl = null;
    let modalEl = null;
    let modalStatus = null;
    let siteListEl = null;
    let targetListEl = null;
    let mapListEl = null;
    let modalError = null;
    let siteInput = null;
    let targetInput = null;
    let addCurrentBar = null;
    let mapSourceInput = null;
    let mapTargetInput = null;
    let glyphGroup = null;
    let discEl = null;
    let countEl = null;
    let modalOpen = false;
    let dragging = false;
    let sessionBlocked = 0;               // blocks during this page load
    let totalBlocked = storageGet(TOTAL_KEY, 0, parseIntSafe); // persisted total
    let disabledHosts = loadDisabledHosts();
    let sourceSites = loadSourceSites();
    let targetSites = loadTargetSites();
    let urlMaps = loadUrlMaps();

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

    // Bare hostname used as the per-site toggle key (www. stripped).
    function siteKey() {
        return String(originalHostname || '').toLowerCase().replace(/^www\./, '');
    }

    function loadDisabledHosts() {
        const list = storageGet(DISABLED_HOSTS_KEY, [], (raw) => {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : undefined;
        });
        const set = new Set(list.map((h) => String(h).toLowerCase().replace(/^www\./, '')));
        // v1.16 stored a single global flag. Treat it as "off on this host".
        if (storageGet(ENABLED_KEY, null) === '0') {
            set.add(siteKey());
            try { W.localStorage.removeItem(ENABLED_KEY); } catch (e) { /* ignore */ }
            storageSet(DISABLED_HOSTS_KEY, JSON.stringify(Array.from(set)));
        }
        return set;
    }

    function persistDisabledHosts() {
        storageSet(DISABLED_HOSTS_KEY, JSON.stringify(Array.from(disabledHosts)));
    }

    function persistSites() {
        storageSet(SITES_KEY, JSON.stringify(sourceSites));
    }

    function persistMaps() {
        storageSet(MAPS_KEY, JSON.stringify(urlMaps));
    }

    function persistTargets() {
        storageSet(TARGETS_KEY, JSON.stringify(targetSites));
    }

    function parseUrlOrHost(value) {
        const raw = String(value || '').trim();
        if (!raw) return null;
        try {
            const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw);
            const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
            if (!hostname) return null;
            if (hostname !== 'localhost' && hostname.indexOf('.') === -1) return null;
            const pathname = url.pathname || '/';
            return {
                hostname: hostname,
                pathname: pathname,
                search: url.search,
                hash: url.hash,
                href: url.href,
                hasPath: pathname !== '/'
            };
        } catch (e) {
            return null;
        }
    }

    function loadSourceSites() {
        const defaults = allowedHostSuffixes.map((host) => ({ host: host, enabled: true }));
        const parsed = storageGet(SITES_KEY, null, (raw) => {
            const value = JSON.parse(raw);
            return Array.isArray(value) ? value : undefined;
        });
        const sites = [];
        const seen = new Set();
        function add(host, enabled) {
            const h = String(host || '').toLowerCase().replace(/^www\./, '');
            if (!h || seen.has(h)) return;
            seen.add(h);
            sites.push({ host: h, enabled: enabled !== false });
        }
        if (parsed) {
            parsed.forEach((entry) => {
                if (typeof entry === 'string') add(entry, true);
                else if (entry && entry.host) add(entry.host, entry.enabled);
            });
        } else {
            defaults.forEach((entry) => add(entry.host, entry.enabled));
        }
        const key = siteKey();
        // Do not auto-add the current host: the badge is shown everywhere so
        // the user can opt the site in from the modal.
        if (key && disabledHosts.has(key)) {
            sites.forEach((site) => {
                if (hostMatches(key, site.host)) site.enabled = false;
            });
        }
        return sites;
    }

    function loadTargetSites() {
        const parsed = storageGet(TARGETS_KEY, null, (raw) => {
            const value = JSON.parse(raw);
            return Array.isArray(value) ? value : undefined;
        });
        const sites = [];
        const seen = new Set();
        function add(host, enabled) {
            const h = String(host || '').toLowerCase().replace(/^www\./, '');
            if (!h || seen.has(h)) return;
            seen.add(h);
            sites.push({ host: h, enabled: enabled !== false });
        }
        if (parsed) {
            parsed.forEach((entry) => {
                if (typeof entry === 'string') add(entry, true);
                else if (entry && entry.host) add(entry.host, entry.enabled);
            });
        } else {
            blockedDomains.forEach((host) => add(host, true));
        }
        return sites;
    }

    function loadUrlMaps() {
        const parsed = storageGet(MAPS_KEY, [], (raw) => {
            const value = JSON.parse(raw);
            return Array.isArray(value) ? value : undefined;
        });
        return parsed.map((entry) => ({
            source: String(entry && entry.source || '').trim(),
            target: String(entry && entry.target || '').trim(),
            enabled: !entry || entry.enabled !== false
        })).filter((entry) => entry.source);
    }

    function hostMatches(hostname, suffix) {
        const h = String(hostname || '').toLowerCase().replace(/^www\./, '');
        const s = String(suffix || '').toLowerCase().replace(/^www\./, '');
        if (!h || !s) return false;
        return h === s || h.endsWith('.' + s);
    }

    function currentSiteEntry() {
        const key = siteKey();
        return sourceSites.find((site) => hostMatches(key, site.host)) || null;
    }

    function isSiteEnabled() {
        const entry = currentSiteEntry();
        return !!(entry && entry.enabled !== false);
    }

    function isCurrentListed() {
        return !!currentSiteEntry();
    }

    function setHostEnabled(host, on) {
        const parsed = parseUrlOrHost(host);
        const h = parsed ? parsed.hostname : String(host || '').toLowerCase().replace(/^www\./, '');
        if (!h) return;
        let row = sourceSites.find((site) => site.host === h);
        if (!row) {
            row = { host: h, enabled: !!on };
            sourceSites.push(row);
        } else {
            row.enabled = !!on;
        }
        const key = siteKey();
        if (hostMatches(key, h)) {
            if (on) disabledHosts.delete(key);
            else disabledHosts.add(key);
            persistDisabledHosts();
        }
        persistSites();
        syncBadgeVisual();
        if (modalOpen) refreshModal();
    }

    function setSiteEnabled(on) {
        setHostEnabled(siteKey(), on);
    }

    function addSourceSite(value) {
        const parsed = parseUrlOrHost(value);
        if (!parsed) return 'Enter a hostname or URL (example: mkissa.to)';
        if (sourceSites.some((site) => site.host === parsed.hostname)) {
            return parsed.hostname + ' is already in the list';
        }
        sourceSites.push({ host: parsed.hostname, enabled: true });
        const key = siteKey();
        if (hostMatches(key, parsed.hostname)) {
            disabledHosts.delete(key);
            persistDisabledHosts();
        }
        persistSites();
        syncBadgeVisual();
        refreshModal();
        return '';
    }

    function removeSourceSite(host) {
        sourceSites = sourceSites.filter((site) => site.host !== host);
        persistSites();
        syncBadgeVisual();
        refreshModal();
        return '';
    }

    function isBlockedTarget(hostname) {
        const h = String(hostname || '').toLowerCase().replace(/^www\./, '');
        if (!h) return false;
        return targetSites.some((site) => site.enabled !== false && hostMatches(h, site.host));
    }

    function addTargetSite(value) {
        const parsed = parseUrlOrHost(value);
        if (!parsed) return 'Enter a hostname or URL to block (example: isekai2nd.com)';
        if (targetSites.some((site) => site.host === parsed.hostname)) {
            return parsed.hostname + ' is already in the target list';
        }
        targetSites.push({ host: parsed.hostname, enabled: true });
        persistTargets();
        refreshModal();
        return '';
    }

    function removeTargetSite(host) {
        targetSites = targetSites.filter((site) => site.host !== host);
        persistTargets();
        refreshModal();
        return '';
    }

    function setTargetEnabled(host, on) {
        const row = targetSites.find((site) => site.host === host);
        if (!row) return;
        row.enabled = !!on;
        persistTargets();
        refreshModal();
    }

    function addUrlMap(sourceValue, targetValue) {
        const source = parseUrlOrHost(sourceValue);
        if (!source) return 'Enter a source hostname or URL';
        const targetRaw = String(targetValue || '').trim();
        let targetHost = '';
        if (targetRaw) {
            const target = parseUrlOrHost(targetRaw);
            if (!target) return 'Enter a valid target hostname or URL, or leave it blank to block';
            targetHost = target.hasPath ? target.href : target.hostname;
        }
        const sourceKey = source.hasPath ? source.href : source.hostname;
        if (urlMaps.some((map) => map.source === sourceKey)) {
            return sourceKey + ' already has a mapping';
        }
        urlMaps.push({ source: sourceKey, target: targetHost, enabled: true });
        persistMaps();
        refreshModal();
        return '';
    }

    function removeUrlMap(index) {
        if (index < 0 || index >= urlMaps.length) return;
        urlMaps.splice(index, 1);
        persistMaps();
        refreshModal();
    }

    function setMapEnabled(index, on) {
        if (!urlMaps[index]) return;
        urlMaps[index].enabled = !!on;
        persistMaps();
        refreshModal();
    }

    // Count a blocked redirect and refresh the badge tooltip
    function recordBlock() {
        sessionBlocked++;
        totalBlocked++;
        storageSet(TOTAL_KEY, String(totalBlocked));
        updateBadgeTooltip();
        updateCountBadge();
    }
    function updateBadgeTooltip() {
        if (!badgeEl) return;
        const host = siteKey();
        let label;
        if (isSiteEnabled()) {
            label = `Redirect Blocker active on ${host} — ${sessionBlocked} blocked this session (${totalBlocked} total)`;
        } else if (!isCurrentListed()) {
            label = `Redirect Blocker idle on ${host} — click to add this site`;
        } else {
            label = `Redirect Blocker disabled on ${host} — click to open settings`;
        }
        badgeEl.removeAttribute('title');
        badgeEl.setAttribute('aria-label', label);
        badgeEl.setAttribute('data-rb-enabled', isSiteEnabled() ? '1' : '0');
        badgeEl.setAttribute('data-rb-listed', isCurrentListed() ? '1' : '0');
        badgeEl.setAttribute('data-rb-site', host);
    }

    function updateCountBadge() {
        if (!countEl) return;
        if (sessionBlocked <= 0) {
            countEl.textContent = '';
            countEl.style.setProperty('display', 'none', 'important');
            countEl.setAttribute('data-rb-count', '0');
            return;
        }
        const label = sessionBlocked > 99 ? '99+' : String(sessionBlocked);
        countEl.textContent = label;
        countEl.setAttribute('data-rb-count', label);
        countEl.style.setProperty('display', 'block', 'important');
    }

    function paintGlyph() {
        if (!glyphGroup || !discEl) return;
        const enabled = isSiteEnabled();
        discEl.setAttribute('fill', enabled ? '#f76707' : '#495057');
        while (glyphGroup.firstChild) glyphGroup.removeChild(glyphGroup.firstChild);
        // Enabled: one continuous chain (two loops joined in the middle).
        // Disabled: the same loops pulled apart plus a slash — reads as
        // "broken link" even at 22px, where a tiny gap alone disappears.
        const paths = enabled
            ? [
                'M8 13.5l-1.6 1.6a3.2 3.2 0 0 0 4.5 4.5l2.4-2.4',
                'M16 10.5l1.6-1.6a3.2 3.2 0 0 0-4.5-4.5l-2.4 2.4',
                'M10 14l4-4'
            ]
            : [
                'M7 14.2l-1.6 1.6a3.2 3.2 0 0 0 4.5 4.5l1.6-1.6',
                'M17 9.8l1.6-1.6a3.2 3.2 0 0 0-4.5-4.5l-1.6 1.6',
                'M8 8l8 8'
            ];
        paths.forEach((d, i) => {
            const path = D.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            if (!enabled && i === 2) path.setAttribute('data-rb-slash', '1');
            glyphGroup.appendChild(path);
        });
        const kind = enabled ? 'unbroken' : 'broken';
        glyphGroup.setAttribute('data-rb-glyph', kind);
        if (badgeEl) badgeEl.setAttribute('data-rb-glyph', kind);
    }

    function syncBadgeVisual() {
        if (!badgeEl) return;
        paintGlyph();
        badgeEl.style.setProperty('display', 'block', 'important');
        updateBadgeTooltip();
        updateCountBadge();
        if (modalOpen) refreshModalStatus();
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
        return sourceSites.some((site) => site.enabled !== false && hostMatches(h, site.host));
    }

    function mappingFor(urlObj) {
        const destHost = urlObj.hostname.toLowerCase().replace(/^www\./, '');
        for (let i = 0; i < urlMaps.length; i++) {
            const map = urlMaps[i];
            if (map.enabled === false) continue;
            const src = parseUrlOrHost(map.source);
            if (!src) continue;
            if (!hostMatches(destHost, src.hostname)) continue;
            if (src.hasPath && urlObj.pathname.toLowerCase().indexOf(src.pathname.toLowerCase()) !== 0) continue;
            return map;
        }
        return null;
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
        if (!isSiteEnabled()) return { action: 'allow', url: url };
        if (!url) return { action: 'allow', url: url };
        try {
            const urlObj = new URL(String(url), W.location.origin);
            const map = mappingFor(urlObj);
            if (map) {
                const target = parseUrlOrHost(map.target);
                if (!target) return { action: 'block', url: url };
                if (target.hasPath) return { action: 'rewrite', url: target.href };
                const rewritten = `https://${target.hostname}${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
                return { action: 'rewrite', url: rewritten };
            }
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
        // Same-tab off-site is the next-page hijack. New-tab (Discord, etc.) stays
        // unless the destination is a listed target site.
        if (newTab && decision.action === 'block' && !isBlockedTarget(hostnameOf(href))) return;
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
        const fromTargets = targetSites
            .filter((site) => site.enabled !== false)
            .map((site) => site.host);
        const fromMaps = urlMaps
            .filter((map) => map.enabled !== false)
            .map((map) => {
                const parsed = parseUrlOrHost(map.source);
                return parsed ? parsed.hostname : '';
            })
            .filter(Boolean);
        const hosts = fromTargets.concat(fromMaps);
        return hosts.some((domain) => host.includes(domain) || String(src).includes(domain));
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
        if (!isSiteEnabled()) return;
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

    // Drag and left-click. A small move threshold keeps a plain click
    // from being treated as a drag. Click opens the settings modal.
    function enableBadgeUi() {
        let moved = false;
        let startMouseX = 0, startMouseY = 0;
        let startLeft = 0, startTop = 0;

        badgeEl.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
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
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                moved = true;
                hideModal();
            }
            applyPosition(startLeft + dx, startTop + dy);
        });

        W.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            badgeEl.style.cursor = 'grab';
            if (moved) {
                savePosition(parseFloat(badgeEl.style.left) || 0, parseFloat(badgeEl.style.top) || 0);
            } else if (modalOpen) {
                hideModal();
            } else {
                showModal();
            }
        });

        badgeEl.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
        }, true);

        W.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') hideModal();
        });
        W.addEventListener('resize', () => {
            const pos = resolvePosition();
            applyPosition(pos.left, pos.top);
        });
    }

    // Glyph on a disc — built with DOM APIs so Trusted Types / innerHTML CSP
    // on the host page cannot strip the icon. paintGlyph() draws an unbroken
    // chain when this site is enabled and a slashed broken chain when not.
    function createBadgeSvg() {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = D.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', String(ICON_SIZE));
        svg.setAttribute('height', String(ICON_SIZE));
        svg.style.pointerEvents = 'none';

        discEl = D.createElementNS(ns, 'circle');
        discEl.id = 'rb-disc';
        discEl.setAttribute('cx', '12');
        discEl.setAttribute('cy', '12');
        discEl.setAttribute('r', '11');
        discEl.setAttribute('fill', '#f76707');
        svg.appendChild(discEl);

        glyphGroup = D.createElementNS(ns, 'g');
        glyphGroup.id = 'rb-glyph';
        glyphGroup.setAttribute('fill', 'none');
        glyphGroup.setAttribute('stroke', '#ffffff');
        glyphGroup.setAttribute('stroke-width', '2');
        glyphGroup.setAttribute('stroke-linecap', 'round');
        glyphGroup.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(glyphGroup);
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
            'overflow:visible',
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
        badge.appendChild(createBadgeSvg());
        countEl = D.createElement('div');
        countEl.id = 'rb-block-count';
        countEl.setAttribute('aria-hidden', 'true');
        [
            ['display', 'none'],
            ['position', 'absolute'],
            ['right', '-5px'],
            ['bottom', '-5px'],
            ['min-width', '13px'],
            ['height', '13px'],
            ['padding', '0 3px'],
            ['box-sizing', 'border-box'],
            ['border-radius', '8px'],
            ['background', '#111111'],
            ['color', '#ffffff'],
            ['font', '700 9px/13px system-ui,sans-serif'],
            ['text-align', 'center'],
            ['pointer-events', 'none'],
            ['z-index', '1']
        ].forEach(([prop, value]) => countEl.style.setProperty(prop, value, 'important'));
        badge.appendChild(countEl);
        return badge;
    }

    function el(tag, attrs, text) {
        const node = D.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach((key) => {
                if (key === 'className') node.className = attrs[key];
                else node.setAttribute(key, attrs[key]);
            });
        }
        if (text != null) node.textContent = text;
        return node;
    }

    // Host pages often style `button` / `input` globally. Shadow + a local
    // stylesheet keeps the settings modal readable.
    function createModalElement() {
        const host = D.createElement('div');
        host.id = 'rb-icon-modal';
        host.setAttribute('aria-hidden', 'true');
        [
            ['display', 'none'],
            ['position', 'fixed'],
            ['inset', '0'],
            ['z-index', '2147483646'],
            ['margin', '0'],
            ['padding', '0'],
            ['border', 'none'],
            ['background', 'transparent'],
            ['pointer-events', 'auto']
        ].forEach(([prop, value]) => host.style.setProperty(prop, value, 'important'));

        let root = host;
        try {
            if (host.attachShadow) root = host.attachShadow({ mode: 'open' });
        } catch (e) { root = host; }

        const style = D.createElement('style');
        style.textContent = [
            '.overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;',
            'align-items:center;justify-content:center;padding:16px;box-sizing:border-box}',
            '.dialog{width:min(440px,100%);max-height:min(80vh,640px);overflow:auto;',
            'background:#1a1b1e;color:#f8f9fa;border:1px solid #373a40;border-radius:10px;',
            'box-shadow:0 16px 48px rgba(0,0,0,.55);font:13px/1.4 system-ui,sans-serif}',
            '.head{display:flex;align-items:center;justify-content:space-between;',
            'gap:12px;padding:14px 16px 8px}',
            '.title{margin:0;font:600 15px/1.3 system-ui,sans-serif}',
            '.close{width:28px;height:28px;border:0;border-radius:6px;background:transparent;',
            'color:#f8f9fa;font:18px/28px system-ui,sans-serif;cursor:pointer}',
            '.close:hover{background:#373a40}',
            '.status{margin:0;padding:0 16px 12px;color:#adb5bd;font:12px/1.3 system-ui,sans-serif}',
            '.section{padding:8px 16px 12px;border-top:1px solid #2c2e33}',
            '.label{margin:0 0 8px;font:600 12px/1.3 system-ui,sans-serif;color:#ced4da;',
            'text-transform:uppercase;letter-spacing:.04em}',
            '.hint{margin:0 0 8px;color:#868e96;font:12px/1.3 system-ui,sans-serif}',
            '.row{display:flex;align-items:center;gap:8px;padding:6px 0}',
            '.row + .row{border-top:1px solid #2c2e33}',
            '.name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.this{color:#868e96;font-size:11px;margin-left:6px}',
            '.arrow{color:#868e96;flex:0 0 auto}',
            '.toggle{flex:0 0 auto;margin:0}',
            '.remove{flex:0 0 auto;border:0;border-radius:4px;background:transparent;',
            'color:#ffa8a8;font:12px/1 system-ui,sans-serif;cursor:pointer;padding:4px 6px}',
            '.remove:hover{background:#7d1a1a;color:#fff}',
            '.remove:disabled{opacity:.35;cursor:default}',
            '.row .add{color:#fff;background:#f76707}',
            '.row .add:hover{background:#e8590c;color:#fff}',
            '.form{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
            '.form input{flex:1 1 120px;min-width:0;box-sizing:border-box;height:30px;',
            'padding:0 8px;border:1px solid #495057;border-radius:6px;background:#101113;',
            'color:#f8f9fa;font:13px/30px system-ui,sans-serif}',
            '.form input:focus{outline:1px solid #f76707;border-color:#f76707}',
            '.form button,.empty{font:13px/1 system-ui,sans-serif}',
            '.form button{flex:0 0 auto;height:30px;padding:0 10px;border:0;border-radius:6px;',
            'background:#f76707;color:#fff;cursor:pointer}',
            '.form button:hover{background:#e8590c}',
            '.empty{color:#868e96;padding:4px 0}',
            '.add-current{display:none;align-items:center;gap:8px;margin:0 0 10px;padding:8px 10px;',
            'background:#101113;border:1px solid #f76707;border-radius:8px}',
            '.add-current.show{display:flex}',
            '.add-current .copy{flex:1;min-width:0}',
            '.add-current .copy strong{display:block;font:600 13px/1.3 system-ui,sans-serif}',
            '.add-current .copy span{display:block;color:#adb5bd;font:12px/1.3 system-ui,sans-serif}',
            '.add-current button{flex:0 0 auto;height:30px;padding:0 10px;border:0;border-radius:6px;',
            'background:#f76707;color:#fff;cursor:pointer;font:13px/1 system-ui,sans-serif}',
            '.add-current button:hover{background:#e8590c}',
            '.error{min-height:16px;margin:6px 16px 0;color:#ffa8a8;font:12px/1.3 system-ui,sans-serif}'
        ].join('');

        const overlay = el('div', { className: 'overlay' });
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) hideModal();
        });

        const dialog = el('div', {
            className: 'dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'rb-modal-title'
        });
        dialog.addEventListener('click', (event) => event.stopPropagation());
        dialog.addEventListener('mousedown', (event) => event.stopPropagation());

        const head = el('div', { className: 'head' });
        head.appendChild(el('h2', { className: 'title', id: 'rb-modal-title' }, 'Redirect Blocker'));
        const closeBtn = el('button', { className: 'close', id: 'rb-modal-close', type: 'button', 'aria-label': 'Close' }, '×');
        closeBtn.addEventListener('click', (event) => {
            event.preventDefault();
            hideModal();
        });
        head.appendChild(closeBtn);

        modalStatus = el('p', { className: 'status', id: 'rb-modal-status' });

        const sitesSection = el('section', { className: 'section' });
        sitesSection.appendChild(el('h3', { className: 'label' }, 'Source sites'));
        sitesSection.appendChild(el('p', { className: 'hint' }, 'The badge appears on every site. Add this site (or any URL) to turn blocking on here. Uncheck a listed site to pause it; remove it to drop it from the family list.'));
        addCurrentBar = el('div', { className: 'add-current', id: 'rb-add-current' });
        const addCurrentCopy = el('div', { className: 'copy' });
        addCurrentCopy.appendChild(el('strong', { id: 'rb-add-current-host' }, ''));
        addCurrentCopy.appendChild(el('span', null, 'Not in the source list — blocking is off here.'));
        const addCurrentBtn = el('button', { id: 'rb-add-current-btn', type: 'button' }, 'Add this site');
        addCurrentBtn.addEventListener('click', () => {
            const err = addSourceSite(siteKey());
            if (err) showModalError(err);
        });
        addCurrentBar.appendChild(addCurrentCopy);
        addCurrentBar.appendChild(addCurrentBtn);
        sitesSection.appendChild(addCurrentBar);
        siteListEl = el('div', { id: 'rb-site-list' });
        sitesSection.appendChild(siteListEl);
        const siteForm = el('div', { className: 'form' });
        siteInput = el('input', {
            id: 'rb-site-add-input',
            type: 'text',
            placeholder: 'example.com',
            spellcheck: 'false',
            autocomplete: 'off'
        });
        const siteAdd = el('button', { id: 'rb-site-add-btn', type: 'button' }, 'Add site');
        siteAdd.addEventListener('click', () => {
            const err = addSourceSite(siteInput.value);
            if (err) showModalError(err);
            else siteInput.value = '';
        });
        siteInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                siteAdd.click();
            }
        });
        siteForm.appendChild(siteInput);
        siteForm.appendChild(siteAdd);
        sitesSection.appendChild(siteForm);

        const targetsSection = el('section', { className: 'section' });
        targetsSection.appendChild(el('h3', { className: 'label' }, 'Target sites'));
        targetsSection.appendChild(el('p', { className: 'hint' }, 'Sites you do not want to be redirected to. Added hosts are blocked and their injected scripts are stripped. Uncheck to pause one; remove to drop it.'));
        targetListEl = el('div', { id: 'rb-target-list' });
        targetsSection.appendChild(targetListEl);
        const targetForm = el('div', { className: 'form' });
        targetInput = el('input', {
            id: 'rb-target-add-input',
            type: 'text',
            placeholder: 'isekai2nd.com',
            spellcheck: 'false',
            autocomplete: 'off'
        });
        const targetAdd = el('button', { id: 'rb-target-add-btn', type: 'button' }, 'Add target');
        targetAdd.addEventListener('click', () => {
            const err = addTargetSite(targetInput.value);
            if (err) showModalError(err);
            else targetInput.value = '';
        });
        targetInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                targetAdd.click();
            }
        });
        targetForm.appendChild(targetInput);
        targetForm.appendChild(targetAdd);
        targetsSection.appendChild(targetForm);

        const mapsSection = el('section', { className: 'section' });
        mapsSection.appendChild(el('h3', { className: 'label' }, 'Rewrite rules'));
        mapsSection.appendChild(el('p', { className: 'hint' }, 'Optional. When a navigation matches the from-URL, rewrite it onto the to-URL instead of blocking. Leave the to-URL blank to block.'));
        mapListEl = el('div', { id: 'rb-map-list' });
        mapsSection.appendChild(mapListEl);
        const mapForm = el('div', { className: 'form' });
        mapSourceInput = el('input', {
            id: 'rb-map-source-input',
            type: 'text',
            placeholder: 'From URL',
            spellcheck: 'false',
            autocomplete: 'off'
        });
        mapTargetInput = el('input', {
            id: 'rb-map-target-input',
            type: 'text',
            placeholder: 'To URL (optional)',
            spellcheck: 'false',
            autocomplete: 'off'
        });
        const mapAdd = el('button', { id: 'rb-map-add-btn', type: 'button' }, 'Add mapping');
        mapAdd.addEventListener('click', () => {
            const err = addUrlMap(mapSourceInput.value, mapTargetInput.value);
            if (err) showModalError(err);
            else {
                mapSourceInput.value = '';
                mapTargetInput.value = '';
            }
        });
        mapSourceInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                mapAdd.click();
            }
        });
        mapTargetInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                mapAdd.click();
            }
        });
        mapForm.appendChild(mapSourceInput);
        mapForm.appendChild(mapTargetInput);
        mapForm.appendChild(mapAdd);
        mapsSection.appendChild(mapForm);

        modalError = el('div', { className: 'error', id: 'rb-modal-error' });

        dialog.appendChild(head);
        dialog.appendChild(modalStatus);
        dialog.appendChild(sitesSection);
        dialog.appendChild(targetsSection);
        dialog.appendChild(mapsSection);
        dialog.appendChild(modalError);
        overlay.appendChild(dialog);
        root.appendChild(style);
        root.appendChild(overlay);

        host.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Escape') hideModal();
        });
        return host;
    }

    function showModalError(message) {
        if (modalError) modalError.textContent = message || '';
    }

    function refreshModalStatus() {
        if (!modalStatus) return;
        const host = siteKey();
        if (isSiteEnabled()) {
            modalStatus.textContent = sessionBlocked + ' blocked this session (' + totalBlocked + ' total)';
        } else if (!isCurrentListed()) {
            modalStatus.textContent = 'Not protecting ' + host + ' — add this site to enable';
        } else {
            modalStatus.textContent = 'Disabled on ' + host;
        }
    }

    function sitesForList() {
        const current = siteKey();
        const rows = sourceSites.map((site) => ({
            host: site.host,
            enabled: site.enabled !== false,
            pending: false
        }));
        if (current && !rows.some((site) => hostMatches(current, site.host))) {
            rows.unshift({ host: current, enabled: false, pending: true });
        } else {
            rows.sort((a, b) => {
                const ac = hostMatches(current, a.host) ? 0 : 1;
                const bc = hostMatches(current, b.host) ? 0 : 1;
                return ac - bc;
            });
        }
        return rows;
    }

    function refreshSiteList() {
        if (!siteListEl) return;
        while (siteListEl.firstChild) siteListEl.removeChild(siteListEl.firstChild);
        const current = siteKey();
        const listed = isCurrentListed();
        if (addCurrentBar) {
            if (listed) addCurrentBar.classList.remove('show');
            else addCurrentBar.classList.add('show');
            const hostLabel = addCurrentBar.querySelector('#rb-add-current-host');
            if (hostLabel) hostLabel.textContent = current;
        }
        sitesForList().forEach((site) => {
            const row = el('div', { className: 'row' });
            row.setAttribute('data-rb-host', site.host);
            if (site.pending) row.setAttribute('data-rb-pending', '1');
            const toggle = el('input', {
                type: 'checkbox',
                className: 'toggle'
            });
            toggle.checked = !site.pending && site.enabled !== false;
            toggle.setAttribute('aria-label', (toggle.checked ? 'Disable ' : 'Enable ') + site.host);
            if (hostMatches(current, site.host)) toggle.id = 'rb-modal-toggle';
            toggle.addEventListener('change', () => {
                if (site.pending && !toggle.checked) return;
                setHostEnabled(site.host, toggle.checked);
            });
            const name = el('div', { className: 'name' }, site.host);
            if (hostMatches(current, site.host)) {
                name.appendChild(el('span', { className: 'this' }, 'this site'));
            }
            const action = el('button', {
                className: site.pending ? 'remove add' : 'remove',
                type: 'button'
            }, site.pending ? 'Add' : 'Remove');
            if (site.pending) {
                action.addEventListener('click', () => {
                    const err = addSourceSite(site.host);
                    if (err) showModalError(err);
                });
            } else {
                action.addEventListener('click', () => removeSourceSite(site.host));
            }
            row.appendChild(toggle);
            row.appendChild(name);
            row.appendChild(action);
            siteListEl.appendChild(row);
        });
    }

    function refreshTargetList() {
        if (!targetListEl) return;
        while (targetListEl.firstChild) targetListEl.removeChild(targetListEl.firstChild);
        if (!targetSites.length) {
            targetListEl.appendChild(el('div', { className: 'empty' }, 'No target sites yet. Add a host to block redirects to it.'));
            return;
        }
        targetSites.forEach((site) => {
            const row = el('div', { className: 'row' });
            row.setAttribute('data-rb-target', site.host);
            const toggle = el('input', {
                type: 'checkbox',
                className: 'toggle',
                'aria-label': (site.enabled !== false ? 'Disable ' : 'Enable ') + site.host
            });
            toggle.checked = site.enabled !== false;
            toggle.addEventListener('change', () => setTargetEnabled(site.host, toggle.checked));
            const name = el('div', { className: 'name' }, site.host);
            const remove = el('button', { className: 'remove', type: 'button' }, 'Remove');
            remove.addEventListener('click', () => removeTargetSite(site.host));
            row.appendChild(toggle);
            row.appendChild(name);
            row.appendChild(remove);
            targetListEl.appendChild(row);
        });
    }

    function refreshMapList() {
        if (!mapListEl) return;
        while (mapListEl.firstChild) mapListEl.removeChild(mapListEl.firstChild);
        if (!urlMaps.length) {
            mapListEl.appendChild(el('div', { className: 'empty' }, 'No rewrite rules yet. Listed target sites and other off-site navigations are still blocked.'));
            return;
        }
        urlMaps.forEach((map, index) => {
            const row = el('div', { className: 'row' });
            row.setAttribute('data-rb-map-index', String(index));
            const toggle = el('input', {
                type: 'checkbox',
                className: 'toggle',
                'aria-label': 'Enable mapping ' + map.source
            });
            toggle.checked = map.enabled !== false;
            toggle.addEventListener('change', () => setMapEnabled(index, toggle.checked));
            const source = el('div', { className: 'name' }, map.source);
            const arrow = el('div', { className: 'arrow' }, '→');
            const target = el('div', { className: 'name' }, map.target || 'block');
            const remove = el('button', { className: 'remove', type: 'button' }, 'Remove');
            remove.addEventListener('click', () => removeUrlMap(index));
            row.appendChild(toggle);
            row.appendChild(source);
            row.appendChild(arrow);
            row.appendChild(target);
            row.appendChild(remove);
            mapListEl.appendChild(row);
        });
    }

    function refreshModal() {
        showModalError('');
        refreshModalStatus();
        refreshSiteList();
        refreshTargetList();
        refreshMapList();
    }

    function hideModal() {
        modalOpen = false;
        if (modalEl) {
            modalEl.style.setProperty('display', 'none', 'important');
            modalEl.setAttribute('aria-hidden', 'true');
        }
    }

    function showModal() {
        if (!modalEl || !badgeEl || dragging) return;
        refreshModal();
        modalEl.style.setProperty('display', 'block', 'important');
        modalEl.setAttribute('aria-hidden', 'false');
        modalOpen = true;
        if (siteInput && typeof siteInput.focus === 'function') {
            try { siteInput.focus(); } catch (e) { /* ignore */ }
        }
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
            if (modalEl) nativeAppend(parent, modalEl);
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
            modalEl = createModalElement();
            syncBadgeVisual();
            enableBadgeUi();
            D.addEventListener('fullscreenchange', mountBadge);
            const keep = new MutationObserver(() => {
                if ((badgeEl && !badgeEl.isConnected) || (modalEl && !modalEl.isConnected)) {
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

    function bootBadge() {
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
