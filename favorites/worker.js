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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
