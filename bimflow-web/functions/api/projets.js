import { getSupabase } from './_supabase.js';

const ADMIN = "archi_moh@live.fr";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Content-Type": "application/json",
};
const resp = (obj, s = 200) =>
  new Response(JSON.stringify(obj), { status: s, headers: { ...CORS, "Cache-Control": "no-store" } });

export async function onRequestOptions() {
  return new Response("", { status: 200, headers: CORS });
}

async function getSession(request, kv) {
  const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!auth) return null;
  const email = await kv.get("bfsession:" + auth);
  if (!email) return null;
  return { email: email.toLowerCase(), isAdmin: email.toLowerCase() === ADMIN };
}

export async function onRequestGet({ request, env }) {
  try {
    const kv      = env.BIMFLOW;
    const sb      = getSupabase(env);
    const session = await getSession(request, kv);
    const url     = new URL(request.url);
    const code    = url.searchParams.get("code");

    // Unauthenticated — empty list
    if (!session) return resp([]);

    if (code) {
      // Vérifier un code projet spécifique
      const { data: proj, error } = await sb
        .from('projects')
        .select('code, display_name, project_name, owner_email, plans(plan_key)')
        .eq('code', code)
        .maybeSingle();

      if (error) return resp({ error: error.message }, 500);
      if (!proj) return resp({ error: "Code projet introuvable" }, 404);

      if (!session.isAdmin) {
        // Vérifier si le user est le propriétaire ou membre
        const { data: member } = await sb
          .from('project_members')
          .select('id')
          .eq('project_code', code)
          .eq('member_email', session.email)
          .maybeSingle();

        if (proj.owner_email.toLowerCase() !== session.email && !member) {
          return resp({ error: "Accès non autorisé" }, 403);
        }
      }

      return resp({
        code,
        found: true,
        displayName: proj.display_name || proj.project_name || code,
        projectName: proj.project_name,
        plans: proj.plans?.length || 0,
      });
    }

    // Liste tous les projets
    // Charger tous les projets avec le nombre de plans et la somme des rooms
    const { data: projs, error: projsErr } = await sb
      .from('projects')
      .select('code, display_name, project_name, owner_email, created_at, updated_at, plans(plan_key, rooms_count, export_date)');

    if (projsErr) return resp({ error: projsErr.message }, 500);

    let projects = projs.map(p => {
      let rooms = 0;
      let lastDate = p.created_at;
      (p.plans || []).forEach(plan => {
        rooms += plan.rooms_count || 0;
        if (plan.export_date && plan.export_date > lastDate) {
          lastDate = plan.export_date;
        }
      });

      return {
        code: p.code,
        displayName: p.display_name,
        projectName: p.project_name,
        ownerEmail: p.owner_email,
        plans: p.plans?.length || 0,
        rooms,
        lastDate,
      };
    }).sort((a, b) => b.lastDate.localeCompare(a.lastDate));

    // Filtrer si ce n'est pas un admin
    if (!session.isAdmin) {
      // Récupérer les codes projets partagés avec l'utilisateur
      const { data: shared, error: sharedErr } = await sb
        .from('project_members')
        .select('project_code')
        .eq('member_email', session.email);

      if (sharedErr) return resp({ error: sharedErr.message }, 500);
      const sharedCodes = new Set(shared.map(m => m.project_code));

      projects = projects.filter(p => p.ownerEmail.toLowerCase() === session.email || sharedCodes.has(p.code));

      // Taguer les projets partagés
      projects.forEach(p => {
        if (sharedCodes.has(p.code)) p.shared = true;
      });
    }

    return resp(projects);
  } catch (err) {
    return resp({ error: err.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const kv      = env.BIMFLOW;
    const sb      = getSupabase(env);
    const session = await getSession(request, kv);
    if (!session) return resp({ error: "Non authentifié" }, 401);

    const url  = new URL(request.url);
    const code = url.searchParams.get("code");
    if (!code) return resp({ error: "code required" }, 400);

    const body        = await request.json();
    const displayName = String(body.displayName || "").trim();
    if (!displayName) return resp({ error: "displayName required" }, 400);

    // Vérifier l'owner existant si ce n'est pas un admin
    const { data: existingProj, error: selectErr } = await sb
      .from('projects')
      .select('owner_email')
      .eq('code', code)
      .maybeSingle();

    if (selectErr) return resp({ error: selectErr.message }, 500);

    if (existingProj && !session.isAdmin) {
      if (existingProj.owner_email.toLowerCase() !== session.email) {
        return resp({ error: "Non autorisé" }, 403);
      }
    }

    const ownerToUse = existingProj ? existingProj.owner_email : session.email;

    const { error: upsertErr } = await sb
      .from('projects')
      .upsert({
        code,
        display_name: displayName,
        project_name: existingProj?.project_name || displayName,
        owner_email: ownerToUse,
        updated_at: new Date().toISOString()
      }, { onConflict: 'code' });

    if (upsertErr) return resp({ error: upsertErr.message }, 500);

    return resp({ ok: true, code, displayName });
  } catch (err) {
    return resp({ error: err.message }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const kv      = env.BIMFLOW;
    const sb      = getSupabase(env);
    const session = await getSession(request, kv);
    if (!session) return resp({ error: "Non authentifié" }, 401);

    const url  = new URL(request.url);
    const code = url.searchParams.get("code");
    if (!code) return resp({ error: "code required" }, 400);

    // Récupérer le projet pour vérification
    const { data: existingProj, error: selectErr } = await sb
      .from('projects')
      .select('owner_email')
      .eq('code', code)
      .maybeSingle();

    if (selectErr) return resp({ error: selectErr.message }, 500);
    if (!existingProj) return resp({ ok: true }); // Déjà supprimé

    if (!session.isAdmin && existingProj.owner_email.toLowerCase() !== session.email) {
      return resp({ error: "Non autorisé" }, 403);
    }

    const { error: deleteErr } = await sb
      .from('projects')
      .delete()
      .eq('code', code);

    if (deleteErr) return resp({ error: deleteErr.message }, 500);

    return resp({ ok: true });
  } catch (err) {
    return resp({ error: err.message }, 500);
  }
}

