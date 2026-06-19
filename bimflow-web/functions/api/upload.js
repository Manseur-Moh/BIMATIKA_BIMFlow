// Cloudflare Pages Function — receives BIMFlow data from the Revit plugin.
// POST /api/upload   body: JSON (PlanExport)
// Stores the full plan and a small metadata record in KV (binding: BIMFLOW).
//
// Key strategy:
//   When a project code is available (ProjectCode from plugin GUID, or ProjectNumber
//   set by user in Revit), the key is  {code}__{LevelName}  — unique per project file.
//   When neither is available (legacy), the key falls back to  {ProjectName}__{LevelName}.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const sanitize = (s) => String(s || "").replace(/[^a-zA-Z0-9_\-]/g, "_").substring(0, 80);
const clean    = (s) => String(s || "").trim();
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json", ...extra } });

export async function onRequestOptions() { return new Response("", { status: 200, headers: CORS }); }

export async function onRequestPost({ request, env }) {
  try {
    const payload = await request.json();
    if (!payload || !payload.LevelName) return json({ error: "Missing LevelName" }, 400);

    // Resolve effective project code:
    //   1. ProjectCode  — sent by updated plugin (derived from Revit GUID, always unique)
    //   2. ProjectNumber — Revit project number field (user can set this as workaround)
    //   3. "" — legacy: fall back to name-based key
    const rawCode = clean(payload.ProjectCode) || clean(payload.ProjectNumber) || "";
    const code    = sanitize(rawCode);          // safe for KV keys

    // Build plan key — code-prefixed when available (prevents cross-project collisions)
    const key = code
      ? sanitize(`${code}__${payload.LevelName}`)
      : sanitize(`${payload.ProjectName}__${payload.LevelName}`);

    await env.BIMFLOW.put("plan:" + key, JSON.stringify(payload));
    await env.BIMFLOW.put("meta:" + key, JSON.stringify({
      key,
      project:     payload.ProjectName  || "",
      projectCode: code,
      projectNum:  clean(payload.ProjectNumber),
      level:       payload.LevelName,
      elev:        payload.LevelElevation ?? 0,
      rooms:       (payload.Rooms || []).length,
      date:        payload.ExportDate || new Date().toISOString(),
    }));
    return json({ ok: true, key, code, rooms: (payload.Rooms || []).length });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
