// POST /api/auth/register  { name, email, password }
//
// Setup Resend (free — 3 000 emails/mois):
//   1. Créer un compte sur resend.com
//   2. Settings → API Keys → créer une clé
//   3. Cloudflare Pages → Settings → Environment variables → ajouter:
//      RESEND_API_KEY = re_xxxxxxxxxxxxxxxxxxxx
//   4. (Optionnel) Ajouter votre domaine dans Resend pour envoyer depuis
//      noreply@bimatika.fr — sans ça l'email vient de onboarding@resend.dev

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

    const kv       = env.BIMFLOW;
    const emailLC  = email.toLowerCase();
    const isAdmin  = emailLC === ADMIN;
    const ekey     = `bfuser:${emailLC}`;
    const isLocal  = new URL(request.url).hostname === "localhost";

    if (await kv.get(ekey))
      return json({ error: "Cette adresse e-mail est déjà utilisée." }, 409);

    const passwordHash = await hashPw(password, emailLC);
    const now          = new Date().toISOString();
    const origin       = new URL(request.url).origin;
    const token        = crypto.randomUUID();

    // Admin + dev always auto-confirm; everyone else must click the email link
    if (isAdmin || isLocal) {
      const session = crypto.randomUUID();
      await kv.put(ekey, JSON.stringify({
        name, email: emailLC, passwordHash,
        confirmed: true, plan: "free", createdAt: now,
      }));
      await kv.put(`bfsession:${session}`, emailLC, { expirationTtl: 2592000 });
      return json({ ok: true, autoConfirmed: true, session, user: { name, email: emailLC, plan: "free" } });
    }

    // Production non-admin: require email confirmation
    if (!env.RESEND_API_KEY) {
      return json({
        error: "Le service d'envoi d'emails n'est pas configuré. Contactez l'administrateur.",
      }, 503);
    }

    // Store user as pending confirmation
    await kv.put(ekey, JSON.stringify({
      name, email: emailLC, passwordHash,
      confirmed: false, plan: "free", createdAt: now,
    }));
    await kv.put(`bfconfirm:${token}`, emailLC, { expirationTtl: 86400 });

    const confirmUrl = `${origin}/api/auth/confirm?token=${token}`;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "BIMFlow <onboarding@resend.dev>",
        to: [email],
        subject: "Confirmez votre compte BIMFlow",
        html: confirmHtml(name, confirmUrl),
      }),
    });

    if (!r.ok) {
      const err = await r.text().catch(() => "");
      // Roll back the pending user so they can retry
      await kv.delete(ekey);
      await kv.delete(`bfconfirm:${token}`);
      return json({ error: `Impossible d'envoyer l'email de confirmation. (${err.substring(0, 120)})` }, 502);
    }

    return json({ ok: true, emailSent: true });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

async function hashPw(password, salt) {
  const enc = new TextEncoder();
  const key  = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    key, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function confirmHtml(name, url) {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Confirmez votre compte BIMFlow</title></head>
<body style="margin:0;padding:0;background:#060d18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#060d18;padding:40px 16px">
<tr><td align="center">
<table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%">
  <!-- LOGO -->
  <tr><td style="padding:0 0 28px">
    <span style="font-size:26px;font-weight:900;color:#38bdf8;letter-spacing:-.5px">BIM</span><span style="font-size:26px;font-weight:900;color:#7dd3fc;letter-spacing:-.5px">Flow</span>
    <span style="display:block;font-size:11px;color:#475569;margin-top:2px;letter-spacing:.05em">BIMATIKA · Plateforme BIM collaborative</span>
  </td></tr>
  <!-- CARD -->
  <tr><td style="background:#0f1f3a;border:1px solid #1e3a5f;border-radius:16px;padding:40px 36px">
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f5f9">Bonjour ${_esc(name)} 👋</h1>
    <p style="margin:0 0 28px;font-size:15px;color:#94a3b8;line-height:1.7">
      Bienvenue sur <b style="color:#7dd3fc">BIMFlow</b> — votre espace de gestion de plans BIM.<br>
      Cliquez sur le bouton ci-dessous pour activer votre compte et commencer à collaborer.
    </p>
    <!-- CTA -->
    <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:linear-gradient(135deg,#1d4ed8,#0ea5e9)">
      <a href="${url}" style="display:inline-block;padding:16px 36px;font-size:16px;font-weight:800;color:#fff;text-decoration:none;border-radius:12px;letter-spacing:.01em">
        ✅ Confirmer mon compte
      </a>
    </td></tr></table>
    <!-- Security note -->
    <p style="margin:28px 0 0;font-size:12px;color:#475569;line-height:1.6">
      Ce lien expire dans <b style="color:#64748b">24 heures</b>.<br>
      Si vous n'avez pas créé de compte BIMFlow, ignorez cet e-mail en toute sécurité.
    </p>
  </td></tr>
  <!-- FOOTER -->
  <tr><td style="padding:20px 0 0;text-align:center;font-size:11px;color:#334155">
    BIMFlow · BIMATIKA &nbsp;|&nbsp; Cet e-mail a été envoyé automatiquement, ne pas répondre.
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
