// Cloudflare Pages Function — read/clear stored plans in KV (binding: BIMFLOW).
// GET    /api/plans                   → list ALL plans (admin) or empty (non-admin without code)
// GET    /api/plans?code=xxx          → list metadata for one project (requires access)
// GET    /api/plans?key=xxx           → full plan (with image) — key acts as token
// GET    /api/plans?key=xxx&light=1   → plan without the heavy base64 image
// DELETE /api/plans?code=xxx          → clear that project's plans (requires ownership or membership)
// DELETE /api/plans                   → clear ALL plans (admin only)
// PATCH  /api/plans?key=xxx           → update room parameters

const ADMIN = "archi_moh@live.fr";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, DELETE, PATCH, OPTIONS",
  "Content-Type": "application/json",
};
const NOCACHE = "no-store";
const resp    = (obj, extra = {}) => new Response(JSON.stringify(obj), { status: 200, headers: { ...CORS, ...extra } });
const respErr = (msg, s) => new Response(JSON.stringify({ error: msg }), { status: s, headers: CORS });

export async function onRequestOptions() { return new Response("", { status: 200, headers: CORS }); }

async function getSession(request, kv) {
  const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!auth) return null;
  const email = await kv.get("bfsession:" + auth);
  if (!email) return null;
  return { email: email.toLowerCase(), isAdmin: email.toLowerCase() === ADMIN };
}

async function hasProjectAccess(session, code, kv) {
  if (session.isAdmin) return true;
  const owner = (await kv.get("projowner:" + code) || ADMIN).toLowerCase();
  if (owner === session.email) return true;
  const membersJson = await kv.get("projmembers:" + code);
  if (!membersJson) return false;
  return JSON.parse(membersJson).includes(session.email);
}

export async function onRequestGet({ request, env }) {
  try {
    const url   = new URL(request.url);
    const key   = url.searchParams.get("key");
    const light = url.searchParams.get("light") === "1";
    const code  = (url.searchParams.get("code") || "").trim();
    const kv    = env.BIMFLOW;

    // ── Individual plan by key — key itself is the access token ──
    if (key) {
      const plan = await kv.get("plan:" + key, { type: "json" });
      if (!plan) return respErr("Not found", 404);
      if (light) { const { ImageBase64, ...rest } = plan; return resp(rest, { "Cache-Control": NOCACHE }); }
      return resp(plan, { "Cache-Control": NOCACHE });
    }

    // ── List endpoint — requires auth ──
    const session = await getSession(request, kv);
    if (!session) return resp([], { "Cache-Control": NOCACHE });

    if (code) {
      if (!await hasProjectAccess(session, code, kv)) {
        return resp([], { "Cache-Control": NOCACHE });
      }
    } else if (!session.isAdmin) {
      // Non-admin with no project code → nothing to show
      return resp([], { "Cache-Control": NOCACHE });
    }

    const project = url.searchParams.get("project");
    const listed  = await kv.list({ prefix: "meta:" });
    const metas   = await Promise.all(listed.keys.map(k => kv.get(k.name, { type: "json" }).catch(() => null)));
    const all     = metas.filter(Boolean);
    const index   = all
      .filter(m => {
        if (code)    return (m.projectCode || "") === code;
        if (project) return (m.project || "") === project;
        return true;
      })
      .sort((a, b) => (a.level || "").localeCompare(b.level || ""));
    return resp(index, { "Cache-Control": NOCACHE });
  } catch (err) {
    return respErr(err.message, 500);
  }
}

// Patch room parameters — key acts as the access token
export async function onRequestPatch({ request, env }) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (!key) return respErr("key required", 400);
    const kv   = env.BIMFLOW;
    const body = await request.json();
    const plan = await kv.get("plan:" + key, { type: "json" });
    if (!plan) return respErr("Not found", 404);
    const updates = body.rooms || {};
    let changed = 0;
    (plan.Rooms || []).forEach(room => {
      const upd = updates[String(room.RevitId)];
      if (!upd) return;
      if (upd.Parameters) Object.assign(room.Parameters = room.Parameters || {}, upd.Parameters);
      if (upd.Number !== undefined) room.Number = upd.Number;
      if (upd.Name   !== undefined) room.Name   = upd.Name;
      changed++;
    });
    await kv.put("plan:" + key, JSON.stringify(plan));
    return resp({ ok: true, changed });
  } catch (err) {
    return respErr(err.message, 500);
  }
}

// Wipe plans — admin can wipe all; owner/member can wipe their project
export async function onRequestDelete({ request, env }) {
  try {
    const url     = new URL(request.url);
    const code    = (url.searchParams.get("code") || "").trim();
    const project = url.searchParams.get("project");
    const kv      = env.BIMFLOW;

    const session = await getSession(request, kv);
    if (!session) return respErr("Non authentifié", 401);

    if (code && !session.isAdmin) {
      if (!await hasProjectAccess(session, code, kv)) return respErr("Non autorisé", 403);
    } else if (!code && !project && !session.isAdmin) {
      return respErr("Non autorisé", 403);
    }

    let cursor, removed = 0;
    if (project || code) {
      do {
        const listed = await kv.list({ prefix: "meta:", cursor });
        for (const k of listed.keys) {
          const meta = await kv.get(k.name, { type: "json" }).catch(() => null);
          const match = meta && (
            (code    && (meta.projectCode || "") === code) ||
            (project && (meta.project || "") === project && !meta.projectCode)
          );
          if (match) { await kv.delete("plan:" + meta.key); await kv.delete("meta:" + meta.key); removed++; }
        }
        cursor = listed.list_complete ? null : listed.cursor;
      } while (cursor);
      return resp({ ok: true, removed, project, code });
    }

    // Admin wipe-all
    do {
      const listed = await kv.list({ cursor });
      for (const k of listed.keys) {
        if (k.name.startsWith("plan:") || k.name.startsWith("meta:")) { await kv.delete(k.name); removed++; }
      }
      cursor = listed.list_complete ? null : listed.cursor;
    } while (cursor);
    return resp({ ok: true, removed });
  } catch (err) {
    return respErr(err.message, 500);
  }
}
