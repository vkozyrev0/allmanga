# Findings and method

How next-page ads on allmanga / mkissa actually navigate away, and why the userscript is built the way it is. Current script version: **1.23**.

## The problem

On **allmanga.to**, **mkissa.to**, and **mkissa.net**, a “next chapter” click (and some other navigations) often does not go to the next chapter. It sends the tab to an unrelated host — typically `isekai2nd.com` (article/ad landing pages) or `youtu-chan.com` (script/ad host). Sometimes the hijack copies a real `/manga/...` path onto that other host. Sometimes it is a completely different article URL.

A filter-list block of those two domains is not enough:

- The click still *tries* to leave. If the destination is a new affiliate host, a static list misses it.
- Some hijacks never create an `<a href>` you can rewrite. They assign `location.href`, call `location.assign` / `replace`, or fire the Chromium **Navigation API**.
- Injected `<script src="https://youtu-chan.com/...">` tags can still run if they land in the DOM before a network rule applies.

The goal is: stay on the site you opened, still reach the next chapter when the path is real, and leave intentional new-tab social links alone.

## How the hijacks work

Observed and inferred from the live readers (mkissa’s chapter reader is a SvelteKit app that replaces `<body>` on hydrate and can go fullscreen):

| Mechanism | What it does | Why a simple click rewrite fails |
|-----------|--------------|----------------------------------|
| `<a href>` to an ad host | Next/prev chrome or an overlay points off-site | Easy if you see the click; some handlers call `preventDefault` and then set `location` themselves |
| Manga path copied onto an ad host | e.g. `youtu-chan.com/manga/<id>/chapter-326` | Blocking the host 404s; the path is still this site’s chapter |
| Article/ad URL | e.g. `isekai2nd.com/20-recommended-...` | Rewriting that slug onto mkissa also 404s; the correct action is **stay** |
| `location.href` / `assign` / `replace` | Same-tab navigation with no `<a>` | Must wrap `Location` and listen to `navigation` |
| `history.pushState` / `replaceState` | SPA-style URL swap | Must wrap `history` |
| `window.open` | Pop-up / new tab to ads | Must wrap `open` |
| `target=_blank` social link | Discord etc. | Must **not** cancel; that is user intent |
| Form `action` / `<meta http-equiv=refresh>` | Less common, same outcome | Same `decide()` policy |
| Injected `<script>` | Ad/redirect script from a known host | Navigation hooks do not stop the script; the node must be removed |

A hardcoded domain list is the right tool for **script removal**. It is the wrong tool for **navigation**. Any new affiliate host should still be blocked.

## Method

One userscript, injected at `document-start` into the **page** world (`@inject-into page` + `unsafeWindow`). All decisions go through one function.

### 1. Classify every destination (`decide`)

For a URL:

1. If blocking is paused on this host → **allow**.
2. Empty / unparseable → **allow** (do not break `mailto:`, `javascript:`, `about:blank`).
3. Hostname is this site or a sister site (`allmanga.to`, `mkissa.to`, `mkissa.net`, including `www` and subdomains) → **allow**.
4. Path looks like this site (`/manga/`, `/anime/`, `/watch/`, `/read/`, `/chapter/`, or the first two path segments match the current page) → **rewrite** onto `https://<current-host><path><search><hash>`.
5. Otherwise → **block** (cancel; stay on the current page).

That split is load-bearing. Rewriting `isekai2nd.com/20-recommended-...` onto mkissa produces a 404. Blocking `youtu-chan.com/manga/.../chapter-326` drops a real chapter. Tests lock both cases in.

### 2. Hook every navigation path

Same `decide()` result, different plumbing:

- Capture-phase `click` / `auxclick` on `a[href]` / `area[href]`. Same-tab off-site is cancelled (and rewritten if needed). New-tab (`ctrl`/`meta`/`shift`, middle click, `target=_blank`) is left alone when the action is **block**.
- `submit` on forms.
- `history.pushState` / `replaceState`.
- `window.open`.
- `Location.prototype.assign` / `replace` / `href` setter, and the same on the instance when the prototype is frozen.
- Chromium `navigation` `"navigate"` event — this is what actually stops mkissa next-page ads that assign `location.href` after the prototype is locked.
- `MutationObserver` on the document: strip `<script src>` whose host is in `blockedDomains`; remove meta-refresh to an off-site URL; rewrite manga-shaped `href`s in the DOM (article/ad `href`s stay so a `_blank` social link still works).

