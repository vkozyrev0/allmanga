# allmanga

A userscript that blocks unwanted redirects on **allmanga.to** and **mkissa.to**.

Some links, scripts, and pop-ups on these sites try to send you to a different domain (for example `youtu-chan.com`, or a next-chapter click that opens `isekai2nd.com`). This script keeps you on the site you opened.

## What it does

`redirect-blocking-extension.js` runs on every `allmanga.to` and `mkissa.to` page (at `document-start`) and:

- **Blocks any off-site navigation** — not just a hardcoded ad domain. A next-page click, `location.href` / `location.assign` / `location.replace`, the Chromium Navigation API, `history.pushState` / `replaceState`, form submits, and meta-refresh are all checked.
- **Rewrites manga-shaped URLs** — if the hijack copied a `/manga/...` (or `/anime/...`) path onto another host, that path is rewritten back onto the current host so the chapter still loads.
- **Stays put for article/ad URLs** — a destination like `isekai2nd.com/20-recommended-science-fiction-anime-...` is cancelled; you remain on the chapter instead of landing on a 404 of that slug on mkissa.
- **Removes injected scripts** — a `MutationObserver` watches for `<script>` tags pointing at known ad hosts (`youtu-chan.com`, `isekai2nd.com`) and removes them before they run.
- **Blocks pop-ups** — overrides `window.open` to cancel any pop-up aimed off-site, while letting same-site and sister-site (`allmanga.to` / `mkissa.to` / `mkissa.net`) opens through.
- **Shows a status badge** — injects a small icon in the top-right corner so you can see at a glance that the script is active. **Orange disc + unbroken chain** means blocking is on for this site; **gray disc + broken/slashed chain** means it is off. **Hover or left-click** the icon for a menu: block counts, plus **Disable on this site** / **Enable on this site**. The per-site choice is remembered (so you can turn it off on `mkissa.to` and leave it on for `allmanga.to`). **Drag the badge** to reposition it; its spot is remembered (saved in `localStorage` as an offset from the nearest viewport corner, so it stays put relative to that corner when the window is resized) and restored on the next visit.

Known ad-script hosts live in the `blockedDomains` array (used to strip injected scripts). Off-site **navigation** is blocked even when the host is not on that list, so a new affiliate domain does not require a script update.

## Installation (AdGuard)

1. Install the userscript in AdGuard from  
   https://raw.githubusercontent.com/vkozyrev0/allmanga/main/redirect-blocking-extension.js
2. After an update, reload the page with **Ctrl+Shift+R** (cache-bypass). **Ctrl+F5** often keeps a cached document, so the badge does not appear.

## Configuration

Off-site navigations are blocked automatically. To also strip injected scripts from a new ad host, add it to the array near the top of the script:

```js
const blockedDomains = ['youtu-chan.com', 'isekai2nd.com', 'another-domain.com'];
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

The tests in [`test/`](test/) cover link rewriting, pop-up blocking, injected-script removal, the `history` wrappers, and the mkissa next-page hijack to `isekai2nd.com` on both hosts — including regression tests for falsy and unparseable URLs. Requires Node 18+ (developed on Node 26).

## Metadata

| Field | Value |
|-------|-------|
| Version | 1.19 |
| Match | `*://allmanga.to/*`, `*://mkissa.to/*` |
| Grants | none |
