# Future improvements

Ideas only. None of these are scheduled. The script works for the hijacks we have seen; treat this as a backlog if a new one appears or the badge gets in the way.

## Protection

- **Learn new script hosts from blocks.** `blockedDomains` is only for stripping `<script src>`. Navigation already blocks unknown hosts, but the script tag still runs until the host is added by hand. Logging the hostname of every **block** and offering “also strip scripts from this host” would close that gap.
- **Skip hooks when the host is disabled.** Today `decide()` returns `allow` and the wrappers still sit on `location` / `history` / `open`. Uninstalling the wrappers (and reinstalling on enable) would be a purer off switch and a bit cheaper.
- **Hash / in-page readers.** If a site starts using `#/chapter/N` or a custom event instead of a URL change, current hooks will miss it. Watch for that before adding a generic “freeze location for N ms after click” hammer.
- **Service worker / fetch navigation.** Not seen yet. If next-page becomes a `fetch` + client-side swap to an ad view, we would need a different intercept.
- **Keep `adguard-user-rules.txt` in lockstep.** It still says version 1.15 and only lists two hosts. Either generate it from `blockedDomains` or drop it if nobody uses the file.

## Badge and controls

- **Count on the disc.** A small “3” on the orange disc would show activity without opening the menu. Easy to make noisy; keep it optional.
- **Keyboard toggle.** e.g. a chord that does not collide with the reader’s next/prev keys. Useful if the disc is under a fullscreen overlay we failed to reparent.
- **Userscript-manager menu.** `GM_registerMenuCommand` (“Enable on this site”, “Reset position”) needs a grant and may fight `@inject-into page`. Worth a careful spike, not a drive-by.
- **Shadow DOM for the disc itself.** The menu already uses an open shadow so page CSS cannot hide it. The disc is still a light-DOM `div` + SVG. A closed/open shadow would survive more aggressive reader styles.
- **Fewer remounts.** The 20×500ms poll after load is a blunt fix for SPA hydrate. A single observer plus `fullscreenchange` might be enough now; measure on mkissa before deleting the poll.
- **Do not steal hover on the reader.** The menu appears on hover. If that bothers people who park the cursor in the top-right, add a “click only” preference.

## Install and maintenance

- **One public URL.** `.js` and `.user.js` differ only in `@downloadURL` / `@updateURL`. Generate one from the other in CI so they cannot drift.
- **Trim `@match` / `@include` duplicates.** The header accumulated overlapping patterns while debugging AdGuard. A short, complete set would be easier to reason about.
- **Do not bring back a Chrome extension** unless AdGuard injection fails on a browser someone actually uses. Two artifacts was the worse product.
- **Document Ctrl+Shift+R in the userscript `@description`.** People will keep using Ctrl+F5 and report a missing badge.

## Tests

- **Real Navigation API in CI.** jsdom has no `navigation`; tests stub it. A small Playwright smoke against a static fixture (or a recorded mkissa HTML) would catch “hooks never attach” regressions the unit suite cannot.
- **Fullscreen + hydrate sequence.** The remount logic is only partly covered. A test that replaces `documentElement` children *and* sets `fullscreenElement` in one tick would lock the mkissa reader case.
- **Glyph snapshots.** Path counts and `data-rb-glyph` are enough for now. If the icons are tweaked again, a 24×24 fixture compare would stop “looks the same at 22px” from coming back.

## Scope

- **More sister hosts** only when someone reads there and sees the same hijack. Do not pre-emptively match the whole web.
- **No general-purpose ad blocker.** This script’s job is “do not leave this manga site.” Filter lists already exist for the rest.
