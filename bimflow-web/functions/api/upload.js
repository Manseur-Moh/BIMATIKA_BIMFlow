import { getSupabase } from './_supabase.js';

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const sanitize = (s) => String(s || "").replace(/[^a-zA-Z0-9_\-]/g, "_").substring(0, 80);
const clean    = (s) => String(s || "").trim();
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, ...extra, "Content-Type": "application/json" } });

export async function onRequestOptions() { return new Response("", { status: 200, headers: CORS }); }

export async function onRequestPost({ request, env }) {
  try {
    const payload = await request.json();
    if (!payload || !payload.LevelName) return json({ error: "Missing LevelName" }, 400);

    const rawCode = clean(payload.ProjectCode) || clean(payload.ProjectNumber) || "";
    let code = sanitize(rawCode);

    // Si aucun code projet, on crée un code legacy synthétique pour respecter la FK
    if (!code) {
      code = "LEGACY_" + sanitize(payload.ProjectName || "unnamed");
    }

    const key = sanitize(`${code}__${payload.LevelName}`);

    const sb = getSupabase(env);

    // Résoudre l'owner du projet (équivalent du projowner existant)
    let uploaderEmail = "archi_moh@live.fr"; // Valeur par défaut
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (token) {
      const sessionUser = await env.BIMFLOW.get("bfsession:" + token);
      if (sessionUser) uploaderEmail = sessionUser.toLowerCase();
    }

    // 1. D'abord on upsert le projet (car FK requise dans plans)
    // Pour ne pas écraser l'owner existant s'il y en a un, on fait un upsert intelligent
    const { data: existingProj } = await sb
      .from('projects')
      .select('owner_email')
      .eq('code', code)
      .maybeSingle();

    const ownerToUse = existingProj ? existingProj.owner_email : uploaderEmail;

    await sb.from('projects').upsert({
      code: code,
      display_name: payload.ProjectName || code,
      project_name: payload.ProjectName || '',
      owner_email: ownerToUse,
      updated_at: new Date().toISOString()
    }, { onConflict: 'code' });

    // 2. Ensuite on upsert le plan
    const { error: planErr } = await sb.from('plans').upsert({
      plan_key: key,
      project_code: code,
      level_name: payload.LevelName,
      level_elev: payload.LevelElevation ?? 0,
      rooms_count: (payload.Rooms || []).length,
      export_date: payload.ExportDate || new Date().toISOString(),
      plan_data: payload,
      image_base64: payload.ImageBase64 || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'plan_key' });

    if (planErr) throw planErr;

    return json({ ok: true, key, code, rooms: (payload.Rooms || []).length });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

