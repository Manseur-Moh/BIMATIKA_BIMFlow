// POST /api/auth/register  { name, email, password }
// Users are stored in Supabase public.users (migrated from KV).
import { getSupabase } from '../_supabase.js';

const ADMIN = "archi_moh@live.fr";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

export async function onRequestOptions() {
  return new Response("", { status: 200, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  try {
    const { name, email, password } = await request.json();

    if (!name || !email || !password)
      return json({ error: "Champs manquants." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return json({ error: "Adresse e-mail invalide." }, 400);
    if (password.length < 8)
      return json({ error: "Mot de passe trop court (8 caractères minimum)." }, 400);

    const kv      = env.BIMFLOW;
    const sb      = getSupabase(env);
    const emailLC = email.toLowerCase();
    const isAdmin = emailLC === ADMIN;
    const isLocal = new URL(request.url).hostname === "localhost";

    // Check existing user — Supabase first, then KV (legacy)
    const { data: existing } = await sb.from('users').select('email').eq('email', emailLC).maybeSingle();
    if (existing) return json({ error: "Cette adresse e-mail est déjà utilisée." }, 409);
    if (await kv.get(`bfuser:${emailLC}`)) return json({ error: "Cette adresse e-mail est déjà utilisée." }, 409);

    const passwordHash = await hashPw(password, emailLC);
    const now          = new Date().toISOString();
    const autoConfirm  = isAdmin || isLocal || !env.RESEND_API_KEY;

    const { error: insErr } = await sb.from('users').insert({
      email: emailLC, name, password_hash: passwordHash,
      plan: 'free', confirmed: autoConfirm,
      created_at: now, updated_at: now,
    });
    if (insErr) throw insErr;

    if (autoConfirm) {
      const session = crypto.randomUUID();
      await kv.put(`bfsession:${session}`, emailLC, { expirationTtl: 2592000 });
      return json({ ok: true, autoConfirmed: true, session, user: { name, email: emailLC, plan: "free" } });
    }

    // Send confirmation email via Resend
    const token  = crypto.randomUUID();
    const origin = new URL(request.url).origin;
    await kv.put(`bfconfirm:${token}`, emailLC, { expirationTtl: 86400 });

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "onboarding@resend.dev",
        to: [email],
        subject: "Confirmez votre compte BIMFlow",
        html: confirmHtml(name, `${origin}/api/auth/confirm?token=${token}`),
      }),
    });

    if (!r.ok) {
      // Resend failed — auto-confirm so registration still works
      await sb.from('users').update({ confirmed: true, updated_at: new Date().toISOString() }).eq('email', emailLC);
      await kv.delete(`bfconfirm:${token}`);
      const session = crypto.randomUUID();
      await kv.put(`bfsession:${session}`, emailLC, { expirationTtl: 2592000 });
      return json({ ok: true, autoConfirmed: true, emailFailed: true, session, user: { name, email: emailLC, plan: "free" } });
    }

    return json({ ok: true, emailSent: true });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

async function hashPw(password, salt) {
  const enc  = new TextEncoder();
  const key  = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    key, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function confirmHtml(name, url) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirmez votre compte BIMFlow</title></head>
<body style="margin:0;padding:0;background:#060d18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#060d18;padding:40px 16px"><tr><td align="center">
<table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%">
  <tr><td style="padding:0 0 28px"><span style="font-size:26px;font-weight:900;color:#38bdf8">BIM</span><span style="font-size:26px;font-weight:900;color:#7dd3fc">Flow</span>
    <span style="display:block;font-size:11px;color:#475569;margin-top:2px">BIMATIKA · Plateforme BIM collaborative</span></td></tr>
  <tr><td style="background:#0f1f3a;border:1px solid #1e3a5f;border-radius:16px;padding:40px 36px">
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f5f9">Bonjour ${_esc(name)} 👋</h1>
    <p style="margin:0 0 28px;font-size:15px;color:#94a3b8;line-height:1.7">Bienvenue sur <b style="color:#7dd3fc">BIMFlow</b> — votre espace de gestion de plans BIM.<br>Cliquez ci-dessous pour activer votre compte.</p>
    <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:linear-gradient(135deg,#1d4ed8,#0ea5e9)">
      <a href="${url}" style="display:inline-block;padding:16px 36px;font-size:16px;font-weight:800;color:#fff;text-decoration:none;border-radius:12px">✅ Confirmer mon compte</a>
    </td></tr></table>
    <p style="margin:28px 0 0;font-size:12px;color:#475569;line-height:1.6">Ce lien expire dans <b style="color:#64748b">24 heures</b>.</p>
  </td></tr>
  <tr><td style="padding:20px 0 0;text-align:center;font-size:11px;color:#334155">BIMFlow · BIMATIKA &nbsp;|&nbsp; E-mail automatique, ne pas répondre.</td></tr>
</table></td></tr></table></body></html>`;
}

function _esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
