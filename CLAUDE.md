# CLAUDE.md — favorites.mykk.us

Runbook for Claude Code. Read this before touching anything.

## What this is

Single-user favorites/speed-dial page. One Cloudflare Worker serves a static
single-file HTML app and a tiny authenticated state API backed by Workers KV.
No framework, no build step, no database. Keep it that way.

- **Live URL:** https://favorites.mykk.us
- **Worker name:** `favorites`
- **Cloudflare account:** TechGuyWithABeard (`8a0d49b1f3fdcdadec135562ec8a4fdc`)
  — the CF credentials on this machine can see multiple accounts (GEA LLC,
  ThompsonBlack LLC). **Only ever operate in the TGWAB account.**
- **KV namespace:** `favorites-state` (`71257de3aef04824ad72e7597d0ed8ac`),
  binding `SHORTCUTS_KV`, single key: `state`
- **Custom domain:** provisioned via `custom_domain = true` route in
  wrangler.toml. DNS + cert are managed by the deploy. Do not create DNS
  records manually.

## Repo layout

```
favorites/
├── public/
│   └── index.html    # the entire frontend (HTML+CSS+JS, single file)
├── worker.js         # /api/state handler + auth
└── wrangler.toml     # bindings, assets dir, custom domain route
```

Static assets are served before the Worker is invoked. `worker.js` only ever
sees requests that don't match an asset — in practice, `/api/state`.

## API contract (do not break)

```
GET  /api/state   Authorization: Bearer <SYNC_TOKEN>
  → 200 JSON document or literal `null` if never synced
PUT  /api/state   Authorization: Bearer <SYNC_TOKEN>, body = JSON ≤ 100 KB
  → 200 {"ok":true}
  → 400 bad json | 401 bad/missing token | 413 too large
```

State document shape:

```json
{
  "shortcuts": [{ "id": "sc_...", "name": "GitHub", "url": "https://github.com" }],
  "settings": { "theme": "dark", "wallpaperUrl": "", "bgColor": "" },
  "updatedAt": 1751600000000
}
```

Conflict model is last-write-wins on `updatedAt`, whole document. This is a
deliberate choice for a single user — do not introduce merging, CRDTs, or
per-item versioning.

Sync credentials (endpoint + token) live only in device-local storage on the
client and are intentionally excluded from the synced document. Keep that
separation.

## Deploy

```bash
cd favorites
wrangler deploy
```

First deploy only (or when rotating):

```bash
openssl rand -base64 32        # copy output — it's entered on each device
wrangler secret put SYNC_TOKEN # paste interactively; do NOT pipe (owner needs the value)
wrangler deploy
```

## Verify after deploy

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://favorites.mykk.us/            # 200
curl -s -o /dev/null -w '%{http_code}\n' https://favorites.mykk.us/api/state   # 401
curl -s -H "Authorization: Bearer $TOKEN" https://favorites.mykk.us/api/state  # JSON or null
```

## Ops

```bash
wrangler tail favorites                          # live logs
wrangler kv key get state --namespace-id 71257de3aef04824ad72e7597d0ed8ac   # inspect state
wrangler kv key delete state --namespace-id 71257de3aef04824ad72e7597d0ed8ac # wipe (clients re-seed on next push)
```

Token rotation: `wrangler secret put SYNC_TOKEN` with a new value, redeploy,
re-enter on each device (Settings → Sync). Old token dies immediately.

## Frontend conventions

- Single file. Inline CSS + JS. No bundler, no npm, no CDN dependencies.
- All state mutations go through `persist()` — never call the cache or sync
  layer directly from a handler.
- Favicons come from `icons.duckduckgo.com/ip3/<host>.ico` (privacy choice —
  do not swap to Google's favicon service), with letter-avatar fallback.
- Page must remain fully functional with sync unconfigured (local-only mode).
- Long-press = edit/delete. Pointer Events, 500 ms threshold, 10 px move
  tolerance. Native `confirm()` is banned (breaks in sandboxed iframes);
  destructive actions use two-tap confirm.
- Wallpaper URL is escaped via `cssUrl()` before hitting `background-image`.
  Any new user-supplied string that touches CSS or HTML gets the same
  treatment.

## Guardrails

- **No CORS headers.** Same-origin by design. If a request needs CORS, the
  architecture is wrong — stop and flag it.
- Never commit or echo `SYNC_TOKEN`. It exists only as a Worker secret and in
  the owner's password manager.
- Don't touch zones/DNS outside `favorites.mykk.us`. Never operate in the GEA
  or ThompsonBlack accounts.
- Don't add auth complexity (OAuth, accounts, sessions). Bearer token is the
  design, not a placeholder.
- 100 KB PUT cap stays. If state outgrows it, that's a design conversation
  with the owner, not a limit bump.
- Ask before: deleting the KV namespace, changing the route/domain, or
  rotating the token.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| 401 on every device | Token mismatch — secret was rotated or pasted with whitespace. Re-enter or rotate cleanly. |
| Domain not resolving | Route missing — check `wrangler deploy` output created the custom domain; zone must be mykk.us in TGWAB account. |
| "Push failed" in UI, tail shows 413 | State > 100 KB. Find what bloated it (`kv key get state \| wc -c`) — likely a data-URL pasted as wallpaper. |
| Edits from one device vanish | Expected under last-write-wins if two devices edited while one was offline. Newest `updatedAt` wins. Not a bug. |
| Icons blank | DuckDuckGo icon service hiccup or new TLD — fallback avatar should show; if not, check `img.onerror` wiring. |
