// GET /api/auth/confirm?token=xxx
// Activates the user account (Supabase + KV fallback), creates a session, redirects.
import { getSupabase } from '../_supabase.js';

export async function onRequestGet({ request, env }) {
  const url   = new URL(request.url);
  const token = url.searchParams.get("token");

  const errorPage = (msg) =>
    new Response(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0a1120;color:#e2e8f0;
      display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px">
      <div style="font-size:40px">❌</div><h2 style="color:#f87171;margin:0">${msg}</h2>
      <a href="/accueil.html" style="color:#38bdf8;font-size:14px">← Retour à l'accueil</a>
      </body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } }
    );

  if (!token) return errorPage("Token manquant.");

  const kv    = env.BIMFLOW;
  const sb    = getSupabase(env);
  const email = await kv.get(`bfconfirm:${token}`);
  if (!email) return errorPage("Lien invalide ou expiré (24 h max).");

  // Mark confirmed in Supabase
  await sb.from('users').update({ confirmed: true, updated_at: new Date().toISOString() }).eq('email', email);

  // Also update KV legacy record if it still exists
  const userJson = await kv.get(`bfuser:${email}`);
  if (userJson) {
    try { const u = JSON.parse(userJson); u.confirmed = true; await kv.put(`bfuser:${email}`, JSON.stringify(u)); } catch {}
  }

  await kv.delete(`bfconfirm:${token}`);

  // Get user details for redirect payload
  const { data: userData } = await sb.from('users').select('name, plan').eq('email', email).maybeSingle();
  const name = userData?.name || email;
  const plan = userData?.plan || 'free';

  const session = crypto.randomUUID();
  await kv.put(`bfsession:${session}`, email, { expirationTtl: 2592000 });

  const payload = encodeURIComponent(JSON.stringify({ session, name, email, plan }));
  return Response.redirect(`${url.origin}/?bfauth=${payload}`, 302);
}
