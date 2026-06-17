// Cloudflare Pages Function — receives BIMFlow data from the Revit plugin.
// POST /api/upload   body: JSON (PlanExport)
// Stores the full plan and a small metadata record in KV (binding: BIMFLOW).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_\-]/g, "_").substring(0, 100);
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json", ...extra } });

export async function onRequestOptions() { return new Response("", { status: 200, headers: CORS }); }

export async function onRequestPost({ request, env }) {
  try {
    const payload = await request.json();
    if (!payload || !payload.LevelName) return json({ error: "Missing LevelName" }, 400);
    const key = sanitize(`${payload.ProjectName}__${payload.LevelName}`);
    await env.BIMFLOW.put("plan:" + key, JSON.stringify(payload));
    await env.BIMFLOW.put("meta:" + key, JSON.stringify({
      key, project: payload.ProjectName, level: payload.LevelName,
      elev: payload.LevelElevation ?? 0,
      rooms: (payload.Rooms || []).length, date: payload.ExportDate,
    }));
    return json({ ok: true, key, rooms: (payload.Rooms || []).length });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
