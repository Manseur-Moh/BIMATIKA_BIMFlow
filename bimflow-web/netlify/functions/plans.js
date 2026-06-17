// Netlify Function: read stored plans
// GET /api/plans          → list all plans (reads __meta__* blobs)
// GET /api/plans?key=xxx  → get one full plan

const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const store = getStore({
      name: "bimflow-plans",
      siteID: process.env.NETLIFY_SITE_ID,
      token:  process.env.NETLIFY_AUTH_TOKEN,
    });

    const key   = event.queryStringParameters?.key;
    const light = event.queryStringParameters?.light === "1";

    if (key) {
      const plan = await store.get(key, { type: "json" });
      if (!plan) return { statusCode: 404, headers, body: JSON.stringify({ error: "Not found" }) };

      // "light" mode: drop the heavy base64 image — the Analyse page only needs the room
      // data for its charts/costs, so this cuts the response from MBs to KBs per plan.
      if (light) {
        const { ImageBase64, ...rest } = plan;
        return {
          statusCode: 200,
          headers: { ...headers, "Cache-Control": "public, max-age=60" },
          body: JSON.stringify(rest),
        };
      }

      // Full plan (with image): cache so repeat views / the CDN don't re-download it.
      return {
        statusCode: 200,
        headers: { ...headers, "Cache-Control": "public, max-age=600" },
        body: JSON.stringify(plan),
      };
    }

    // List all __meta__* blobs — each plan has its own, so no race condition on write
    const result = await store.list({ prefix: "__meta__" });
    const metas = await Promise.all(
      result.blobs.map(b => store.get(b.key, { type: "json" }).catch(() => null))
    );
    const index = metas.filter(Boolean).sort((a, b) => (a.level || "").localeCompare(b.level || ""));
    return { statusCode: 200, headers: { ...headers, "Cache-Control": "public, max-age=30" }, body: JSON.stringify(index) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
