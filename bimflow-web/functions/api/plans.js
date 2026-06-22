import { getSupabase } from './_supabase.js';

const ADMIN = "archi_moh@live.fr";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, DELETE, PATCH, OPTIONS",
  "Content-Type": "application/json",
};
const NOCACHE = "no-store";
const resp    = (obj, extra = {}) => new Response(JSON.stringify(obj), { status: 200, headers: { ...CORS, ...extra } });
const respErr = (msg, s) => new Response(JSON.stringify({ error: msg }), { status: s, headers: CORS });

export async function onRequestOptions() { return new Response("", { status: 200, headers: CORS }); }

async function getSession(request, kv) {
  const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!auth) return null;
  const email = await kv.get("bfsession:" + auth);
  if (!email) return null;
  return { email: email.toLowerCase(), isAdmin: email.toLowerCase() === ADMIN };
}

async function hasProjectAccess(session, code, sb) {
  if (session.isAdmin) return true;
  
  // Récupérer le projet pour vérifier l'owner
  const { data: proj } = await sb
    .from('projects')
    .select('owner_email')
    .eq('code', code)
    .maybeSingle();
    
  if (proj && proj.owner_email.toLowerCase() === session.email) return true;

  // Récupérer les membres
  const { data: member } = await sb
    .from('project_members')
    .select('id')
    .eq('project_code', code)
    .eq('member_email', session.email)
    .maybeSingle();

  return !!member;
}

export async function onRequestGet({ request, env }) {
  try {
    const url   = new URL(request.url);
    const key   = url.searchParams.get("key");
    const light = url.searchParams.get("light") === "1";
    const code  = (url.searchParams.get("code") || "").trim();
    const kv    = env.BIMFLOW;
    const sb    = getSupabase(env);

    // ── Individual plan by key ──
    if (key) {
      const { data: plan, error } = await sb
        .from('plans')
        .select(light ? 'plan_key, project_code, level_name, level_elev, rooms_count, export_date, plan_data' : 'plan_data, image_base64')
        .eq('plan_key', key)
        .maybeSingle();

      if (error) return respErr(error.message, 500);
      if (!plan) return respErr("Not found", 404);

      if (light) {
        // Le format original renvoie l'objet complet sans ImageBase64
        const data = plan.plan_data || {};
        const { ImageBase64, ...rest } = data;
        return resp(rest, { "Cache-Control": NOCACHE });
      }
      return resp(plan.plan_data, { "Cache-Control": NOCACHE });
    }

    // ── List endpoint — requires auth ──
    const session = await getSession(request, kv);
    if (!session) return resp([], { "Cache-Control": NOCACHE });

    if (code) {
      if (!await hasProjectAccess(session, code, sb)) {
        return resp([], { "Cache-Control": NOCACHE });
      }
    } else if (!session.isAdmin) {
      return resp([], { "Cache-Control": NOCACHE });
    }

    // Liste des métadonnées
    let query = sb
      .from('plans')
      .select('plan_key, project_code, level_name, level_elev, rooms_count, export_date, projects(project_name)');

    if (code) {
      query = query.eq('project_code', code);
    }

    const { data: plansData, error } = await query;
    if (error) return respErr(error.message, 500);

    // Convertir les lignes SQL au format attendu par le frontend (metas de KV)
    const index = plansData.map(p => ({
      key: p.plan_key,
      project: p.projects?.project_name || "",
      projectCode: p.project_code,
      level: p.level_name,
      elev: p.level_elev,
      rooms: p.rooms_count,
      date: p.export_date,
    })).sort((a, b) => (a.level || "").localeCompare(b.level || ""));

    return resp(index, { "Cache-Control": NOCACHE });
  } catch (err) {
    return respErr(err.message, 500);
  }
}

// Patch room parameters
export async function onRequestPatch({ request, env }) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (!key) return respErr("key required", 400);
    const sb   = getSupabase(env);
    const body = await request.json();

    const { data: plan, error } = await sb
      .from('plans')
      .select('plan_data')
      .eq('plan_key', key)
      .maybeSingle();

    if (error) return respErr(error.message, 500);
    if (!plan || !plan.plan_data) return respErr("Not found", 404);

    const fullPlan = plan.plan_data;
    const updates = body.rooms || {};
    let changed = 0;
    (fullPlan.Rooms || []).forEach(room => {
      const upd = updates[String(room.RevitId)];
      if (!upd) return;
      if (upd.Parameters) Object.assign(room.Parameters = room.Parameters || {}, upd.Parameters);
      if (upd.Number !== undefined) room.Number = upd.Number;
      if (upd.Name   !== undefined) room.Name   = upd.Name;
      changed++;
    });

    const { error: updErr } = await sb
      .from('plans')
      .update({ plan_data: fullPlan, updated_at: new Date().toISOString() })
      .eq('plan_key', key);

    if (updErr) return respErr(updErr.message, 500);

    return resp({ ok: true, changed });
  } catch (err) {
    return respErr(err.message, 500);
  }
}

// Wipe plans
export async function onRequestDelete({ request, env }) {
  try {
    const url     = new URL(request.url);
    const code    = (url.searchParams.get("code") || "").trim();
    const kv      = env.BIMFLOW;
    const sb      = getSupabase(env);

    const session = await getSession(request, kv);
    if (!session) return respErr("Non authentifié", 401);

    if (code && !session.isAdmin) {
      if (!await hasProjectAccess(session, code, sb)) return respErr("Non autorisé", 403);
    } else if (!code && !session.isAdmin) {
      return respErr("Non autorisé", 403);
    }

    if (code) {
      const { error, count } = await sb
        .from('plans')
        .delete({ count: 'exact' })
        .eq('project_code', code);

      if (error) return respErr(error.message, 500);
      return resp({ ok: true, removed: count || 0, code });
    }

    // Admin wipe-all
    const { error, count } = await sb
      .from('plans')
      .delete({ count: 'exact' })
      .neq('plan_key', 'dummy_non_existent_key_for_select_all');

    if (error) return respErr(error.message, 500);
    return resp({ ok: true, removed: count || 0 });
  } catch (err) {
    return respErr(err.message, 500);
  }
}

