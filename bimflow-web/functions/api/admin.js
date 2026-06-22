// Admin-only endpoints.
//
// GET    /api/admin              → list all users + project counts
// DELETE /api/admin?email=xxx   → delete a user account (cannot delete admin)
//
// Storage: user accounts remain in KV (bfuser:). Project ownership/membership
// live in Supabase (projects.owner_email, project_members.member_email).

import { getSupabase } from './_supabase.js';

const ADMIN = "archi_moh@live.fr";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Content-Type": "application/json",
};
const resp    = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Cache-Control": "no-store" } });
const respErr = (msg, s)     => resp({ error: msg }, s);

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
  const kv      = env.BIMFLOW;
  const sb      = getSupabase(env);
  const session = await getSession(request, kv);
  if (!session?.isAdmin) return respErr("Non autorisé", 403);

  // All users (still in KV)
  const userList = await kv.list({ prefix: "bfuser:" });
  const users    = (await Promise.all(
    userList.keys.map(k => kv.get(k.name, { type: "json" }).catch(() => null))
  )).filter(Boolean);

  // Count projects per owner (Supabase)
  const projCount = {};
  const { data: projs } = await sb.from('projects').select('owner_email');
  (projs || []).forEach(p => {
    const owner = (p.owner_email || ADMIN).toLowerCase();
    projCount[owner] = (projCount[owner] || 0) + 1;
  });

  return resp({
    users: users.map(u => ({
      name:         u.name,
      email:        u.email,
      plan:         u.plan || "free",
      confirmed:    !!u.confirmed,
      createdAt:    u.createdAt || "",
      projectCount: projCount[u.email?.toLowerCase()] || 0,
    })).sort((a, b) => a.createdAt < b.createdAt ? 1 : -1),
    adminEmail: ADMIN,
  });
}

export async function onRequestDelete({ request, env }) {
  try {
    const kv      = env.BIMFLOW;
    const sb      = getSupabase(env);
    const session = await getSession(request, kv);
    if (!session?.isAdmin) return respErr("Non autorisé", 403);

    const target = new URL(request.url).searchParams.get("email")?.toLowerCase().trim();
    if (!target)           return respErr("email required", 400);
    if (target === ADMIN)  return respErr("Impossible de supprimer le compte administrateur.", 400);

    // 1. Delete user record (KV)
    await kv.delete("bfuser:" + target);

    // 2. Delete any pending confirmation token for this user
    //    (we can't easily enumerate bfconfirm: tokens by email, so skip)

    // 3. Remove from all project member lists (Supabase)
    await sb.from('project_members').delete().eq('member_email', target);

    // 4. Transfer project ownership to admin (Supabase)
    await sb.from('projects').update({ owner_email: ADMIN }).eq('owner_email', target);

    return resp({ ok: true, deleted: target });
  } catch (err) {
    return respErr(err.message, 500);
  }
}
