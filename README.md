# allmanga

A [Tampermonkey](https://www.tampermonkey.net/) userscript that blocks unwanted redirects on **allmanga.to**.

Some links, scripts, and pop-ups on the site try to send you to a different domain. This script keeps you on `allmanga.to` by intercepting those redirects and rewriting them back to the original site.

## What it does

`redirect-blocking-extension.js` runs on every `allmanga.to` page and:

- **Rewrites links** — intercepts clicks on `<a>`, `<button>`, and `[onclick]` elements; if a link points at a blocked domain, it rewrites the URL back to `allmanga.to` (preserving path, query, and hash).
- **Removes injected scripts** — a `MutationObserver` watches for `<script>` tags pointing at a blocked domain and removes them before they run.
- **Guards SPA navigation** — wraps `history.pushState` and `history.replaceState` so client-side route changes can't redirect off-site.
- **Blocks pop-ups** — overrides `window.open` to cancel any pop-up aimed at a blocked domain, while letting legitimate same-site opens through.

Blocked domains are listed in the `blockedDomains` array at the top of the script (currently `youtu-chan.com`).

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension (Chrome, Firefox, Edge, Safari).
2. Open the Tampermonkey dashboard → **Create a new script**.
3. Replace the contents with [`redirect-blocking-extension.js`](redirect-blocking-extension.js) and save (Ctrl+S).
4. Visit `allmanga.to` — the script is active automatically.

## Configuration

To block additional domains, add them to the array near the top of the script:

```js
const blockedDomains = ['youtu-chan.com', 'another-domain.com'];
```

Matching is substring-based against the URL hostname, so `youtu-chan.com` also matches subdomains like `ads.youtu-chan.com`.

## Debugging

The script logs each action (rewritten URL, removed script, blocked pop-up) to the browser console. Open DevTools (F12) → **Console** to see what it's catching.

## Development

The script has no build step — it's loaded directly into Tampermonkey. There is a test suite that loads the unmodified script into a simulated `allmanga.to` page (via [jsdom](https://github.com/jsdom/jsdom)) and asserts its behavior using Node's built-in test runner.

```bash
npm install   # one-time: installs jsdom (dev dependency)
npm test      # run the behavioral test suite
npm run check # syntax-check the script with `node --check`
```

The tests in [`test/`](test/) cover link rewriting, pop-up blocking, injected-script removal, and the `history` wrappers — including regression tests for falsy and unparseable URLs. Requires Node 18+ (developed on Node 26).

## Metadata

| Field | Value |
|-------|-------|
| Version | 1.6 |
| Match | `*://allmanga.to/*` |
| Grants | none |
