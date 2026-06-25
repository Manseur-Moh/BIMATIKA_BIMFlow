# Plan d'Intégration Supabase pour BIMFlow

Ce guide décrit en détail les étapes pour migrer l'infrastructure de stockage et d'authentification de **BIMFlow** de **Cloudflare KV** vers **Supabase** (PostgreSQL).

---

## Étape 1 : Création du Schéma de Base de Données

Connectez-vous au **SQL Editor** de votre projet Supabase (`zmxluajeaogkkgieqpwz`) et exécutez le script SQL suivant pour créer la structure de la base de données :

```sql
-- 1. Extension pour générer des UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Table des Projets
CREATE TABLE IF NOT EXISTS projects (
    code         VARCHAR(80)  PRIMARY KEY,
    display_name VARCHAR(255) NOT NULL,
    project_name VARCHAR(255),
    owner_email  VARCHAR(255) NOT NULL,
    created_at   TIMESTAMPTZ  DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- 3. Table des Membres de l'Équipe
CREATE TABLE IF NOT EXISTS project_members (
    id           SERIAL      PRIMARY KEY,
    project_code VARCHAR(80) NOT NULL REFERENCES projects(code) ON DELETE CASCADE,
    member_email VARCHAR(255) NOT NULL,
    added_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_code, member_email)
);
CREATE INDEX IF NOT EXISTS idx_pm_email ON project_members(member_email);

-- 4. Table des Plans (métadonnées + contenu du plan)
CREATE TABLE IF NOT EXISTS plans (
    plan_key     VARCHAR(255) PRIMARY KEY,
    project_code VARCHAR(80)  NOT NULL REFERENCES projects(code) ON DELETE CASCADE,
    level_name   VARCHAR(255) NOT NULL,
    level_elev   FLOAT        DEFAULT 0,
    rooms_count  INTEGER      DEFAULT 0,
    export_date  TIMESTAMPTZ,
    plan_data    JSONB,
    image_base64 TEXT,
    created_at   TIMESTAMPTZ  DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_code);

-- 5. Table des Modifications en Attente (Revit)
CREATE TABLE IF NOT EXISTS pending_updates (
    id           SERIAL      PRIMARY KEY,
    project_code VARCHAR(80) NOT NULL REFERENCES projects(code) ON DELETE CASCADE,
    payload      JSONB       NOT NULL,
    status       VARCHAR(20) DEFAULT 'pending',
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    applied_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pu_status ON pending_updates(project_code, status);

-- 6. Table des Versions (Snapshots/Historique)
CREATE TABLE IF NOT EXISTS versions (
    id           SERIAL       PRIMARY KEY,
    plan_key     VARCHAR(255) NOT NULL,
    project_code VARCHAR(80),
    snapshot_ts  TIMESTAMPTZ  NOT NULL,
    label        VARCHAR(255),
    rooms_data   JSONB,
    is_batch     BOOLEAN      DEFAULT FALSE,
    plan_keys    JSONB,
    created_at   TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE(plan_key, snapshot_ts)
);
CREATE INDEX IF NOT EXISTS idx_ver_plan ON versions(plan_key);
CREATE INDEX IF NOT EXISTS idx_ver_proj ON versions(project_code);

-- 7. Activer la sécurité au niveau des lignes (RLS)
ALTER TABLE projects         ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_updates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE versions         ENABLE ROW LEVEL SECURITY;

-- 8. Triggers pour mettre à jour automatiquement `updated_at`
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_plans_updated_at
    BEFORE UPDATE ON plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

---

## Étape 2 : Configuration des Variables d'Environnement

Dans votre console **Cloudflare Pages** (ou dans votre fichier local `.dev.vars` / Wrangler configuration) :

1. Ajoutez `SUPABASE_URL` :
   ```
   https://zmxluajeaogkkgieqpwz.supabase.co
   ```
2. Ajoutez `SUPABASE_SERVICE_ROLE_KEY` :
   *(Copiez la clé `service_role` secrète depuis Supabase -> Settings -> API)*.

---

## Étape 3 : Installation du SDK Supabase

Dans le dossier `bimflow-web` :
```bash
npm install @supabase/supabase-js
```

---

## Étape 4 : Initialisation du Client Helper

Créez un nouveau fichier `bimflow-web/functions/api/_supabase.js` :
```javascript
import { createClient } from '@supabase/supabase-js';

export function getSupabase(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
}
```

---

## Étape 5 : Migration du Code des API Functions

Pour chaque API située dans `/functions/api/`, remplacez les appels à Cloudflare KV (`env.BIMFLOW`) par des requêtes Supabase :

### 1. `upload.js` (Envoi de données depuis Revit)
- Remplacez le stockage de `plan:key` et `meta:key` par un `upsert` dans les tables `projects` et `plans`.

### 2. `plans.js` (Visualisation et lecture des plans)
- Remplacez `env.BIMFLOW.get` par un `select` filtré par clé dans la table `plans`.

### 3. `projets.js` (Liste et édition de projets)
- Remplacez par des requêtes de sélection/insertion sur la table `projects`.

### 4. `updates.js` (Modifications de paramètres vers Revit)
- Remplacez par des insertions et sélections sur `pending_updates`.

### 5. `versions.js` (Historique des versions)
- Remplacez par des opérations SQL sur `versions`.
