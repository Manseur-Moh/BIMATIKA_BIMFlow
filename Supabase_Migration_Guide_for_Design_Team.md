# Guide de migration Supabase — BIMFlow (version corrigée, prête à exécuter)

> **Destinataires : l'équipe design / intégration.**
> Ce document remplace `supabase_setup_guide.md`. J'ai relu ce dernier **et le code réel des 5 endpoints** (`upload.js`, `plans.js`, `projets.js`, `updates.js`, `versions.js`) **et l'état du projet Supabase** (`zmxluajeaogkkgieqpwz`, vérifié : aucune table — migration greenfield).
>
> Le plan d'origine contenait **plusieurs erreurs bloquantes** (résumées en bas). Suivez **ce** guide, dans l'ordre. Rien n'a encore été appliqué à la base.

---

## ⚠️ Décisions d'architecture à comprendre AVANT de commencer

1. **Toutes les Cloudflare Pages Functions accèdent à Supabase avec la clé `service_role`**, côté serveur uniquement. Cette clé **contourne la RLS** (Row Level Security). C'est le modèle « serveur de confiance » : la sécurité d'accès reste gérée par votre code (sessions `bfsession:`), pas par la RLS.
2. **La clé `service_role` ne doit JAMAIS être exposée au navigateur** ni committée. Elle se configure en **secret chiffré** (voir Étape 2).
3. **La RLS reste activée sans policy `anon`** → tout accès non-`service_role` est refusé par défaut. C'est volontaire et sûr. L'« advisor » Supabase affichera un avertissement « RLS enabled, no policy » : **c'est attendu** dans ce modèle (voir Étape 6 pour le documenter ou ajouter des policies si vous exposez un jour la clé publique).

---

## Étape 1 — Schéma de base de données (SQL corrigé)

SQL Editor du projet `zmxluajeaogkkgieqpwz` → exécuter ce script. **Corrections par rapport au plan d'origine signalées en commentaire `-- FIX`.**

