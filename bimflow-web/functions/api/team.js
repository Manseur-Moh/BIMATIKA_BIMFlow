// Team management for BIMFlow projects.
//
// KV key: projmembers:{code} → JSON array of lowercase email strings
//
// GET    /api/team?code=xxx             → { owner, members } (owner or admin)
// POST   /api/team?code=xxx  { email } → add a member (owner or admin)
// DELETE /api/team?code=xxx&email=yyy  → remove a member (owner or admin)

const ADMIN = "archi_moh@live.fr";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Content-Type": "application/json",
};
const resp    = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Cache-Control": "no-store" } });
const respErr = (msg, s)     => resp({ error: msg }, s);

export async function onRequestOptions() { return new Response("", { status: 200, headers: CORS }); }

async function getSession(request, kv) {
  const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!auth) return null;
  const email = await kv.get("bfsession:" + auth);
  if (!email) return null;
  return { email: email.toLowerCase(), isAdmin: email.toLowerCase() === ADMIN };
}

async function canManage(session, code, kv) {
  if (session.isAdmin) return true;
  const owner = (await kv.get("projowner:" + code) || ADMIN).toLowerCase();
  return owner === session.email;
}

async function getMembers(code, kv) {
  const raw = await kv.get("projmembers:" + code);
  return raw ? JSON.parse(raw) : [];
}

export async function onRequestGet({ request, env }) {
  try {
    const kv      = env.BIMFLOW;
    const session = await getSession(request, kv);
    if (!session) return respErr("Non authentifié", 401);

    const code = new URL(request.url).searchParams.get("code");
    if (!code) return respErr("code required", 400);

    if (!await canManage(session, code, kv)) return respErr("Non autorisé", 403);

    const owner   = (await kv.get("projowner:" + code) || ADMIN).toLowerCase();
    const members = await getMembers(code, kv);
    return resp({ owner, members });
  } catch (err) {
    return respErr(err.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const kv      = env.BIMFLOW;
    const session = await getSession(request, kv);
    if (!session) return respErr("Non authentifié", 401);

    const url  = new URL(request.url);
    const code = url.searchParams.get("code");
    if (!code) return respErr("code required", 400);

    if (!await canManage(session, code, kv)) return respErr("Non autorisé", 403);

    const body  = await request.json();
    const email = String(body.email || "").toLowerCase().trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return respErr("Adresse e-mail invalide.", 400);

    // Don't add the project owner as a member
    const owner = (await kv.get("projowner:" + code) || ADMIN).toLowerCase();
    if (email === owner) return respErr("Cette personne est déjà propriétaire du projet.", 400);

    const members = await getMembers(code, kv);
    if (members.includes(email)) return resp({ ok: true, alreadyMember: true });

    members.push(email);
    await kv.put("projmembers:" + code, JSON.stringify(members));

    // Check if the invited user has a BIMFlow account
    const userExists = !!(await kv.get("bfuser:" + email));

    // Send invitation email if Resend is configured
    if (env.RESEND_API_KEY) {
      const projname = (await kv.get("projname:" + code, { type: "json" }).catch(() => null))?.displayName || code;
      const appUrl   = new URL(request.url).origin;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "BIMFlow <onboarding@resend.dev>",
          to:   [email],
          subject: `Invitation à collaborer sur le projet "${projname}"`,
          html: inviteHtml(projname, session.email, appUrl, userExists),
        }),
      }).catch(() => {});
    }

    return resp({ ok: true, userExists });
  } catch (err) {
    return respErr(err.message, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const kv      = env.BIMFLOW;
    const session = await getSession(request, kv);
    if (!session) return respErr("Non authentifié", 401);

    const url    = new URL(request.url);
    const code   = url.searchParams.get("code");
    const target = url.searchParams.get("email")?.toLowerCase().trim();
    if (!code)   return respErr("code required", 400);
    if (!target) return respErr("email required", 400);

    if (!await canManage(session, code, kv)) return respErr("Non autorisé", 403);

    const members = await getMembers(code, kv);
    const updated = members.filter(e => e !== target);
    await kv.put("projmembers:" + code, JSON.stringify(updated));
    return resp({ ok: true, removed: members.length - updated.length });
  } catch (err) {
    return respErr(err.message, 500);
  }
}

function inviteHtml(projectName, invitedBy, appUrl, userExists) {
  const actionUrl = userExists ? appUrl : `${appUrl}/accueil.html`;
  const actionLabel = userExists ? "Accéder au projet" : "Créer mon compte BIMFlow";
  const actionNote  = userExists
    ? "Connectez-vous à BIMFlow et le projet apparaîtra automatiquement dans votre liste."
    : "Créez votre compte gratuit, puis le projet sera disponible dès votre première connexion.";

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invitation BIMFlow</title></head>
<body style="margin:0;padding:0;background:#060d18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#060d18;padding:40px 16px">
<tr><td align="center">
<table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%">
  <tr><td style="padding:0 0 28px">
    <span style="font-size:26px;font-weight:900;color:#38bdf8">BIM</span><span style="font-size:26px;font-weight:900;color:#7dd3fc">Flow</span>
    <span style="display:block;font-size:11px;color:#475569;margin-top:2px">BIMATIKA · Plateforme BIM collaborative</span>
  </td></tr>
  <tr><td style="background:#0f1f3a;border:1px solid #1e3a5f;border-radius:16px;padding:40px 36px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#38bdf8;text-transform:uppercase;letter-spacing:.08em">Invitation à collaborer</p>
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f5f9">📁 ${_esc(projectName)}</h1>
    <p style="margin:0 0 28px;font-size:15px;color:#94a3b8;line-height:1.7">
      <b style="color:#e2e8f0">${_esc(invitedBy)}</b> vous a invité(e) à collaborer sur ce projet BIM.<br>
      ${actionNote}
    </p>
    <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:linear-gradient(135deg,#1d4ed8,#0ea5e9)">
      <a href="${actionUrl}" style="display:inline-block;padding:16px 36px;font-size:16px;font-weight:800;color:#fff;text-decoration:none;border-radius:12px">
        👥 ${actionLabel}
      </a>
    </td></tr></table>
    <p style="margin:28px 0 0;font-size:12px;color:#475569;line-height:1.6">
      Si vous n'attendiez pas cette invitation, ignorez cet e-mail.
    </p>
  </td></tr>
  <tr><td style="padding:20px 0 0;text-align:center;font-size:11px;color:#334155">
    BIMFlow · BIMATIKA &nbsp;|&nbsp; E-mail automatique, ne pas répondre.
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function _esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
