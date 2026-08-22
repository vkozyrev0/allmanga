# allmanga

A userscript that blocks unwanted redirects on manga sites. It ships with **allmanga.to**, **mkissa.to**, and **mkissa.net** already listed; the badge appears on **every** site so you can add the current host (or any other URL) from the settings modal.

Some links, scripts, and pop-ups on these sites try to send you to a different domain (for example `youtu-chan.com`, or a next-chapter click that opens `isekai2nd.com`). This script keeps you on the site you opened.

## What it does

`redirect-blocking-extension.js` runs on every `http(s)` page (at `document-start`, in the page world, not inside iframes). Blocking is on only when the current host is an enabled source site. It:

- **Blocks any off-site navigation** — not just a hardcoded ad domain. A next-page click, `location.href` / `location.assign` / `location.replace`, the Chromium Navigation API, `history.pushState` / `replaceState`, form submits, and meta-refresh are all checked.
- **Rewrites manga-shaped URLs** — if the hijack copied a `/manga/...` (or `/anime/...`) path onto another host, that path is rewritten back onto the current host so the chapter still loads.
- **Stays put for article/ad URLs** — a destination like `isekai2nd.com/20-recommended-science-fiction-anime-...` is cancelled; you remain on the chapter instead of landing on a 404 of that slug on mkissa.
- **Removes injected scripts** — a `MutationObserver` watches for `<script>` tags pointing at known ad hosts (`youtu-chan.com`, `isekai2nd.com`) and removes them before they run.
- **Blocks pop-ups** — overrides `window.open` to cancel any pop-up aimed off-site, while letting same-site and sister-site (`allmanga.to` / `mkissa.to` / `mkissa.net`) opens through. A `target=_blank` social link (Discord, etc.) is left alone.
- **Shows a status badge** — a small disc in the top-right corner so you can see that the script is running and whether it is on for this host. Click it for a settings modal.

Known ad-script hosts live in the `blockedDomains` array (used to strip injected scripts). Off-site **navigation** is blocked even when the host is not on that list, so a new affiliate domain does not require a script update. You can also add **source → target** rewrite rules from the badge modal.

## Using the badge

| State | Looks like |
|-------|------------|
| Blocking **on** for this site | Orange disc, unbroken chain |
| Blocking **off**, or site not in the list | Gray disc, broken chain with a slash |
| Blocks this session | Small dark count on the disc (hidden while the count is 0) |

- **Left-click** the disc to open the settings modal. Hover does not open it.
- **Source sites** — on a site that is not listed, use **Add this site** (or check the current-host row). You can also paste any other hostname/URL. Uncheck a listed site to pause it; remove it to drop it from the family list. Settings are stored per origin (`localStorage`), so add the current host on each new site you want protected.
- **Source → target URLs** — when a navigation matches the source host (or URL), rewrite it onto the target. Leave the target blank to block instead.
- **Drag** the disc to move it. The spot is saved as an offset from the nearest viewport corner, so it stays put when the window is resized.
- Right-click is not used. Escape, the close button, a click on the dimmed backdrop, or a second click on the disc closes the modal.

## Installation (AdGuard)

1. Install the userscript from  
   https://raw.githubusercontent.com/vkozyrev0/allmanga/refs/heads/main/redirect-blocking-extension.js  
   Tampermonkey / Windows can also use  
   https://raw.githubusercontent.com/vkozyrev0/allmanga/refs/heads/main/redirect-blocking-extension.user.js
2. After an update, reload the page with **Ctrl+Shift+R** (cache-bypass). **Ctrl+F5** often keeps a cached document, so the badge does not appear.

Optional network-level blocks for the same ad hosts live in [`adguard-user-rules.txt`](adguard-user-rules.txt). The userscript is the main install path.

## Configuration

Off-site navigations are blocked automatically. To also strip injected scripts from a new ad host, add it to the array near the top of the script:

```js
const blockedDomains = ['youtu-chan.com', 'isekai2nd.com', 'another-domain.com'];
```

Matching is substring-based against the URL hostname, so `youtu-chan.com` also matches subdomains like `ads.youtu-chan.com`.

Preferences are stored in the site’s `localStorage`:

| Key | Meaning |
|-----|---------|
| `rb-disabled-hosts` | JSON list of hostnames where blocking is paused |
| `rb-source-sites` | JSON list of `{ host, enabled }` source/sister sites |
| `rb-url-maps` | JSON list of `{ source, target, enabled }` rewrite rules |
| `rb-icon-pos` | Badge position `{ corner, dx, dy }` |
| `rb-blocked-total` | Lifetime blocked-redirect count |

## Debugging

The script logs each action (rewritten URL, removed script, blocked pop-up) to the browser console. Open DevTools (F12) → **Console** to see what it's catching.

## Documentation

- [Findings and method](docs/findings-and-method.md) — how the hijacks work and why this approach
- [Future improvements](docs/future-improvements.md) — follow-up ideas, not a commitment

## Development

The script has no build step. There is a test suite that loads the unmodified script into simulated `allmanga.to` and `mkissa.to` pages (via [jsdom](https://github.com/jsdom/jsdom)) and asserts its behavior using Node's built-in test runner.

```bash
npm install   # one-time: installs jsdom (dev dependency)
npm test      # run the behavioral test suite
npm run check # syntax-check the script with `node --check`
npm run sync  # rewrite redirect-blocking-extension.user.js from the .js file
```

The tests in [`test/`](test/) cover link rewriting, pop-up blocking, injected-script removal, the `history` wrappers, the mkissa next-page hijack to `isekai2nd.com`, the status badge (position, drag, click-to-open settings modal, source-site and URL-map management, per-site enable/disable, glyph states), and regressions for falsy and unparseable URLs. Requires Node 18+ (developed on Node 26).

## Metadata

| Field | Value |
|-------|-------|
| Version | 1.23 |
| Match | all `http://` and `https://` pages (`@noframes`) |
| Run at | `document-start` |
| Inject | page (`@inject-into page`, `@grant unsafeWindow`) |
