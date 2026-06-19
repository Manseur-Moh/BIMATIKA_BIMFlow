// DELETE /api/auth/account   Authorization: Bearer {session}
// Deletes the caller's own account (cannot delete admin).

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

    // Remove the user record
    await kv.delete("bfuser:" + email);

    // Delete all sessions for this user (list all bfsession: keys — expensive but rare)
    const sessions = await kv.list({ prefix: "bfsession:" });
    for (const { name } of sessions.keys) {
      const v = await kv.get(name);
      if (v === email) await kv.delete(name);
    }

    // Remove from all project member lists
    const members = await kv.list({ prefix: "projmembers:" });
    for (const { name } of members.keys) {
      const raw = await kv.get(name);
      if (!raw) continue;
      try {
        const arr = JSON.parse(raw).filter(e => e !== email);
        await kv.put(name, JSON.stringify(arr));
      } catch { }
    }

    // Transfer owned projects to admin
    const projects = await kv.list({ prefix: "projowner:" });
    for (const { name } of projects.keys) {
      const owner = await kv.get(name);
      if (owner === email) await kv.put(name, ADMIN);
    }

    // Delete any pending confirmation tokens
    const confirms = await kv.list({ prefix: "bfconfirm:" });
    for (const { name } of confirms.keys) {
      const v = await kv.get(name);
      if (v === email) await kv.delete(name);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
