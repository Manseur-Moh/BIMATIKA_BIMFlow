# Deploy BIMFlow to Cloudflare Pages (free, unlimited bandwidth)

Run these from `bimflow-web/`. One-time setup, then `deploy` is the only repeat step.

## 1. Log in (opens your browser once)
```
npx wrangler login
```

## 2. Create the KV store (holds plans + pending updates)
```
npx wrangler kv namespace create BIMFLOW
```
Copy the printed `id = "…"` value into **wrangler.toml**, replacing `REPLACE_WITH_KV_NAMESPACE_ID`.

## 3. Deploy
```
npx wrangler pages deploy
```
- First run creates the project named **bimatika-bimplan** → site at **https://bimatika-bimplan.pages.dev**
- `/` serves the static pages (public/), `/api/*` is served by functions/ automatically.

If that exact name is taken, wrangler will tell you — pick another and tell me so I update the plugin URLs.

## 4. (If KV isn't bound automatically)
Cloudflare dashboard → Workers & Pages → **bimatika-bimplan** → Settings → Functions →
**KV namespace bindings** → Add: Variable name `BIMFLOW`, select the namespace → Save → redeploy.

## Notes
- The Revit plugin already points to `https://bimatika-bimplan.pages.dev/api/...` (rebuilt DLL installed).
- KV starts empty — re-send your plans from Revit ("Envoyer vers BIMFlow") after the first deploy.
- Netlify files (`netlify/`, `netlify.toml`) are unused by Cloudflare and can stay.
