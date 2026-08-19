# allmanga

A userscript that blocks unwanted redirects on **allmanga.to** and **mkissa.to**.

Some links, scripts, and pop-ups on these sites try to send you to a different domain. This script keeps you on the site you opened by intercepting those redirects and rewriting them back to the original host.

## What it does

`redirect-blocking-extension.js` runs on every `allmanga.to` and `mkissa.to` page and:

- **Rewrites links** — intercepts clicks on `<a>`, `<button>`, and `[onclick]` elements; if a link points at a blocked domain, it rewrites the URL back to the current host (preserving path, query, and hash).
- **Removes injected scripts** — a `MutationObserver` watches for `<script>` tags pointing at a blocked domain and removes them before they run.
- **Guards SPA navigation** — wraps `history.pushState` and `history.replaceState` so client-side route changes can't redirect off-site.
- **Blocks pop-ups** — overrides `window.open` to cancel any pop-up aimed at a blocked domain, while letting legitimate same-site opens through.
- **Shows a status badge** — injects a small broken-link icon (orange disc) in the top-right corner so you can see at a glance that the script is active. Hover for a tooltip showing how many redirects it has blocked — this session and cumulatively. **Drag the badge** to reposition it; its spot is remembered (saved in `localStorage` as an offset from the nearest viewport corner, so it stays put relative to that corner when the window is resized) and restored on the next visit.

Blocked domains are listed in the `blockedDomains` array at the top of the script (currently `youtu-chan.com`).

## Installation (AdGuard)

1. Install the userscript in AdGuard from  
   https://raw.githubusercontent.com/vkozyrev0/allmanga/main/redirect-blocking-extension.js
2. After an update, reload the page with **Ctrl+Shift+R** (cache-bypass). **Ctrl+F5** often keeps a cached document, so the badge does not appear.

## Configuration

To block additional domains, add them to the array near the top of the script:

```js
const blockedDomains = ['youtu-chan.com', 'another-domain.com'];
```

Matching is substring-based against the URL hostname, so `youtu-chan.com` also matches subdomains like `ads.youtu-chan.com`.

## Debugging

The script logs each action (rewritten URL, removed script, blocked pop-up) to the browser console. Open DevTools (F12) → **Console** to see what it's catching.

## Development

The script has no build step. There is a test suite that loads the unmodified script into simulated `allmanga.to` and `mkissa.to` pages (via [jsdom](https://github.com/jsdom/jsdom)) and asserts its behavior using Node's built-in test runner.

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
