// Cloudflare Pages Function — read/clear stored plans in KV (binding: BIMFLOW).
// GET    /api/plans              → list metadata of all plans
// GET    /api/plans?key=xxx      → full plan (with image)
// GET    /api/plans?key=xxx&light=1 → plan without the heavy base64 image
// DELETE /api/plans              → clear ALL plans + metadata (used before a fresh Revit send)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Content-Type": "application/json",
};
// No caching: plan data changes on every Revit re-send, so always serve the latest.
const NOCACHE = "no-store";
const resp = (obj, extra = {}) => new Response(JSON.stringify(obj), { status: 200, headers: { ...CORS, ...extra } });

export async function onRequestOptions() { return new Response("", { status: 200, headers: CORS }); }

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    const light = url.searchParams.get("light") === "1";
    const kv = env.BIMFLOW;

    if (key) {
      const plan = await kv.get("plan:" + key, { type: "json" });
      if (!plan) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
      if (light) { const { ImageBase64, ...rest } = plan; return resp(rest, { "Cache-Control": NOCACHE }); }
      return resp(plan, { "Cache-Control": NOCACHE });
    }

    const listed = await kv.list({ prefix: "meta:" });
    const metas = await Promise.all(listed.keys.map((k) => kv.get(k.name, { type: "json" }).catch(() => null)));
    const index = metas.filter(Boolean).sort((a, b) => (a.level || "").localeCompare(b.level || ""));
    return resp(index, { "Cache-Control": NOCACHE });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}

// Wipe every plan + meta key (Revit calls this once before sending a fresh batch).
export async function onRequestDelete({ env }) {
  try {
    const kv = env.BIMFLOW;
    let cursor, removed = 0;
    do {
      const listed = await kv.list({ cursor });
      for (const k of listed.keys) {
        if (k.name.startsWith("plan:") || k.name.startsWith("meta:")) { await kv.delete(k.name); removed++; }
      }
      cursor = listed.list_complete ? null : listed.cursor;
    } while (cursor);
    return resp({ ok: true, removed });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
