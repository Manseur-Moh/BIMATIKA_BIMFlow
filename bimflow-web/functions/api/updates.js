// Cloudflare Pages Function — parameter updates / new-parameter requests (site → Revit).
// POST   /api/updates  — web UI saves edits + NewParameters
// GET    /api/updates  — Revit pulls pending payload
// DELETE /api/updates  — Revit clears after applying
// Stored in KV (binding: BIMFLOW) under the single key "pending".

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Content-Type": "application/json",
};
const j = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: CORS });

export async function onRequestOptions() { return new Response("", { status: 200, headers: CORS }); }

export async function onRequestPost({ request, env }) {
  try { const payload = await request.json(); await env.BIMFLOW.put("pending", JSON.stringify(payload)); return j({ ok: true }); }
  catch (err) { return j({ error: err.message }, 500); }
}
export async function onRequestGet({ env }) {
  try { const data = await env.BIMFLOW.get("pending", { type: "json" }); return j(data || { Updates: [] }); }
  catch (err) { return j({ error: err.message }, 500); }
}
export async function onRequestDelete({ env }) {
  try { await env.BIMFLOW.delete("pending"); return j({ ok: true }); }
  catch (err) { return j({ error: err.message }, 500); }
}
