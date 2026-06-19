// Cloudflare Pages Function — project registry.
// Projects are discovered from plan metadata (projectCode field).
// Admins can attach a display name to each code.
//
// KV key scheme:
//   projname:{code}  → { code, displayName, createdAt }
//
// GET  /api/projets            → discover all projects from metas + merge display names
// GET  /api/projets?code=xxx   → verify code exists, return project info
// POST /api/projets?code=xxx   body { displayName } → set/update display name
// DELETE /api/projets?code=xxx → remove display name record (data stays)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Content-Type": "application/json",
};
const resp = (obj, s = 200) =>
  new Response(JSON.stringify(obj), { status: s, headers: { ...CORS, "Cache-Control": "no-store" } });

export async function onRequestOptions() { return new Response("", { status: 200, headers: CORS }); }

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const kv = env.BIMFLOW;

    if (code) {
      // Verify a specific code exists in plan metadata
      const listed = await kv.list({ prefix: "meta:" });
      const metas = await Promise.all(listed.keys.map(k => kv.get(k.name, { type: "json" }).catch(() => null)));
      const match = metas.filter(Boolean).find(m => (m.projectCode || "") === code);
      if (!match) return resp({ error: "Code projet introuvable" }, 404);
      const nameRec = await kv.get("projname:" + code, { type: "json" }).catch(() => null);
      return resp({
        code, found: true,
        displayName: nameRec?.displayName || match.project || code,
        projectName: match.project,
        plans: metas.filter(Boolean).filter(m => m.projectCode === code).length,
      });
    }

    // Discover all projects from meta keys
    const listed = await kv.list({ prefix: "meta:" });
    const metas = await Promise.all(listed.keys.map(k => kv.get(k.name, { type: "json" }).catch(() => null)));
    const valid = metas.filter(Boolean);

    // Group by projectCode
    const byCode = {};
    valid.forEach(m => {
      const c = m.projectCode || "__legacy__";
      if (!byCode[c]) byCode[c] = { code: c, projectName: m.project || "", plans: 0, rooms: 0, lastDate: "" };
      byCode[c].plans++;
      byCode[c].rooms += m.rooms || 0;
      if ((m.date || "") > byCode[c].lastDate) byCode[c].lastDate = m.date || "";
    });

    // Merge display names from projname: keys
    const nameList = await kv.list({ prefix: "projname:" });
    const names = await Promise.all(nameList.keys.map(k => kv.get(k.name, { type: "json" }).catch(() => null)));
    names.filter(Boolean).forEach(n => {
      if (byCode[n.code]) byCode[n.code].displayName = n.displayName;
      else byCode[n.code] = { code: n.code, projectName: "", displayName: n.displayName, plans: 0, rooms: 0, lastDate: "" };
    });

    const projects = Object.values(byCode).sort((a, b) => b.lastDate.localeCompare(a.lastDate));
    return resp(projects);
  } catch (err) {
    return resp({ error: err.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    if (!code) return resp({ error: "code required" }, 400);
    const body = await request.json();
    const displayName = String(body.displayName || "").trim();
    if (!displayName) return resp({ error: "displayName required" }, 400);
    await env.BIMFLOW.put("projname:" + code, JSON.stringify({ code, displayName, updatedAt: new Date().toISOString() }));
    return resp({ ok: true, code, displayName });
  } catch (err) {
    return resp({ error: err.message }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    if (!code) return resp({ error: "code required" }, 400);
    await env.BIMFLOW.delete("projname:" + code);
    return resp({ ok: true });
  } catch (err) {
    return resp({ error: err.message }, 500);
  }
}
