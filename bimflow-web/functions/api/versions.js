// Cloudflare Pages Function — version snapshots stored in KV (binding: BIMFLOW).
// KV key scheme:
//   ver:{planKey}:{isoTs}  → { label, rooms: {id: {Number,Name,P:{...}}} }
//   verbatch:{isoTs}       → { label, planKeys: [...] }   (for all-project snapshots)
//
// GET  /api/versions?key=xxx          → [{ts, label}, ...]   list for one plan
// GET  /api/versions?key=xxx&ts=yyy   → {rooms}              one snapshot
// GET  /api/versions?all=1            → [{ts, label, planKeys:[...]}]  batch list
// POST /api/versions?key=xxx          body {ts,label,rooms}  → {ok:true}
// POST /api/versions?batch=1          body {ts,label,plans:[{key,rooms},...]} → {ok:true,n}
// DELETE /api/versions?key=xxx&ts=yyy → {ok:true}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Content-Type": "application/json",
};
const resp = (obj, s=200) => new Response(JSON.stringify(obj), { status: s, headers: { ...CORS, "Cache-Control": "no-store" } });

export async function onRequestOptions() { return new Response("", { status: 200, headers: CORS }); }

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    const ts  = url.searchParams.get("ts");
    const all = url.searchParams.get("all") === "1";
    const kv  = env.BIMFLOW;

    if (all) {
      // List all batch snapshots
      const listed = await kv.list({ prefix: "verbatch:" });
      const batches = await Promise.all(listed.keys.map(k => kv.get(k.name, { type: "json" }).catch(() => null)));
      return resp(batches.filter(Boolean).sort((a, b) => b.ts.localeCompare(a.ts)));
    }
    if (!key) return resp({ error: "key required" }, 400);
    if (ts) {
      // Fetch one snapshot's rooms
      const data = await kv.get("ver:" + key + ":" + ts, { type: "json" });
      if (!data) return resp({ error: "Not found" }, 404);
      return resp(data);
    }
    // List snapshots for one plan
    const listed = await kv.list({ prefix: "ver:" + key + ":" });
    const metas = listed.keys.map(k => {
      const isoTs = k.name.slice(("ver:" + key + ":").length);
      return { ts: isoTs };
    });
    // Fetch labels (small objects — or parse from KV metadata if set)
    const full = await Promise.all(metas.map(async m => {
      const d = await kv.get("ver:" + key + ":" + m.ts, { type: "json" }).catch(() => null);
      return d ? { ts: m.ts, label: d.label || m.ts } : null;
    }));
    return resp(full.filter(Boolean).sort((a, b) => b.ts.localeCompare(a.ts)));
  } catch (err) {
    return resp({ error: err.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const url  = new URL(request.url);
    const key  = url.searchParams.get("key");
    const batch = url.searchParams.get("batch") === "1";
    const kv   = env.BIMFLOW;
    const body = await request.json();

    if (batch) {
      // Save snapshot for ALL levels at once
      const { ts, label, plans } = body;
      if (!ts || !plans?.length) return resp({ error: "ts and plans required" }, 400);
      const planKeys = [];
      for (const p of plans) {
        await kv.put("ver:" + p.key + ":" + ts, JSON.stringify({ label, rooms: p.rooms }));
        planKeys.push(p.key);
      }
      // Write/update batch index
      await kv.put("verbatch:" + ts, JSON.stringify({ ts, label, planKeys }));
      return resp({ ok: true, n: plans.length });
    }

    if (!key) return resp({ error: "key required" }, 400);
    const { ts, label, rooms } = body;
    if (!ts || !rooms) return resp({ error: "ts, label, rooms required" }, 400);
    await kv.put("ver:" + key + ":" + ts, JSON.stringify({ label, rooms }));
    return resp({ ok: true });
  } catch (err) {
    return resp({ error: err.message }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    const ts  = url.searchParams.get("ts");
    const kv  = env.BIMFLOW;
    if (!key || !ts) return resp({ error: "key and ts required" }, 400);
    await kv.delete("ver:" + key + ":" + ts);
    // Remove from batch index if it exists
    const batch = await kv.get("verbatch:" + ts, { type: "json" }).catch(() => null);
    if (batch) {
      batch.planKeys = batch.planKeys.filter(k => k !== key);
      if (batch.planKeys.length) await kv.put("verbatch:" + ts, JSON.stringify(batch));
      else await kv.delete("verbatch:" + ts);
    }
    return resp({ ok: true });
  } catch (err) {
    return resp({ error: err.message }, 500);
  }
}
