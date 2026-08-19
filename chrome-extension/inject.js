// Isolated-world injector. Page CSP does not apply here, so this still runs
// when world:MAIN is blocked by Cloudflare. DOM is shared with the page.
(function () {
    'use strict';

    var BAR_ID = 'rb-status-bar';
    var ICON_ID = 'rb-status-icon';

    function root() {
        return document.documentElement || document.body;
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
            icon.title = 'Redirect Blocker active';
            parent.appendChild(icon);
        }
        icon.style.cssText = [
            'display:block',
            'position:fixed',
            'top:16px',
            'right:16px',
            'width:36px',
            'height:36px',
            'border-radius:18px',
            'background:#f76707',
            'color:#fff',
            'font:700 12px/36px sans-serif',
            'text-align:center',
            'z-index:2147483647',
            'box-shadow:0 0 0 3px #fff,0 2px 8px rgba(0,0,0,.45)',
            'pointer-events:auto'
        ].join(';');
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
        var n = 0;
        var t = setInterval(function () {
            paint();
            if (++n >= 30) clearInterval(t);
        }, 500);
    }

    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start);
})();
