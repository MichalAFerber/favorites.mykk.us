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

## Gotchas

- External hosts (icons.duckduckgo.com) stall ~10 s then `ERR_CONNECTION_RESET`
  in this sandbox, so favicon fallback avatars take ~10–15 s to appear. Not a bug;
  wait with `waitForSelector('.avatar', {timeout: 30000})` if testing the fallback.
- Tile clicks navigate to `chrome-error://` (no external network) — assert that
  navigation was *attempted*, not that it succeeded.

## Flows worth driving

add → tiles render; bare-domain URL normalization; HTML-in-name stays inert;
long-press → edit dialog; two-tap delete (first tap arms, second deletes);
settings theme/bgColor; configure sync on device A → push; fresh device B
configure sync → pulls (must NOT clobber remote with its empty doc); bad token
→ "Pull failed" status + page still usable locally; wallpaper URL with `"` and
`)` stays inside one escaped `url("…")`; two different users' tokens read and
write different `state:<userId>` docs (no cross-user bleed); custom `iconUrl`
on a shortcut is used as the img src instead of DuckDuckGo.
