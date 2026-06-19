// Cloudflare Pages Function — project registry with per-user ownership.
//
// KV key scheme:
//   projname:{code}   → { code, displayName, updatedAt }
//   projowner:{code}  → email of owner (lowercase)
//
// ADMIN email: archi_moh@live.fr (always sees and manages everything)
//
// GET    /api/projets             → projects visible to the session user
// GET    /api/projets?code=xxx    → verify a specific code (owner or admin)
// POST   /api/projets?code=xxx   { displayName } → create / rename
// DELETE /api/projets?code=xxx   → remove name + owner records

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

// ── Load all projowner: keys into a map { code → email } ──
async function loadOwners(kv) {
  const list = await kv.list({ prefix: "projowner:" });
  const owners = {};
  await Promise.all(list.keys.map(async k => {
    const e = await kv.get(k.name);
    owners[k.name.replace("projowner:", "")] = (e || ADMIN).toLowerCase();
  }));
  return owners;
}

export async function onRequestGet({ request, env }) {
  try {
    const kv      = env.BIMFLOW;
    const session = await getSession(request, kv);
    const url     = new URL(request.url);
    const code    = url.searchParams.get("code");

    // Unauthenticated — empty list
    if (!session) return resp([]);

    if (code) {
      // Verify a specific code
      const listed = await kv.list({ prefix: "meta:" });
      const metas  = await Promise.all(listed.keys.map(k => kv.get(k.name, { type: "json" }).catch(() => null)));
      const match  = metas.filter(Boolean).find(m => (m.projectCode || "") === code);
      if (!match) return resp({ error: "Code projet introuvable" }, 404);

      if (!session.isAdmin) {
        const owners = await loadOwners(kv);
        const owner  = owners[code] || ADMIN;
        if (owner !== session.email) return resp({ error: "Accès non autorisé" }, 403);
      }

      const nameRec = await kv.get("projname:" + code, { type: "json" }).catch(() => null);
      return resp({
        code, found: true,
        displayName: nameRec?.displayName || match.project || code,
        projectName: match.project,
        plans: metas.filter(Boolean).filter(m => m.projectCode === code).length,
      });
    }

    // List all projects from meta keys
    const listed = await kv.list({ prefix: "meta:" });
    const metas  = await Promise.all(listed.keys.map(k => kv.get(k.name, { type: "json" }).catch(() => null)));
    const valid  = metas.filter(Boolean);

    const byCode = {};
    valid.forEach(m => {
      const c = m.projectCode || "__legacy__";
      if (!byCode[c]) byCode[c] = { code: c, projectName: m.project || "", plans: 0, rooms: 0, lastDate: "" };
      byCode[c].plans++;
      byCode[c].rooms += m.rooms || 0;
      if ((m.date || "") > byCode[c].lastDate) byCode[c].lastDate = m.date || "";
    });

    // Merge display names
    const nameList = await kv.list({ prefix: "projname:" });
    const names    = await Promise.all(nameList.keys.map(k => kv.get(k.name, { type: "json" }).catch(() => null)));
    names.filter(Boolean).forEach(n => {
      if (byCode[n.code]) byCode[n.code].displayName = n.displayName;
      else byCode[n.code] = { code: n.code, displayName: n.displayName, projectName: "", plans: 0, rooms: 0, lastDate: "" };
    });

    let projects = Object.values(byCode).sort((a, b) => b.lastDate.localeCompare(a.lastDate));

    // Admin sees everything; regular user sees only owned projects
    if (!session.isAdmin) {
      const owners = await loadOwners(kv);
      projects = projects.filter(p => {
        const owner = owners[p.code] || ADMIN;
        return owner === session.email;
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
    const session = await getSession(request, kv);
    if (!session) return resp({ error: "Non authentifié" }, 401);

    const url  = new URL(request.url);
    const code = url.searchParams.get("code");
    if (!code) return resp({ error: "code required" }, 400);

    const body        = await request.json();
    const displayName = String(body.displayName || "").trim();
    if (!displayName) return resp({ error: "displayName required" }, 400);

    // Check ownership for rename (admin bypasses)
    if (!session.isAdmin) {
      const owners = await loadOwners(kv);
      const owner  = owners[code] || ADMIN;
      if (owner !== session.email) return resp({ error: "Non autorisé" }, 403);
    }

    // Set owner on first creation
    const existingOwner = await kv.get("projowner:" + code);
    if (!existingOwner) {
      await kv.put("projowner:" + code, session.email);
    }

    await kv.put("projname:" + code, JSON.stringify({ code, displayName, updatedAt: new Date().toISOString() }));
    return resp({ ok: true, code, displayName });
  } catch (err) {
    return resp({ error: err.message }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const kv      = env.BIMFLOW;
    const session = await getSession(request, kv);
    if (!session) return resp({ error: "Non authentifié" }, 401);

    const url  = new URL(request.url);
    const code = url.searchParams.get("code");
    if (!code) return resp({ error: "code required" }, 400);

    if (!session.isAdmin) {
      const owners = await loadOwners(kv);
      const owner  = owners[code] || ADMIN;
      if (owner !== session.email) return resp({ error: "Non autorisé" }, 403);
    }

    await kv.delete("projname:"  + code);
    await kv.delete("projowner:" + code);
    return resp({ ok: true });
  } catch (err) {
    return resp({ error: err.message }, 500);
  }
}
