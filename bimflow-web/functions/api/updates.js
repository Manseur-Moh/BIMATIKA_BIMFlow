import { getSupabase } from './_supabase.js';

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Content-Type": "application/json",
};
const j = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: CORS });

const sanitize = (s) => String(s || "").replace(/[^a-zA-Z0-9_\-]/g, "_").substring(0, 80);
const resolveCode = (request) => {
  const code = sanitize(new URL(request.url).searchParams.get("code") || "");
  return code || "LEGACY_unnamed"; // Fallback pour les updates sans code projet
};

export async function onRequestOptions() { return new Response("", { status: 200, headers: CORS }); }

export async function onRequestPost({ request, env }) {
  try {
    const code = resolveCode(request);
    const payload = await request.json();
    const sb = getSupabase(env);

    // Garantir que le projet existe (FK pending_updates.project_code → projects.code).
    // ignoreDuplicates: ne touche pas un projet existant (owner préservé).
    await sb.from('projects').upsert(
      { code, display_name: code, owner_email: 'archi_moh@live.fr' },
      { onConflict: 'code', ignoreDuplicates: true }
    );

    // Insérer un update en attente
    const { error } = await sb.from('pending_updates').insert({
      project_code: code,
      payload: payload,
      status: 'pending'
    });

    if (error) throw error;

    return j({ ok: true });
  } catch (err) {
    return j({ error: err.message }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const code = resolveCode(request);
    const sb = getSupabase(env);

    // Récupérer TOUS les updates en attente (pas seulement le dernier).
    // Les batchs sont fusionnés : pour un même RevitId, le plus récent gagne.
    const { data, error } = await sb
      .from('pending_updates')
      .select('payload')
      .eq('project_code', code)
      .eq('status', 'pending')
      .order('created_at', { ascending: true }); // plus ancien en premier → le plus récent écrase

    if (error) throw error;

    if (!data || data.length === 0) {
      return j({ Updates: [], NewParameters: [] });
    }

    // Fusionner tous les batchs en un seul payload
    let planKey = '';
    const updatesMap = {};   // RevitId → { RevitId, Parameters }
    const newParamsMap = {}; // Name → NewParameterRequest

    for (const row of data) {
      const p = row.payload || {};
      if (p.PlanKey) planKey = p.PlanKey;
      for (const u of (p.Updates || [])) {
        if (!updatesMap[u.RevitId]) updatesMap[u.RevitId] = { RevitId: u.RevitId, Parameters: {} };
        Object.assign(updatesMap[u.RevitId].Parameters, u.Parameters);
      }
      for (const np of (p.NewParameters || [])) {
        if (np && np.Name) newParamsMap[np.Name] = np;
      }
    }

    return j({
      PlanKey: planKey,
      Updates: Object.values(updatesMap),
      NewParameters: Object.values(newParamsMap)
    });
  } catch (err) {
    return j({ error: err.message }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const code = resolveCode(request);
    const sb = getSupabase(env);

    // Marquer comme appliqués tous les updates en attente pour ce projet
    const { error } = await sb
      .from('pending_updates')
      .update({ status: 'applied', applied_at: new Date().toISOString() })
      .eq('project_code', code)
      .eq('status', 'pending');

    if (error) throw error;

    return j({ ok: true });
  } catch (err) {
    return j({ error: err.message }, 500);
  }
}

