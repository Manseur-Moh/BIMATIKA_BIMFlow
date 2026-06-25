// POST /api/auth/login  { email, password }
// Checks Supabase public.users first; falls back to KV and auto-migrates on success.
import { getSupabase } from '../_supabase.js';

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
    const { email, password } = await request.json();
    if (!email || !password)
      return json({ error: "Email et mot de passe requis." }, 400);

    const kv      = env.BIMFLOW;
    const sb      = getSupabase(env);
    const emailLC = email.toLowerCase();

    let user = null;

    // 1. Check Supabase
    const { data: sbUser } = await sb.from('users').select('*').eq('email', emailLC).maybeSingle();
    if (sbUser) {
      user = { email: sbUser.email, name: sbUser.name, password_hash: sbUser.password_hash, confirmed: sbUser.confirmed, plan: sbUser.plan };
    } else {
      // 2. Fallback: KV (auto-migrate to Supabase on success)
      const userJson = await kv.get(`bfuser:${emailLC}`);
      if (userJson) {
        const kv_user = JSON.parse(userJson);
        const now     = new Date().toISOString();
        await sb.from('users').upsert({
          email:         emailLC,
          name:          kv_user.name || '',
          password_hash: kv_user.passwordHash || '',
          plan:          kv_user.plan || 'free',
          confirmed:     kv_user.confirmed || false,
          created_at:    kv_user.createdAt || now,
          updated_at:    now,
        }, { onConflict: 'email' });
        user = { email: emailLC, name: kv_user.name, password_hash: kv_user.passwordHash, confirmed: kv_user.confirmed, plan: kv_user.plan || 'free' };
      }
    }

    if (!user) return json({ error: "Email ou mot de passe incorrect." }, 401);
    if (!user.confirmed) return json({ error: "Compte non confirmé — vérifiez votre boîte mail et cliquez le lien." }, 403);

    const hash = await hashPw(password, emailLC);
    if (hash !== user.password_hash) return json({ error: "Email ou mot de passe incorrect." }, 401);

    const session = crypto.randomUUID();
    await kv.put(`bfsession:${session}`, emailLC, { expirationTtl: 2592000 });

    return json({
      ok: true,
      session,
      user: { name: user.name, email: user.email, plan: user.plan || "free" },
    });
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
