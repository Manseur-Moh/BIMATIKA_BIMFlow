// POST /api/auth/login  { email, password }
// Verifies credentials, creates session, returns user info.

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

    const kv       = env.BIMFLOW;
    const userJson = await kv.get(`bfuser:${email.toLowerCase()}`);
    if (!userJson)
      return json({ error: "Email ou mot de passe incorrect." }, 401);

    const user = JSON.parse(userJson);

    if (!user.confirmed)
      return json({ error: "Compte non confirmé — vérifiez votre boîte mail et cliquez le lien." }, 403);

    const hash = await hashPw(password, email.toLowerCase());
    if (hash !== user.passwordHash)
      return json({ error: "Email ou mot de passe incorrect." }, 401);

    const session = crypto.randomUUID();
    await kv.put(`bfsession:${session}`, email.toLowerCase(), { expirationTtl: 2592000 });

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
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    key, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
}