```sql
-- (uuid-ossp retiré : aucune colonne UUID n'est utilisée. gen_random_uuid() est
--  natif en PG13+ si jamais nécessaire.)

-- 1. Projets ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
    code         VARCHAR(80)  PRIMARY KEY,
    display_name VARCHAR(255) NOT NULL,
    project_name VARCHAR(255),
    owner_email  VARCHAR(255) NOT NULL DEFAULT 'archi_moh@live.fr', -- FIX: défaut admin (upload sans user authentifié)
    created_at   TIMESTAMPTZ  DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- 2. Membres d'équipe ------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_members (
    id           BIGSERIAL    PRIMARY KEY,
    project_code VARCHAR(80)  NOT NULL REFERENCES projects(code) ON DELETE CASCADE,
    member_email VARCHAR(255) NOT NULL,
    added_at     TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE (project_code, member_email)
);
CREATE INDEX IF NOT EXISTS idx_pm_email ON project_members(member_email);

-- 3. Plans -----------------------------------------------------------------
-- FIX MAJEUR: l'ancien plan mettait project_code NOT NULL + FK. Or upload.js
-- accepte des plans SANS code projet (clé basée sur le nom). Solution retenue:
-- project_code reste NOT NULL MAIS upload.js DOIT d'abord upsert une ligne
-- `projects` (y compris un projet "legacy" synthétique). La FK garantit alors
-- l'intégrité sans casser les envois legacy.
CREATE TABLE IF NOT EXISTS plans (
    plan_key     VARCHAR(255) PRIMARY KEY,
    project_code VARCHAR(80)  NOT NULL REFERENCES projects(code) ON DELETE CASCADE,
    level_name   VARCHAR(255) NOT NULL,
    level_elev   DOUBLE PRECISION DEFAULT 0,
    rooms_count  INTEGER      DEFAULT 0,
    export_date  TIMESTAMPTZ,
    plan_data    JSONB,            -- payload complet SANS l'image (voir image ci-dessous)
    image_path   TEXT,             -- FIX: chemin Supabase Storage (recommandé) ...
    image_base64 TEXT,             -- ... fallback Phase 1 si vous gardez l'image inline
    created_at   TIMESTAMPTZ  DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_code);

-- 4. Modifications en attente (web → Revit) --------------------------------
CREATE TABLE IF NOT EXISTS pending_updates (
    id           BIGSERIAL    PRIMARY KEY,
    project_code VARCHAR(80)  NOT NULL REFERENCES projects(code) ON DELETE CASCADE,
    payload      JSONB        NOT NULL,
    status       VARCHAR(20)  DEFAULT 'pending',
    created_at   TIMESTAMPTZ  DEFAULT NOW(),
    applied_at   TIMESTAMPTZ
);
-- Index partiel: on ne lit QUE les lignes encore en attente.
CREATE INDEX IF NOT EXISTS idx_pu_pending ON pending_updates(project_code, created_at)
    WHERE status = 'pending';

-- 5. Versions (snapshots) --------------------------------------------------
-- FIX: plan_key passe en NULLABLE car les snapshots "batch" (tout le projet)
-- n'ont pas de plan_key unique (juste un tableau plan_keys). UNIQUE strict
-- remplacé par un index unique PARTIEL.
CREATE TABLE IF NOT EXISTS versions (
    id           BIGSERIAL    PRIMARY KEY,
    plan_key     VARCHAR(255),                 -- FIX: nullable (NULL pour un batch)
    project_code VARCHAR(80),                  -- pas de FK: un snapshot survit à la suppression du projet
    snapshot_ts  TIMESTAMPTZ  NOT NULL,
    label        VARCHAR(255),
    rooms_data   JSONB,
    is_batch     BOOLEAN      DEFAULT FALSE,
    plan_keys    JSONB,                         -- liste des clés pour un batch
    created_at   TIMESTAMPTZ  DEFAULT NOW()
);
-- Unicité uniquement pour les snapshots individuels (plan_key non NULL):
CREATE UNIQUE INDEX IF NOT EXISTS uq_ver_plan_ts
    ON versions(plan_key, snapshot_ts) WHERE plan_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ver_plan ON versions(plan_key);
CREATE INDEX IF NOT EXISTS idx_ver_proj ON versions(project_code);

-- 6. RLS activée (verrouille tout sauf service_role) -----------------------
ALTER TABLE projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE versions        ENABLE ROW LEVEL SECURITY;
-- AUCUNE policy anon volontairement : l'accès passe par service_role (qui
-- bypasse la RLS). Voir Étape 6 pour le détail / policies optionnelles.

-- 7. Trigger updated_at ----------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- FIX: DROP IF EXISTS avant CREATE (portable, idempotent)
DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_plans_updated_at ON plans;
CREATE TRIGGER update_plans_updated_at
    BEFORE UPDATE ON plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

---

## Étape 2 — Variables d'environnement & SECRET

`SUPABASE_URL` = `https://zmxluajeaogkkgieqpwz.supabase.co` (variable simple, non sensible).

`SUPABASE_SERVICE_ROLE_KEY` = **SECRET chiffré** — jamais en clair, jamais committé.

- **Production (Cloudflare Pages)** :
  ```bash
  cd bimflow-web
  npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY
  # collez la clé service_role (Supabase → Settings → API → service_role)
  npx wrangler pages secret put SUPABASE_URL   # ou variable simple dans le dashboard
  ```
  (ou Dashboard Cloudflare → Pages → bimatika-bimplan → Settings → Environment variables → **Encrypt**.)
- **Local** : créez `bimflow-web/.dev.vars` (déjà ignoré par git — **vérifiez-le**) :
  ```
  SUPABASE_URL=https://zmxluajeaogkkgieqpwz.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=eyJ...
  ```
  ➡️ Ajoutez `.dev.vars` à `.gitignore` s'il n'y est pas.

---

## Étape 3 — SDK Supabase + compatibilité Workers

```bash
cd bimflow-web
npm install @supabase/supabase-js
```
`@supabase/supabase-js` v2 fonctionne sur le runtime Workers (il utilise `fetch`). **Si** le build échoue avec une erreur de module Node, ajoutez dans `bimflow-web/wrangler.toml` :
```toml
compatibility_flags = ["nodejs_compat"]
```
À **tester en local** (`npx wrangler pages dev`) avant de déployer.

---

## Étape 4 — Client helper

