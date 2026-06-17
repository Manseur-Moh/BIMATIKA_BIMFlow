// Cloudflare Pages Function — fast room-parameters-only update.
// POST /api/params  body: { ProjectName, LevelName, Rooms:[{RevitId, Number, Name, Parameters,
//        ParameterTypes, ParameterReadOnly, ParameterChoices, AreaM2, PerimeterM}] }
// Merges the parameters into the ALREADY-uploaded plan (keeps image + room polygons).
// Used by the Revit "Envoyer paramètres" button when the geometry hasn't changed.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_\-]/g, "_").substring(0, 100);
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

export async function onRequestOptions() { return new Response("", { status: 200, headers: CORS }); }

export async function onRequestPost({ request, env }) {
  try {
    const p = await request.json();
    if (!p || !p.LevelName) return json({ error: "Missing LevelName" }, 400);
    const key = sanitize(`${p.ProjectName}__${p.LevelName}`);
    const kv = env.BIMFLOW;

    const plan = await kv.get("plan:" + key, { type: "json" });
    if (!plan) return json({ error: "Plan introuvable — envoyez d'abord le plan complet (Envoyer vers BIMFlow)." }, 404);

    const byId = {};
    (plan.Rooms || []).forEach(r => { byId[String(r.RevitId)] = r; });

    let updated = 0, added = 0;
    (p.Rooms || []).forEach(src => {
      const ex = byId[String(src.RevitId)];
      if (ex) {
        // keep geometry (SvgPolygon, CentroidX/Y); refresh parameter data + identity
        ex.Number = src.Number ?? ex.Number;
        ex.Name = src.Name ?? ex.Name;
        ex.Parameters = src.Parameters || {};
        ex.ParameterTypes = src.ParameterTypes || {};
        ex.ParameterReadOnly = src.ParameterReadOnly || {};
        ex.ParameterChoices = src.ParameterChoices || {};
        if (src.AreaM2 != null) ex.AreaM2 = src.AreaM2;
        if (src.PerimeterM != null) ex.PerimeterM = src.PerimeterM;
        updated++;
      } else {
        // new room with no geometry yet — params still available in the table
        plan.Rooms.push({ ...src, SvgPolygon: src.SvgPolygon || "", CentroidX: src.CentroidX || 0, CentroidY: src.CentroidY || 0 });
        added++;
      }
    });

    await kv.put("plan:" + key, JSON.stringify(plan));
    await kv.put("meta:" + key, JSON.stringify({
      key, project: plan.ProjectName, level: plan.LevelName, elev: plan.LevelElevation ?? 0,
      rooms: (plan.Rooms || []).length, date: new Date().toISOString().slice(0, 16).replace("T", " "),
    }));

    return json({ ok: true, key, updated, added });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
