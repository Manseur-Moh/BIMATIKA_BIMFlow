// Netlify Function: store/retrieve parameter updates from site → Revit
// POST   /api/updates  — save edits from web UI
// GET    /api/updates  — Revit pulls pending updates
// DELETE /api/updates  — Revit clears after applying

const { getStore } = require("@netlify/blobs");

function store() {
  return getStore({
    name: "bimflow-updates",
    siteID: process.env.NETLIFY_SITE_ID,
    token:  process.env.NETLIFY_AUTH_TOKEN,
  });
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS")
    return { statusCode: 200, headers, body: "" };

  const s = store();

  try {
    if (event.httpMethod === "POST") {
      const payload = JSON.parse(event.body);
      await s.setJSON("pending", payload);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === "GET") {
      let data = null;
      try { data = await s.get("pending", { type: "json" }); } catch {}
      return { statusCode: 200, headers, body: JSON.stringify(data || { Updates: [] }) };
    }

    if (event.httpMethod === "DELETE") {
      try { await s.delete("pending"); } catch {}
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: "Method Not Allowed" };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
