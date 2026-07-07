// favorites — /api/state handler + auth.
// Static assets in public/ are served before this Worker is invoked, so the
// only requests that land here are ones that don't match an asset.

const MAX_BODY_BYTES = 100 * 1024; // 100 KB cap — design decision, not a tunable

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

async function sha256Hex(s) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Tokens are stored hashed in KV: `token:<sha256(token)>` → userId.
// Issue and revoke them with favorites/issue-token.sh. Comparing by hash
// lookup avoids storing plaintext tokens server-side and doesn't leak
// timing about partial matches.
async function authenticate(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  return env.SHORTCUTS_KV.get("token:" + (await sha256Hex(token)));
}

/* ---------- /icon: same-origin favicon proxy ----------
   Resolution chain: Dashboard Icons (by service slug) → DuckDuckGo favicon
   service → the site's own /favicon.ico → generated letter-avatar SVG.
   Always answers 200 so tiles never log 404s, and the client never talks
   to third-party icon services directly. Edge-cached. */

const ICON_MAX_BYTES = 512 * 1024;

// "my.wyze.com" → ["wyze", "my"]: the registrable label first, then the
// subdomain — opportunistic guesses at a Dashboard Icons slug.
function iconSlugCandidates(host) {
  const labels = host.split(".");
  const out = [];
  if (labels.length >= 2) out.push(labels[labels.length - 2]);
  if (labels.length >= 3 && labels[0] !== "www") out.push(labels[0]);
  return [...new Set(out)].filter((s) => /^[a-z0-9-]{2,}$/.test(s));
}

async function fetchIcon(iconUrl) {
  try {
    const res = await fetch(iconUrl, { cf: { cacheTtl: 86400 } });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (type && !type.startsWith("image/") && type !== "application/octet-stream") return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > ICON_MAX_BYTES) return null;
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": type || "image/x-icon",
        "Cache-Control": "public, max-age=604800",
      },
    });
  } catch {
    return null;
  }
}

function letterAvatarSvg(host) {
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  const letter = host.replace(/^www\./, "").charAt(0).toUpperCase();
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
    '<rect width="64" height="64" rx="14" fill="hsl(' + (h % 360) + ',45%,45%)"/>' +
    '<text x="32" y="43" font-family="system-ui,sans-serif" font-size="32" font-weight="600" fill="#fff" text-anchor="middle">' + letter + "</text></svg>";
  // Shorter TTL than real icons — a site may get indexed later.
  return new Response(svg, {
    status: 200,
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" },
  });
}

async function handleIcon(request, url, ctx) {
  if (request.method !== "GET") return jsonResponse(405, { error: "method not allowed" });
  const host = (url.searchParams.get("host") || "").trim().toLowerCase();
  // Hostnames only — no ports, paths, or anything URL-shaped.
  if (!/^[a-z0-9]([a-z0-9.-]{0,250})$/.test(host) || !host.includes(".")) {
    return jsonResponse(400, { error: "bad host" });
  }
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(url.origin + "/icon?host=" + encodeURIComponent(host));
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  let res = null;
  for (const slug of iconSlugCandidates(host)) {
    res = await fetchIcon("https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/" + slug + ".png");
    if (res) break;
  }
  if (!res) res = await fetchIcon("https://icons.duckduckgo.com/ip3/" + host + ".ico");
  if (!res) res = await fetchIcon("https://" + host + "/favicon.ico");
  if (!res) res = letterAvatarSvg(host);
  if (cache && ctx) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/icon") {
      return handleIcon(request, url, ctx);
    }

    if (url.pathname !== "/api/state") {
      return jsonResponse(404, { error: "not found" });
    }

    const userId = await authenticate(request, env);
    if (!userId) {
      return jsonResponse(401, { error: "unauthorized" });
    }
    const stateKey = "state:" + userId;

    if (request.method === "GET") {
      const state = await env.SHORTCUTS_KV.get(stateKey);
      // Literal `null` if never synced — clients rely on this.
      return new Response(state ?? "null", { status: 200, headers: JSON_HEADERS });
    }

    if (request.method === "PUT") {
      const declared = Number(request.headers.get("Content-Length"));
      if (declared > MAX_BODY_BYTES) {
        return jsonResponse(413, { error: "too large" });
      }
      const body = await request.text();
      if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
        return jsonResponse(413, { error: "too large" });
      }
      try {
        JSON.parse(body);
      } catch {
        return jsonResponse(400, { error: "bad json" });
      }
      await env.SHORTCUTS_KV.put(stateKey, body);
      return jsonResponse(200, { ok: true });
    }

    return jsonResponse(405, { error: "method not allowed" });
  },
};
