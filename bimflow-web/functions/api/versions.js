import { getSupabase } from './_supabase.js';

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
    const sb  = getSupabase(env);

    if (all) {
      // Lister tous les snapshots batch
      const { data, error } = await sb
        .from('versions')
        .select('snapshot_ts, label, plan_keys')
        .eq('is_batch', true)
        .order('snapshot_ts', { ascending: false });

      if (error) throw error;

      const batches = data.map(d => ({
        ts: d.snapshot_ts,
        label: d.label,
        planKeys: d.plan_keys || []
      }));

      return resp(batches);
    }

    if (!key) return resp({ error: "key required" }, 400);

    if (ts) {
      // Récupérer un snapshot spécifique d'un plan
      const { data, error } = await sb
        .from('versions')
        .select('rooms_data, label')
        .eq('plan_key', key)
        .eq('snapshot_ts', ts)
        .maybeSingle();

      if (error) throw error;
      if (!data) return resp({ error: "Not found" }, 404);

      return resp({
        label: data.label,
        rooms: data.rooms_data
      });
    }

    // Lister les snapshots pour un plan donné
    const { data, error } = await sb
      .from('versions')
      .select('snapshot_ts, label')
      .eq('plan_key', key)
      .eq('is_batch', false)
      .order('snapshot_ts', { ascending: false });

    if (error) throw error;

    const metas = data.map(d => ({
      ts: d.snapshot_ts,
      label: d.label || d.snapshot_ts
    }));

    return resp(metas);
  } catch (err) {
    return resp({ error: err.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const url  = new URL(request.url);
    const key  = url.searchParams.get("key");
    const batch = url.searchParams.get("batch") === "1";
    const sb   = getSupabase(env);
    const body = await request.json();

    if (batch) {
      const { ts, label, plans } = body;
      if (!ts || !plans?.length) return resp({ error: "ts and plans required" }, 400);
      const planKeys = [];

      // Insérer les snapshots individuels de chaque plan du batch
      const rows = plans.map(p => {
        planKeys.push(p.key);
        // Extraire project_code si présent dans la clé (format code__niveau)
        const parts = p.key.split('__');
        const projCode = parts.length > 1 ? parts[0] : null;

        return {
          plan_key: p.key,
          project_code: projCode,
          snapshot_ts: ts,
          label: label,
          rooms_data: p.rooms,
          is_batch: false
        };
      });

      const { error: batchRowsErr } = await sb
        .from('versions')
        .insert(rows);

      if (batchRowsErr) throw batchRowsErr;

      // Créer la ligne d'index batch
      const partsFirst = plans[0].key.split('__');
      const projCode = partsFirst.length > 1 ? partsFirst[0] : null;

      const { error: batchIndexErr } = await sb
        .from('versions')
        .insert({
          plan_key: null,
          project_code: projCode,
          snapshot_ts: ts,
          label: label,
          is_batch: true,
          plan_keys: planKeys
        });

      if (batchIndexErr) throw batchIndexErr;

      return resp({ ok: true, n: plans.length });
    }

    if (!key) return resp({ error: "key required" }, 400);
    const { ts, label, rooms } = body;
    if (!ts || !rooms) return resp({ error: "ts, label, rooms required" }, 400);

    const parts = key.split('__');
    const projCode = parts.length > 1 ? parts[0] : null;

    const { error } = await sb
      .from('versions')
      .upsert({
        plan_key: key,
        project_code: projCode,
        snapshot_ts: ts,
        label: label,
        rooms_data: rooms,
        is_batch: false
      }, { onConflict: 'plan_key,snapshot_ts' });

    if (error) throw error;

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
    const sb  = getSupabase(env);
    if (!key || !ts) return resp({ error: "key and ts required" }, 400);

    // Supprimer le snapshot du plan donné
    const { error: deleteErr } = await sb
      .from('versions')
      .delete()
      .eq('plan_key', key)
      .eq('snapshot_ts', ts);

    if (deleteErr) throw deleteErr;

    // Mettre à jour l'index batch s'il y en a un pour ce timestamp
    const { data: batch, error: batchSelectErr } = await sb
      .from('versions')
      .select('id, plan_keys')
      .eq('is_batch', true)
      .eq('snapshot_ts', ts)
      .maybeSingle();

    if (batchSelectErr) throw batchSelectErr;

    if (batch) {
      const updatedPlanKeys = (batch.plan_keys || []).filter(k => k !== key);
      if (updatedPlanKeys.length > 0) {
        const { error: batchUpdateErr } = await sb
          .from('versions')
          .update({ plan_keys: updatedPlanKeys })
          .eq('id', batch.id);

        if (batchUpdateErr) throw batchUpdateErr;
      } else {
        const { error: batchDeleteErr } = await sb
          .from('versions')
          .delete()
          .eq('id', batch.id);

        if (batchDeleteErr) throw batchDeleteErr;
      }
    }

    return resp({ ok: true });
  } catch (err) {
    return resp({ error: err.message }, 500);
  }
}

