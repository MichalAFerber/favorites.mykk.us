---
name: verify
description: Build/launch/drive recipe for verifying favorites.mykk.us changes end-to-end without deploying to Cloudflare.
---

# Verifying favorites changes locally

No build step. The whole app is `favorites/public/index.html` + `favorites/worker.js`.

## Harness

Run the REAL worker behind a tiny Node adapter (assets-first, like Cloudflare):

1. Write a server that serves `favorites/public/` statically and routes
   everything else to `worker.fetch(request, env)` with
   `env = { SHORTCUTS_KV: <Map-backed {get,put,delete}> }`.
   Auth is per-user token mappings in KV — seed them like:
   `kv.set('token:' + sha256hex('test-token-123'), 'alice')` (use node:crypto).
   State lives at `state:<userId>`. Node 22 has Request/Response natively;
   `import worker from '.../worker.js'` works as ESM.
2. Listen on 8787. Restart the server between runs — KV is in-memory.

## Driving

- `npm install playwright-core` in the scratchpad; launch with
  `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`
  (the version-suffixed dir; `/opt/pw-browsers/chromium/` does not exist).
- Fresh browser contexts = separate "devices" (isolated localStorage) — use
  two contexts to exercise sync/LWW.
- Configure sync = fill `#setToken` only; the client always syncs against its
  own origin, which is the harness itself. There is no endpoint field.
- Long-press: `mouse.move` to tile center, `mouse.down()`, wait 650 ms, `mouse.up()`.
- Sync push is debounced 800 ms — wait ≥1.2 s before asserting on remote state.

## Icon proxy (/icon)

worker.js's `/icon?host=` chain fetches jsdelivr (Dashboard Icons) → DuckDuckGo
→ site favicon. The harness mocks those upstreams in `globalThis.fetch` (the
sandbox has no external network) and polyfills `caches.default` + `ctx`. The
mocked PNG must be a REAL decodable image — `<img>` fires onerror on garbage
bytes and the tile falls back to the letter avatar, failing icon assertions.

## Gotchas

- External hosts (icons.duckduckgo.com) stall ~10 s then `ERR_CONNECTION_RESET`
  in this sandbox, so favicon fallback avatars take ~10–15 s to appear. Not a bug;
  wait with `waitForSelector('.avatar', {timeout: 30000})` if testing the fallback.
- Tile clicks navigate to `chrome-error://` (no external network) — assert that
  navigation was *attempted*, not that it succeeded.

## Flows worth driving

add → tiles render A→Z regardless of insertion order (case-insensitive,
numeric-aware; stored array keeps insertion order — sort is display-only);
bare-domain URL normalization; HTML-in-name stays inert;
long-press → edit dialog; two-tap delete (first tap arms, second deletes);
settings theme/bgColor; configure sync on device A → push; fresh device B
configure sync → pulls (must NOT clobber remote with its empty doc); bad token
→ "Pull failed" status + page still usable locally; wallpaper URL with `"` and
`)` stays inside one escaped `url("…")`; two different users' tokens read and
write different `state:<userId>` docs (no cross-user bleed); custom `iconUrl`
on a shortcut is used as the img src instead of DuckDuckGo; `?p=homelab` shows
only that page's shortcuts (page names lowercase-normalized, pageless = main
page), add-dialog prefills the current page, chip nav appears once named pages
exist, and pages survive a sync round-trip; device default page applies to
bare URLs only (explicit `?p=` wins, Home chip = `?p=`), stays out of the
synced doc; sort toggle per page (manual = stored order, drag via long-press
lift then move — drag test: mouse.down, wait 650 ms, mouse.move with steps,
mouse.up; expect reorder committed to the stored array); Settings import
merges bookmarks HTML/JSON deduped on (url, page); export downloads state
JSON (Playwright `download` + `filechooser` events work for both).

Drag gotcha: goto(BASE) is NOT the main page once a test sets a device
default page — use `?p=` to pin the main page explicitly.