`bimflow-web/functions/api/_supabase.js` :
```javascript
import { createClient } from '@supabase/supabase-js';

export function getSupabase(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

---

## Étape 5 — Mapping précis KV → Supabase (par endpoint)

> Le plan d'origine restait vague (« remplacez par des sélections/insertions »).
> Voici la correspondance **exacte** attendue. Conservez les **mêmes formats de réponse JSON** que l'actuel pour ne pas casser le front ni le plugin.

### 5.1 `upload.js` — Revit → web
Ordre **impératif** (la FK l'exige) :
1. Résoudre `code` comme aujourd'hui (`ProjectCode` || `ProjectNumber` || fallback nom). Pour le cas legacy (pas de code), **synthétiser** un code déterministe, ex. `LEGACY_<sanitize(ProjectName)>`, pour respecter la FK.
2. `upsert` dans `projects` (`code`, `display_name`, `project_name`, `owner_email` = email de session ou défaut admin) — **avant** le plan.
3. `upsert` dans `plans` (`plan_key`, `project_code`, `level_name`, `level_elev`, `rooms_count`, `export_date`, `plan_data` = payload sans image, `image_base64`/`image_path`).
   ```js
   await sb.from('projects').upsert({ code, display_name, project_name, owner_email }, { onConflict: 'code', ignoreDuplicates: false });
   await sb.from('plans').upsert({ plan_key: key, project_code: code, level_name, level_elev, rooms_count, export_date, plan_data, image_base64 }, { onConflict: 'plan_key' });
   ```
   ⚠️ Ne **pas écraser** `owner_email` d'un projet existant (équivalent du « set owner only if not exists » actuel) → faites un `select` préalable, ou un upsert qui ne touche pas `owner_email` si la ligne existe.

### 5.2 `plans.js` — lecture / liste / suppression
- `GET ?key=` → `select * from plans where plan_key = ...` (ajoutez `?light=1` = ne pas renvoyer `image_base64`).
- `GET` liste (admin/owner/membre) → `select` sur `plans` joint à `projects`/`project_members` pour filtrer par accès (reproduire `hasProjectAccess`).
- `DELETE ?code=` → `delete from plans where project_code = ...` (le N+1 KV disparaît : une seule requête).
- `PATCH ?key=` → `update plans set plan_data = ... where plan_key = ...` (mise à jour des paramètres de pièces).

### 5.3 `projets.js` — registre projets
- Liste / vérification / création / renommage / suppression → CRUD direct sur `projects` (+ `project_members` pour le partage). La logique d'autorisation (owner/admin/membre) reste identique, appliquée dans le code.

### 5.4 `updates.js` — file d'attente web → Revit
Sémantique actuelle : **un payload courant par projet**. Mapping :
- `POST ?code=` → `insert` une ligne `pending_updates` (`project_code`, `payload`, `status='pending'`).
- `GET ?code=` → `select payload from pending_updates where project_code=... and status='pending' order by created_at desc limit 1` (ou agréger toutes les lignes en attente selon le besoin). Renvoyer `{ Updates: [] }` si rien.
- `DELETE ?code=` (Revit a appliqué) → `update pending_updates set status='applied', applied_at=now() where project_code=... and status='pending'` (conserve l'historique) **ou** `delete` si l'historique n'est pas voulu.

### 5.5 `versions.js` — snapshots
- Snapshot individuel `POST ?key=` → `insert versions (plan_key, project_code, snapshot_ts, label, rooms_data, is_batch=false)`.
- Snapshot batch `POST ?batch=1` → `insert versions (plan_key=NULL, snapshot_ts, label, is_batch=true, plan_keys=[...])` **+** une ligne par plan si vous voulez aussi les `rooms_data` détaillées.
- `GET ?key=` (liste) / `?key=&ts=` (un snapshot) / `?all=1` (batches) → `select` correspondants.
- `DELETE ?key=&ts=` → `delete` + retrait de la clé du batch (mise à jour de `plan_keys`).

---

## Étape 6 — RLS : documenter ou durcir

Deux options (choisir) :
- **A — Modèle serveur de confiance (recommandé, le plus simple).** Laisser RLS activée **sans policy**. Tous les accès passent par `service_role`. L'avertissement de l'advisor « RLS enabled, no policy » est **attendu** ; documentez-le dans le README pour éviter la confusion.
- **B — Exposer un jour la clé publique au front.** Alors il FAUT des policies. Exemple pour `plans` (lecture par membre/owner) :
  ```sql
  CREATE POLICY plans_read ON plans FOR SELECT TO authenticated
    USING (project_code IN (
      SELECT code FROM projects WHERE owner_email = auth.jwt()->>'email'
      UNION SELECT project_code FROM project_members WHERE member_email = auth.jwt()->>'email'));
  ```
  ⚠️ Ne faites B que si vous migrez l'auth vers Supabase Auth. Tant que l'auth reste vos sessions `bfsession:`, restez en A.

---

## Étape 7 — Migration des données existantes (KV → Supabase)

Le projet Supabase est **vide**. Mais le KV de production contient peut-être des données. Deux choix :
- **Re-upload depuis Revit** (le plus simple si peu de projets) : après bascule, chaque utilisateur renvoie ses plans.
- **Script d'export/import** (si données importantes) : lire le KV (`wrangler kv key list` / `get`) et `insert` dans Supabase dans l'ordre projects → plans → pending → versions. À écrire et tester sur un sous-ensemble d'abord.

---

## Étape 8 — Déploiement progressif & vérification

1. **Local d'abord** : `npx wrangler pages dev`, tester chaque endpoint (`upload`, `plans`, `projets`, `updates`, `versions`) contre Supabase.
2. **Migration par phases** (réduit le risque) : basculez **un endpoint à la fois** (commencez par `projets.js` puis `upload.js`), en validant à chaque étape, plutôt que les 5 d'un coup.
3. **Conserver le binding KV** pendant la transition pour un rollback rapide.
4. Après les changements DDL, lancez les **advisors Supabase** (sécurité + perf) et traitez les alertes non attendues :
   - `get_advisors(type: "security")` et `get_advisors(type: "performance")`.
5. **Tests de bout en bout** : envoi depuis Revit → visible sur le web ; édition de paramètres web → réception dans Revit ; partage d'équipe ; snapshots/versions ; suppression projet (vérifier le `ON DELETE CASCADE`).

---

## Annexe — Erreurs du guide d'origine corrigées ici

| # | Problème dans `supabase_setup_guide.md` | Gravité | Correction |
|---|------------------------------------------|---------|------------|
| 1 | RLS activée, **0 policy**, sans expliquer que `service_role` bypasse la RLS | 🔴 Bloquant/confusion | Modèle « serveur de confiance » documenté (Étape 6) |
| 2 | `plans.project_code NOT NULL REFERENCES projects(code)` casse les plans **legacy** (sans code) | 🔴 Bloquant | Upsert projet (code synthétique legacy) avant le plan (Étape 5.1) |
| 3 | `versions.plan_key NOT NULL` incompatible avec les snapshots **batch** | 🔴 Bloquant | `plan_key` nullable + index unique partiel |
| 4 | `SUPABASE_SERVICE_ROLE_KEY` présenté comme simple variable | 🟠 Sécurité | Secret chiffré (`wrangler pages secret put`) |
| 5 | `image_base64 TEXT` inline (lignes lourdes, TOAST) | 🟠 Perf | `image_path` + Supabase Storage recommandé (base64 = fallback) |
| 6 | Mapping des endpoints trop vague | 🟠 | Correspondance KV→SQL précise par endpoint (Étape 5) |
| 7 | Sémantique `updates.js` (1 payload courant/projet) non spécifiée | 🟠 | GET = dernier `pending` ; DELETE = `status='applied'` |
| 8 | Aucune migration des données KV existantes | 🟠 | Étape 7 ajoutée |
| 9 | Pas de stratégie de bascule/rollback | 🟠 | Migration par phases + KV conservé (Étape 8) |
| 10 | `CREATE OR REPLACE TRIGGER` (PG14+ seulement) | 🟡 Mineur | `DROP TRIGGER IF EXISTS` + `CREATE` |
| 11 | Extension `uuid-ossp` inutilisée | 🟡 Mineur | Retirée |
| 12 | `SERIAL` / `FLOAT` | 🟡 Style | `BIGSERIAL` / `DOUBLE PRECISION` |

---

*Aucune migration n'a été appliquée à la base lors de la rédaction de ce guide : le projet `zmxluajeaogkkgieqpwz` est vide. Exécutez les étapes ci-dessus dans l'ordre.*
