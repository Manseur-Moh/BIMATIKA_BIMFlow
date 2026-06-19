// POST /api/auth/register  { name, email, password }
// Creates user in KV, sends confirmation email via Resend if API key is set,
// otherwise auto-confirms immediately.

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

    const kv   = env.BIMFLOW;
    const ekey = `bfuser:${email.toLowerCase()}`;

    if (await kv.get(ekey))
      return json({ error: "Cette adresse e-mail est déjà utilisée." }, 409);

    const passwordHash = await hashPw(password, email.toLowerCase());
    const now = new Date().toISOString();

    const origin = new URL(request.url).origin;
    const token  = crypto.randomUUID();

    // Determine if we can send email
    const hasResend = !!env.RESEND_API_KEY;
    let emailSent = false;

    if (hasResend) {
      // Store user as unconfirmed
      await kv.put(ekey, JSON.stringify({
        name, email: email.toLowerCase(), passwordHash,
        confirmed: false, plan: "free", createdAt: now,
      }));
      await kv.put(`bfconfirm:${token}`, email.toLowerCase(), { expirationTtl: 86400 });

      const confirmUrl = `${origin}/api/auth/confirm?token=${token}`;
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "BIMFlow <onboarding@resend.dev>",
            to: [email],
            subject: "✅ Confirmez votre compte BIMFlow",
            html: confirmHtml(name, confirmUrl),
          }),
        });
        emailSent = r.ok;
      } catch {}
    }

    if (!emailSent) {
      // Auto-confirm: store confirmed user + create session immediately
      const session = crypto.randomUUID();
      await kv.put(ekey, JSON.stringify({
        name, email: email.toLowerCase(), passwordHash,
        confirmed: true, plan: "free", createdAt: now,
      }));
      await kv.delete(`bfconfirm:${token}`);
      await kv.put(`bfsession:${session}`, email.toLowerCase(), { expirationTtl: 2592000 });

      return json({
        ok: true,
        autoConfirmed: true,
        session,
        user: { name, email: email.toLowerCase(), plan: "free" },
      });
    }

    return json({ ok: true, emailSent: true });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

async function hashPw(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    key, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function confirmHtml(name, url) {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0a1120;color:#e2e8f0;margin:0;padding:40px 16px">
  <div style="max-width:520px;margin:0 auto;background:#111827;border:1px solid #1f2937;border-radius:16px;padding:40px">
    <div style="font-size:22px;font-weight:900;color:#38bdf8;letter-spacing:-.5px;margin-bottom:4px">BIM<span style="color:#7dd3fc">Flow</span></div>
    <p style="color:#475569;font-size:12px;margin:0 0 28px">Plateforme BIM collaborative</p>
    <h2 style="font-size:18px;margin:0 0 12px;color:#f1f5f9">Bonjour ${name} 👋</h2>
    <p style="color:#94a3b8;line-height:1.6">Cliquez sur le bouton ci-dessous pour confirmer votre adresse e-mail et activer votre compte BIMFlow.</p>
    <a href="${url}" style="display:inline-block;margin:24px 0;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:10px;padding:14px 28px;font-size:15px;font-weight:700">
      ✅ Confirmer mon compte
    </a>
    <p style="font-size:12px;color:#475569;margin:0">Ce lien expire dans 24 heures. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>
  </div></body></html>`;
}
