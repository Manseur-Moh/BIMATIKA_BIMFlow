// Netlify Function: receives BIMFlow data from Revit plugin
// POST /api/upload  — body: JSON (PlanExport)
// Each plan stored as its own blob; metadata stored separately per plan (no race condition).

const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method Not Allowed" };

  try {
    const payload = JSON.parse(event.body);
    if (!payload || !payload.LevelName)
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing LevelName" }) };

    const key = sanitize(`${payload.ProjectName}__${payload.LevelName}`);

    const store = getStore({
      name: "bimflow-plans",
      siteID: process.env.NETLIFY_SITE_ID,
      token:  process.env.NETLIFY_AUTH_TOKEN,
    });

    // Store full plan data
    await store.setJSON(key, payload);

    // Store metadata in its own blob — no shared index, no race condition
    await store.setJSON("__meta__" + key, {
      key,
      project: payload.ProjectName,
      level:   payload.LevelName,
      rooms:   payload.Rooms?.length ?? 0,
      date:    payload.ExportDate,
    });

    return {
      statusCode: 200,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, key, rooms: payload.Rooms?.length }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function sanitize(s) {
  return s.replace(/[^a-zA-Z0-9_\-]/g, "_").substring(0, 100);
}
