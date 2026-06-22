// Cloudflare Pages Function — fast room-parameters-only update.
// POST /api/params  body: { ProjectName, ProjectCode/ProjectNumber, LevelName, Rooms:[...] }
// Merges the parameters into the ALREADY-uploaded plan (keeps image + room polygons).
// Used by the Revit "Envoyer paramètres" button when the geometry hasn't changed.
// Storage: Supabase `plans` table (plan_data JSONB). Auth sessions remain in KV.

import { getSupabase } from './_supabase.js';

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const sanitize = (s) => String(s || "").replace(/[^a-zA-Z0-9_\-]/g, "_").substring(0, 80);
const clean    = (s) => String(s || "").trim();
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

export async function onRequestOptions() { return new Response("", { status: 200, headers: CORS }); }

export async function onRequestPost({ request, env }) {
  try {
    const p = await request.json();
    if (!p || !p.LevelName) return json({ error: "Missing LevelName" }, 400);

    // Resolve plan key the SAME way upload.js does (LEGACY_ fallback keeps the FK valid).
    const rawCode = clean(p.ProjectCode) || clean(p.ProjectNumber) || "";
    let code = sanitize(rawCode);
    if (!code) code = "LEGACY_" + sanitize(p.ProjectName || "unnamed");
    const key = sanitize(`${code}__${p.LevelName}`);

    const sb = getSupabase(env);

    const { data: row, error: selErr } = await sb
      .from('plans')
      .select('plan_data')
      .eq('plan_key', key)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!row || !row.plan_data)
      return json({ error: "Plan introuvable — envoyez d'abord le plan complet (Envoyer vers BIMFlow)." }, 404);

    const plan = row.plan_data;

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
        plan.Rooms = plan.Rooms || [];
        plan.Rooms.push({ ...src, SvgPolygon: src.SvgPolygon || "", CentroidX: src.CentroidX || 0, CentroidY: src.CentroidY || 0 });
        added++;
      }
    });

    const { error: updErr } = await sb
      .from('plans')
      .update({
        plan_data:   plan,
        rooms_count: (plan.Rooms || []).length,
        updated_at:  new Date().toISOString(),
      })
      .eq('plan_key', key);
    if (updErr) throw updErr;

    return json({ ok: true, key, updated, added });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
