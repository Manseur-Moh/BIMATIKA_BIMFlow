// GET /api/admin  — admin-only: returns all users and project counts.
const ADMIN = "archi_moh@live.fr";

async function getSession(request, kv) {
  const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!auth) return null;
  const email = await kv.get("bfsession:" + auth);
  if (!email) return null;
  return { email: email.toLowerCase(), isAdmin: email.toLowerCase() === ADMIN };
}

export async function onRequestGet({ request, env }) {
  const kv      = env.BIMFLOW;
  const session = await getSession(request, kv);
  if (!session?.isAdmin) {
    return new Response(JSON.stringify({ error: "Non autorisé" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  // All users
  const userList = await kv.list({ prefix: "bfuser:" });
  const users    = (await Promise.all(
    userList.keys.map(k => kv.get(k.name, { type: "json" }).catch(() => null))
  )).filter(Boolean);

  // Count projects per owner
  const ownerList = await kv.list({ prefix: "projowner:" });
  const projCount = {};
  await Promise.all(ownerList.keys.map(async k => {
    const owner = (await kv.get(k.name) || ADMIN).toLowerCase();
    projCount[owner] = (projCount[owner] || 0) + 1;
  }));

  return new Response(JSON.stringify({
    users: users.map(u => ({
      name:         u.name,
      email:        u.email,
      plan:         u.plan || "free",
      confirmed:    !!u.confirmed,
      createdAt:    u.createdAt || "",
      projectCount: projCount[u.email?.toLowerCase()] || 0,
    })).sort((a, b) => a.createdAt < b.createdAt ? 1 : -1),
    adminEmail: ADMIN,
  }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function onRequestOptions() {
  return new Response("", { status: 200, headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  }});
}