### 3. Run in the page world, early

AdGuard / Tampermonkey may sandbox the script. Hooks on the sandbox `window` do not see the site’s `location` / `history` / `open`. `@inject-into page` plus `unsafeWindow` makes the wrappers the ones the reader actually calls.

`document-start` matters for the Navigation API listener and for seeing scripts as they are inserted. A late inject misses the first hijack on that load.

### 4. Persist a visible, reversible control

The badge is how you know the script is alive and how you pause it on the current host.

- **On:** orange disc, unbroken chain.
- **Off:** gray disc, broken chain with a slash (the old “tiny ticks” glyph looked the same at 22px; only the color changed).
- The script matches every `http(s)` page (`@noframes`). The badge is shown even when the current host is not a source site; blocking stays off until that host is added and enabled.
- Left-click opens a settings modal (source sites + source/target URL mappings). Hover does not. Right-click is not used: the browser context menu always stacked on top of a custom menu, even when we `preventDefault`.
- Drag remembers an offset from the nearest viewport corner (`rb-icon-pos`), so a resize does not dump the disc in the middle of the reader chrome.
- Per-host pause lives in `rb-disabled-hosts` (kept in sync with `rb-source-sites`). Rewrite rules live in `rb-url-maps`. A lifetime counter lives in `rb-blocked-total`.

The badge is appended to `<html>` (not `<body>`), re-homed into `document.fullscreenElement` on `fullscreenchange`, and re-attached by a `MutationObserver` if the SPA deletes it. SvelteKit hydrate on mkissa chapter pages replaces `body`; a body-mounted node vanishes. A `popover` attribute is never used: UA CSS is `display:none !important` until `showPopover()`, and AdGuard’s page world often has no Popover API. The icon is built with DOM APIs (no `innerHTML`) so Trusted Types / CSP cannot strip it. After a script update, **Ctrl+Shift+R** is required; Ctrl+F5 often keeps a cached document and the badge never appears.

### 5. Optional network rules

[`adguard-user-rules.txt`](../adguard-user-rules.txt) can still block `youtu-chan.com` and `isekai2nd.com` at the network layer. That does not replace the userscript. It only reduces how far those two hosts get if the script is late or disabled.

## What we tried that did not hold

| Approach | Why it fell short |
|----------|-------------------|
| Filter list only | New affiliate hosts, `location.href` hijacks, and in-page scripts still fire |
| Hardcoded navigation blocklist | Same problem as the filter list; `decide()` by “is this host us?” is the durable rule |
| Rewrite every off-site path onto this host | Article slugs 404 on mkissa |
| Block every off-site path | Real `/manga/...` copies never load the next chapter |
| Chrome extension | Extra install path, same logic; dropped so AdGuard userscript is the only artifact |
| `popover` badge | Invisible without `showPopover()` |
| Mounting on `<body>` | mkissa hydrate / fullscreen removes it |
| Orange top bar as a “script is alive” signal | Visible but noisy; removed once the disc was reliable |
| White ring around the disc | Looked like a frame; dropped |
| Right-click menu | Custom menu opened, then the browser menu covered it immediately |
| Hide-icon menu item | No way to get the disc back without the console |
| Broken-link glyph for “blocking on” | At 22px it was indistinguishable from “off” except by color |

## How to verify

On a mkissa chapter page, with the disc orange:

1. Next-chapter control that would have gone to `isekai2nd.com` stays on the chapter. Console: `Blocked …`.
2. A same-site next-chapter URL still navigates.
3. A `target=_blank` Discord link still opens.
4. Click the disc → uncheck **mkissa.to**. Disc turns gray with a slash. The same hijack now leaves the tab.
5. Enable again. Disc returns to orange + unbroken chain.

Automated coverage is in [`test/redirect-blocking-extension.test.js`](../test/redirect-blocking-extension.test.js) (`npm test`). It loads the unmodified script into jsdom on both hosts.
