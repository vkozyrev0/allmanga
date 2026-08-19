# allmanga

A [Tampermonkey](https://www.tampermonkey.net/) userscript that blocks unwanted redirects on **allmanga.to** and **mkissa.to**.

Some links, scripts, and pop-ups on these sites try to send you to a different domain. This script keeps you on the site you opened by intercepting those redirects and rewriting them back to the original host.

## What it does

`redirect-blocking-extension.js` runs on every `allmanga.to` and `mkissa.to` page and:

- **Rewrites links** — intercepts clicks on `<a>`, `<button>`, and `[onclick]` elements; if a link points at a blocked domain, it rewrites the URL back to the current host (preserving path, query, and hash).
- **Removes injected scripts** — a `MutationObserver` watches for `<script>` tags pointing at a blocked domain and removes them before they run.
- **Guards SPA navigation** — wraps `history.pushState` and `history.replaceState` so client-side route changes can't redirect off-site.
- **Blocks pop-ups** — overrides `window.open` to cancel any pop-up aimed at a blocked domain, while letting legitimate same-site opens through.
- **Shows a status badge** — injects a small broken-link icon (orange disc) in the top-right corner so you can see at a glance that the script is active. Hover for a tooltip showing how many redirects it has blocked — this session and cumulatively. **Drag the badge** to reposition it; its spot is remembered (saved in `localStorage` as an offset from the nearest viewport corner, so it stays put relative to that corner when the window is resized) and restored on the next visit.

Blocked domains are listed in the `blockedDomains` array at the top of the script (currently `youtu-chan.com`).

## Installation

### Chrome / Edge extension (Windows — no Tampermonkey)

mkissa.to is on Cloudflare and prefers **HTTP/3 (QUIC)**. Chrome will not let AdGuard decrypt HTTP/3, so AdGuard userscripts and user rules never run on that tab. A real browser extension injects into the page directly, so QUIC does not matter.

1. Clone or download this repo (`git pull` if it is already cloned).
2. Open `chrome://extensions` or `edge://extensions`.
3. Turn on **Developer mode**.
4. **Load unpacked** → select the [`chrome-extension`](chrome-extension/) folder. After a pull, click **Reload** on the card.
5. On the mkissa tab: puzzle-piece menu → this extension → **This can read and change site data** → **On mkissa.to** (or On all sites). “On click” will not inject on reload.
6. Click the extension icon once on the chapter page, then hard-reload.

You should see an **8px orange bar across the top** and a **36px “RB” disc** in the top-right. Drag the disc to move it; the spot is stored as an offset from the nearest viewport corner so it returns there on the next visit and on resize. Those come from an isolated-world script (page CSP cannot block it). The previous build used `world: MAIN`, which Cloudflare’s CSP can silently kill.

The extension also blocks `youtu-chan.com` at the network layer.

### Why AdGuard on Windows did nothing

AdGuard’s own docs: *“Chrome-based browsers do not accept user certificates, so HTTP/3 filtering is not supported in them.”* Cosmetic CSS and JS user rules need the same MITM path, so they fail too.

To force AdGuard’s existing userscript to run, disable QUIC then reload:

- Chrome: `chrome://flags/#enable-quic` → **Disabled** → relaunch
- Edge: `edge://flags/#enable-quic` → **Disabled** → relaunch

Then the 1.14 userscript / user rules can inject. The unpacked extension does not need this.

### AdGuard app (Windows / Mac / Android)

AdGuard can list a userscript as installed without injecting it into the page. If you do not see an **orange 6px bar across the top** of mkissa.to, the userscript is not running. Use **User rules** instead (this path is always trusted):

1. Open [`adguard-user-rules.txt`](adguard-user-rules.txt) and copy both rules.
2. AdGuard → **Settings → Filtering → User rules** (Windows/Mac: **Settings → User rules**).
3. Paste, save, reload mkissa.to.

You should see the orange top bar and a disc in the top-right. If those still do not appear, AdGuard is not injecting JavaScript into that browser (HTTPS filtering off, HTTP/3/QUIC bypass, or the AdGuard *browser extension* rather than the app). Use Tampermonkey in that case.

## Configuration

To block additional domains, add them to the array near the top of the script:

```js
const blockedDomains = ['youtu-chan.com', 'another-domain.com'];
```

Matching is substring-based against the URL hostname, so `youtu-chan.com` also matches subdomains like `ads.youtu-chan.com`.

## Debugging

The script logs each action (rewritten URL, removed script, blocked pop-up) to the browser console. Open DevTools (F12) → **Console** to see what it's catching.

## Development

The script has no build step — it's loaded directly into Tampermonkey. There is a test suite that loads the unmodified script into simulated `allmanga.to` and `mkissa.to` pages (via [jsdom](https://github.com/jsdom/jsdom)) and asserts its behavior using Node's built-in test runner.

```bash
npm install   # one-time: installs jsdom (dev dependency)
npm test      # run the behavioral test suite
npm run check # syntax-check the script with `node --check`
```

The tests in [`test/`](test/) cover link rewriting, pop-up blocking, injected-script removal, and the `history` wrappers on both hosts — including regression tests for falsy and unparseable URLs. Requires Node 18+ (developed on Node 26).

## Metadata

| Field | Value |
|-------|-------|
| Version | 1.14 |
| Match | `*://allmanga.to/*`, `*://mkissa.to/*` |
| Grants | none |
