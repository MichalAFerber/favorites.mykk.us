// favorites — /api/state handler + auth.
// Static assets in public/ are served before this Worker is invoked, so the
// only requests that land here are ones that don't match an asset.

const MAX_BODY_BYTES = 100 * 1024; // 100 KB cap — design decision, not a tunable

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

// Constant-time comparison so token checks don't leak length/prefix timing.
function tokensEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function authorized(request, env) {
  if (!env.SYNC_TOKEN) return false;
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return false;
  return tokensEqual(header.slice(7).trim(), env.SYNC_TOKEN);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/api/state") {
      return jsonResponse(404, { error: "not found" });
    }

    if (!authorized(request, env)) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    if (request.method === "GET") {
      const state = await env.SHORTCUTS_KV.get("state");
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
      await env.SHORTCUTS_KV.put("state", body);
      return jsonResponse(200, { ok: true });
    }

    return jsonResponse(405, { error: "method not allowed" });
  },
};
