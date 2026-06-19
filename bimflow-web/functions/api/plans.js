// Cloudflare Pages Function — read/clear stored plans in KV (binding: BIMFLOW).
// GET    /api/plans                   → list ALL projects metadata (for project list page)
// GET    /api/plans?project=xxx       → list metadata for one project
// GET    /api/plans?key=xxx           → full plan (with image)
// GET    /api/plans?key=xxx&light=1   → plan without the heavy base64 image
// DELETE /api/plans?project=xxx       → clear only that project's plans + metadata
// DELETE /api/plans                   → clear ALL plans + metadata

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, DELETE, PATCH, OPTIONS",
  "Content-Type": "application/json",
};
const NOCACHE = "no-store";
const resp = (obj, extra = {}) => new Response(JSON.stringify(obj), { status: 200, headers: { ...CORS, ...extra } });

export async function onRequestOptions() { return new Response("", { status: 200, headers: CORS }); }

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    const light = url.searchParams.get("light") === "1";
    const project = url.searchParams.get("project"); // optional project filter
    const kv = env.BIMFLOW;

    // Fetch a specific plan by key
    if (key) {
      const plan = await kv.get("plan:" + key, { type: "json" });
      if (!plan) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
      if (light) { const { ImageBase64, ...rest } = plan; return resp(rest, { "Cache-Control": NOCACHE }); }
      return resp(plan, { "Cache-Control": NOCACHE });
    }

    const code = (url.searchParams.get("code") || "").trim(); // filter by projectCode
    // List all metas (optionally filtered by project name or project code)
    const listed = await kv.list({ prefix: "meta:" });
    const metas = await Promise.all(listed.keys.map((k) => kv.get(k.name, { type: "json" }).catch(() => null)));
    const all = metas.filter(Boolean);
    const index = all
      .filter(m => {
        if (code) return (m.projectCode || "") === code;
        if (project) return (m.project || "") === project;
        return true;
      })
      .sort((a, b) => (a.level || "").localeCompare(b.level || ""));
    return resp(index, { "Cache-Control": NOCACHE });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}

// Patch room parameters for a stored plan.
// PATCH /api/plans?key=xxx  body: { rooms: { revitId: { Parameters:{k:v,...}, Number?, Name? } } }
export async function onRequestPatch({ request, env }) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (!key) return new Response(JSON.stringify({ error: "key required" }), { status: 400, headers: CORS });
    const kv = env.BIMFLOW;
    const body = await request.json();
    const plan = await kv.get("plan:" + key, { type: "json" });
    if (!plan) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
    const updates = body.rooms || {};
    let changed = 0;
    (plan.Rooms || []).forEach(room => {
      const upd = updates[String(room.RevitId)];
      if (!upd) return;
      if (upd.Parameters) Object.assign(room.Parameters = room.Parameters || {}, upd.Parameters);
      if (upd.Number !== undefined) room.Number = upd.Number;
      if (upd.Name !== undefined) room.Name = upd.Name;
      changed++;
    });
    await kv.put("plan:" + key, JSON.stringify(plan));
    return resp({ ok: true, changed });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}

// Wipe plans + meta keys — scoped to one project if ?project= is given.
export async function onRequestDelete({ request, env }) {
  try {
    const url = new URL(request.url);
    const project = url.searchParams.get("project");
    const kv = env.BIMFLOW;
    let cursor, removed = 0;

    const code = (url.searchParams.get("code") || "").trim(); // delete by project code
    if (project || code) {
      // Scoped delete: only remove keys belonging to this project.
      do {
        const listed = await kv.list({ prefix: "meta:", cursor });
        for (const k of listed.keys) {
          const meta = await kv.get(k.name, { type: "json" }).catch(() => null);
          const match = meta && (
            (code && (meta.projectCode || "") === code) ||
            (project && (meta.project || "") === project && !meta.projectCode)
          );
          if (match) {
            await kv.delete("plan:" + meta.key);
            await kv.delete("meta:" + meta.key);
            removed++;
          }
        }
        cursor = listed.list_complete ? null : listed.cursor;
      } while (cursor);
      return resp({ ok: true, removed, project, code });
    }

    // No project filter → wipe everything (backwards compat)
    do {
      const listed = await kv.list({ cursor });
      for (const k of listed.keys) {
        if (k.name.startsWith("plan:") || k.name.startsWith("meta:")) { await kv.delete(k.name); removed++; }
      }
      cursor = listed.list_complete ? null : listed.cursor;
    } while (cursor);
    return resp({ ok: true, removed });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
