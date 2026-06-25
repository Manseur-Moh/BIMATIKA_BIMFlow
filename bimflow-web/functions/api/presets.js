// Column preset favorites — stored in Supabase public.column_presets.
//
// GET    /api/presets            → { name: [col, …], … }  for current user
// POST   /api/presets            body { name, columns }   → save/update a preset
// DELETE /api/presets?name=xxx   → delete a preset

import { getSupabase } from './_supabase.js';

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Content-Type": "application/json",
};
const resp    = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Cache-Control": "no-store" } });
const respErr = (msg, s)     => resp({ error: msg }, s);

async function getSession(request, kv) {
  const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!auth) return null;
  return await kv.get("bfsession:" + auth) || null;
}

export async function onRequestOptions() { return new Response("", { status: 200, headers: CORS }); }

export async function onRequestGet({ request, env }) {
  try {
    const email = await getSession(request, env.BIMFLOW);
    if (!email) return resp({});

    const sb = getSupabase(env);
    const { data, error } = await sb
      .from('column_presets')
      .select('name, columns')
      .eq('user_email', email)
      .order('created_at');

    if (error) throw error;

    const out = {};
    (data || []).forEach(p => { out[p.name] = p.columns || []; });
    return resp(out);
  } catch (err) {
    return respErr(err.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const email = await getSession(request, env.BIMFLOW);
    if (!email) return respErr("Non authentifié", 401);

    const { name, columns } = await request.json();
    if (!name) return respErr("name required", 400);

    const sb  = getSupabase(env);
    const now = new Date().toISOString();

    // Check if preset already exists for this user
    const { data: existing } = await sb
      .from('column_presets')
      .select('id')
      .eq('user_email', email)
      .eq('name', name)
      .maybeSingle();

    if (existing) {
      const { error } = await sb
        .from('column_presets')
        .update({ columns: columns || [], updated_at: now })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await sb
        .from('column_presets')
        .insert({ user_email: email, name, columns: columns || [], created_at: now, updated_at: now });
      if (error) throw error;
    }

    return resp({ ok: true });
  } catch (err) {
    return respErr(err.message, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const email = await getSession(request, env.BIMFLOW);
    if (!email) return respErr("Non authentifié", 401);

    const name = new URL(request.url).searchParams.get("name");
    if (!name) return respErr("name required", 400);

    const sb = getSupabase(env);
    const { error } = await sb
      .from('column_presets')
      .delete()
      .eq('user_email', email)
      .eq('name', name);

    if (error) throw error;
    return resp({ ok: true });
  } catch (err) {
    return respErr(err.message, 500);
  }
}
