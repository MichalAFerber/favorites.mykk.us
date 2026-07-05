# Favorites

A fast, self-hosted favorites (speed-dial) page that syncs across devices. One Cloudflare Worker serves a single-file frontend and a tiny authenticated state API backed by Workers KV. No framework, no build step, no database, no accounts.

**Live instance:** https://favorites.mykk.us

## Features

- **Speed-dial grid** — add a name and a URL, get a tile. Bare domains work; `example.com` becomes `https://example.com` automatically, in both the add and edit dialogs.
- **Icons that just work** — favicons come from DuckDuckGo's icon service (a privacy choice over Google's), with a colored letter-avatar fallback. Any favorite can also set an explicit **Icon URL** that overrides the favicon — useful when a site's favicon is missing or ugly.
- **Long-press to edit or delete** — 500 ms hold on any tile. Deletion uses a two-tap confirm (no browser `confirm()` dialogs).
- **Themes and backdrop** — dark or light theme, optional wallpaper URL, optional background color.
- **Cross-device sync, one field** — paste your sync token under Settings → Sync and every device converges on the same favorites and settings. Leave it blank and the app is fully functional local-only.
- **Multi-user, invite-only** — each user has their own token and their own isolated document. There is no signup, no login page, and no way for users to see each other's data.

## How it is built

```
favorites/
├── public/
│   └── index.html    # the entire frontend: HTML + CSS + JS in one file
├── worker.js         # /api/state handler + auth
├── issue-token.sh    # issue / map / revoke user tokens
└── wrangler.toml     # bindings, assets dir, custom domain route
```

- **Frontend** — one HTML file, inline CSS and JS, no bundler, no npm, no CDN dependencies. Cloudflare serves it as a static asset before the Worker is ever invoked.
- **API** — the Worker handles exactly one route, `/api/state`:

  ```
  GET  /api/state   Authorization: Bearer <token>   → the user's JSON document, or literal null
  PUT  /api/state   Authorization: Bearer <token>   → 200 {"ok":true} | 400 bad json | 401 | 413 > 100 KB
  ```

- **Auth** — the bearer token *is* the identity. The Worker hashes it (SHA-256) and looks up `token:<hash>` → `userId` in KV; the user's document lives at `state:<userId>`. Plaintext tokens are never stored server-side, and the sync token lives only in each device's local storage — never inside the synced document.
- **Sync model** — last-write-wins on the document's `updatedAt`, whole document, per user. Two of *your own* devices editing offline resolve to the newest write; different users can never touch each other's documents. No merging, no CRDTs — deliberately.
- **Storage** — Workers KV, two key shapes (`token:<hash>` and `state:<userId>`), 100 KB cap per user document. The free tier allows 1,000 KV writes per day across all users; a handful of active users is fine.

## Using the app

1. Open the site. Tap **+** to add a favorite; long-press a tile to edit or delete it.
2. Optional per-favorite **Icon URL** in the same dialog overrides the favicon; clear it to revert.
3. **Settings (gear)** — theme, wallpaper URL, background color, and the sync token.
4. To sync a device: get a token from the owner, open Settings → Sync, paste it, save. That's the entire setup — the app always syncs against the site it was loaded from.

## Deploying your own

Prerequisites: a Cloudflare account and [wrangler](https://developers.cloudflare.com/workers/wrangler/) logged in.

```bash
# 1. Create a KV namespace and put its id (and your account id) in wrangler.toml
wrangler kv namespace create favorites-state

# 2. Point the custom domain route in wrangler.toml at a domain in your zone
#    (or delete the [[routes]] block to use the workers.dev URL)

# 3. Deploy
cd favorites
wrangler deploy

# 4. Issue yourself a token (see below), then verify:
curl -s -o /dev/null -w '%{http_code}\n' https://<your-domain>/            # 200
curl -s -o /dev/null -w '%{http_code}\n' https://<your-domain>/api/state   # 401
curl -s -H "Authorization: Bearer $TOKEN" https://<your-domain>/api/state  # null
```

## Maintaining users

All user management is `favorites/issue-token.sh`, run by the owner from the `favorites/` directory. Issuing a token *is* creating a user; there is nothing else to set up.

```bash
./issue-token.sh alice              # new user: generates a token, prints it ONCE,
                                    # and stores only its hash in KV
./issue-token.sh alice --existing   # map a token that is already on devices
                                    # (pasted silently from stdin — for migrations)
./issue-token.sh --revoke           # revoke a token (pasted silently);
                                    # the user's saved favorites are untouched
```

- **Onboarding** — run `./issue-token.sh <name>`, hand the printed token to the user (password manager recommended), and have them paste it under Settings → Sync. Done.
- **Rotation** — issue a new token for the same user id, have them update their devices, then revoke the old token. Their data is keyed by user id, not by token, so nothing is lost.
- **Offboarding** — `--revoke` kills access immediately. To also delete their data:

  ```bash
  wrangler kv key delete "state:<userId>" --namespace-id <your-namespace-id>
  ```

- **Inspecting** — `wrangler kv key list --namespace-id <id>` shows every user and token hash; `wrangler kv key get "state:<userId>" --namespace-id <id>` shows a user's document; `wrangler tail favorites` streams live request logs.

## Credits

Favicon: [Favorites](https://img.icons8.com/stickers/100/favorites.png) icon by [Icons8](https://icons8.com).

## License

[MIT](LICENSE)
