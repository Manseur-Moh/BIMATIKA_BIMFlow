// GET /api/auth/confirm?token=xxx
// Activates the user account, creates a session, redirects to the app.

export async function onRequestGet({ request, env }) {
  const url   = new URL(request.url);
  const token = url.searchParams.get("token");

  const errorPage = (msg) =>
    new Response(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0a1120;color:#e2e8f0;
      display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px">
      <div style="font-size:40px">❌</div>
      <h2 style="color:#f87171;margin:0">${msg}</h2>
      <a href="/accueil.html" style="color:#38bdf8;font-size:14px">← Retour à l'accueil</a>
      </body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } }
    );

  if (!token) return errorPage("Token manquant.");

  const kv    = env.BIMFLOW;
  const email = await kv.get(`bfconfirm:${token}`);
  if (!email)  return errorPage("Lien invalide ou expiré (24 h max).");

  const userJson = await kv.get(`bfuser:${email}`);
  if (!userJson) return errorPage("Utilisateur introuvable.");

  const user    = JSON.parse(userJson);
  user.confirmed = true;
  await kv.put(`bfuser:${email}`, JSON.stringify(user));
  await kv.delete(`bfconfirm:${token}`);

  const session = crypto.randomUUID();
  await kv.put(`bfsession:${session}`, email, { expirationTtl: 2592000 });

  const payload = encodeURIComponent(JSON.stringify({
    session,
    name:  user.name,
    email: user.email,
    plan:  user.plan || "free",
  }));

  return Response.redirect(`${url.origin}/?bfauth=${payload}`, 302);
}
