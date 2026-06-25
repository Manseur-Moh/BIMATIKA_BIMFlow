// DELETE /api/auth/account   Authorization: Bearer {session}
// Deletes the caller's own account from Supabase + KV.
import { getSupabase } from '../_supabase.js';

const ADMIN = "archi_moh@live.fr";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "DELETE, OPTIONS",
  "Content-Type": "application/json",
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

async function getSession(request, env) {
  const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!auth) return null;
  return await env.BIMFLOW.get("bfsession:" + auth);
}

export async function onRequestOptions() {
  return new Response("", { status: 200, headers: CORS });
}

export async function onRequestDelete({ request, env }) {
  try {
    const email = await getSession(request, env);
    if (!email) return json({ error: "Non authentifié." }, 401);
    if (email === ADMIN) return json({ error: "Impossible de supprimer le compte administrateur." }, 403);

    const kv = env.BIMFLOW;
    const sb = getSupabase(env);

    // Delete from Supabase (column_presets first, then user)
    await sb.from('column_presets').delete().eq('user_email', email);
    await sb.from('users').delete().eq('email', email);

    // Remove from project members + transfer owned projects to admin
    await sb.from('project_members').delete().eq('member_email', email);
    await sb.from('projects').update({ owner_email: ADMIN }).eq('owner_email', email);

    // Clean up KV legacy user record
    await kv.delete("bfuser:" + email);

    // Delete all sessions for this user
    const sessions = await kv.list({ prefix: "bfsession:" });
    for (const { name } of sessions.keys) {
      const v = await kv.get(name);
      if (v === email) await kv.delete(name);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
