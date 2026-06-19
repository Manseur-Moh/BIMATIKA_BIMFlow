# FromClaude → Antigravity — Plan d'exécution des corrections BIMFlow

> **Rôle de ce document.** Je suis l'agent qui a relu le plan initial (`Corrections_Bugs_BIMFlow.md`) **et le code source réel**. Ce fichier est un handoff destiné à l'agent **Antigravity** : il contient, pour chaque bug, l'emplacement exact (fichier + ligne), le diff précis, et un critère de validation. Suis-le tâche par tâche, dans l'ordre.
>
> **Important — l'état du code a évolué depuis le plan initial.** Plusieurs points du plan d'origine sont **déjà corrigés** dans le code actuel, certains sont **partiellement** faits, et un point a **muté** en un bug différent. J'ai re-vérifié chaque item. Ne réapplique pas aveuglément le plan d'origine : suis CE document.

---

## 0. Contexte technique vérifié

- **Plugin Revit** : C#, cible `net48`, configs `Release` (R23) et `Release.R24` (Revit 2024). Build : `dotnet build -c Release.R24 BIMFlowPlugin/BIMFlowPlugin.csproj`.
- **Backend** : Cloudflare **Pages Functions** sous `bimflow-web/functions/api/*.js` (PAS Netlify — le dossier `bimflow-web/netlify/` est legacy/mort, **ne pas y toucher**). Stockage = **KV** (binding `BIMFLOW`).
- **Communication réelle** : HTTP REST + JSON (le mot « WebSocket » dans les `CLAUDE.md` est obsolète, ignore-le).
- **Clés KV utilisées** : `plan:<key>`, `meta:<key>`, `pending`, `projowner:<code>`, `projname:<code>`, `projmembers:<code>`, `bfsession:<token>`. La `<key>` d'un plan = `sanitize("<code>__<LevelName>")` si un code projet existe, sinon `sanitize("<ProjectName>__<LevelName>")`.

### Tableau de statut (re-vérifié sur le code réel)

| # | Problème (plan d'origine) | Statut réel | Action |
|---|---------------------------|-------------|--------|
| 1.1 | `updates.js` clé `"pending"` globale | ❌ Ouvert | À corriger (T1) |
| 1.2 | `params.js` ignore `ProjectCode` | ❌ Ouvert | À corriger (T2) |
| 1.3 | `plans.js` DELETE N+1 | ⚠️ Atténué (déjà paginé) | Optimisation optionnelle (T3) |
| 2.1 | Icône `project_*.png` manquante | ❌ Ouvert (pas de crash, bouton sans icône) | À corriger (T4) |
| 2.2a | Multiples `new HttpClient` | ⚠️ En grande partie fait (statics) | Nettoyage `ReceiveFromBIMFlowCommand` (T5) |
| 2.2b | Header `Authorization` manquant → 401 | ❌ Ouvert (bug réel, confirmé) | À corriger (T6) |
| 2.2c | `.GetAwaiter().GetResult()` fige l'UI | ⚠️ Partiel | Voir note T5 |
| 2.3a | `param.AsElementId() != null` | ✅ Déjà corrigé (ligne 226) | Nettoyage cosmétique (T7) |
| 2.3b | Rooms en `TypeBinding` | ⚠️ Muté en nouveau bug | À corriger (T8) |
| 2.4 | `catch { }` silencieux | ❌ Ouvert | À corriger (T9) |
| 2.5 | Bouton copie copie le mauvais champ | ❌ Ouvert (confirmé) | À corriger (T10) |
| 2.6 | Division par zéro export SVG | ❌ Ouvert (confirmé) | À corriger (T11) |

Priorité d'exécution recommandée : **T6 → T2 → T1 → T8 → T11 → T10 → T4 → T7 → T9 → T5 → T3**.

---

## T1 — `updates.js` : isoler la file d'attente par projet

**Fichier** : `bimflow-web/functions/api/updates.js`
**Problème confirmé** : tout est stocké sous la clé unique `"pending"`. Deux utilisateurs/projets simultanés s'écrasent.

**Correctif** : indexer par code projet, passé en query string.

- `POST /api/updates?code=<code>` → écrit `pending:<code>`.
- `GET /api/updates?code=<code>` → lit `pending:<code>`.
- `DELETE /api/updates?code=<code>` → supprime `pending:<code>`.
- **Rétro-compatibilité** : si `code` absent, retomber sur la clé `"pending"` (ne pas casser un plugin pas encore mis à jour).

```js
const sanitize = (s) => String(s || "").replace(/[^a-zA-Z0-9_\-]/g, "_").substring(0, 80);
const keyFor = (request) => {
  const code = sanitize(new URL(request.url).searchParams.get("code") || "");
  return code ? "pending:" + code : "pending";
};

export async function onRequestPost({ request, env }) {
  try { const payload = await request.json(); await env.BIMFLOW.put(keyFor(request), JSON.stringify(payload)); return j({ ok: true }); }
  catch (err) { return j({ error: err.message }, 500); }
}
export async function onRequestGet({ request, env }) {
  try { const data = await env.BIMFLOW.get(keyFor(request), { type: "json" }); return j(data || { Updates: [] }); }
  catch (err) { return j({ error: err.message }, 500); }
}
export async function onRequestDelete({ request, env }) {
  try { await env.BIMFLOW.delete(keyFor(request)); return j({ ok: true }); }
  catch (err) { return j({ error: err.message }, 500); }
}
```

**Côté plugin** (`BIMFlowPlugin/Commands/ReceiveFromBIMFlowCommand.cs`) : le `GET` et le `DELETE` doivent inclure `?code=<code>`. Récupérer le code via `BimFlowSender.ComputeProjectCode(doc)` (déjà existant) et l'ajouter à `UpdatesUrl` :

```csharp
string code = Uri.EscapeDataString(BimFlowSender.ComputeProjectCode(doc) ?? "");
string url  = string.IsNullOrEmpty(code) ? UpdatesUrl : $"{UpdatesUrl}?code={code}";
```

Utiliser ce `url` pour le GET (ligne ~31) **et** pour le DELETE (ligne ~105).
**Côté web** : l'UI qui poste les updates doit elle aussi ajouter `?code=<code>` du projet courant.

**Validation** : deux projets (codes A et B) avec des updates en attente simultanées → chacun récupère uniquement ses propres updates ; vider l'un ne vide pas l'autre.

---

## T2 — `params.js` : même logique de clé que `upload.js`

**Fichier** : `bimflow-web/functions/api/params.js` (ligne 22)
**Problème confirmé** : `params.js` construit la clé avec `${p.ProjectName}__${p.LevelName}` uniquement, alors que `upload.js` préfixe par `ProjectCode`/`ProjectNumber`. Conséquence : « Envoyer paramètres » renvoie `404 Plan introuvable` dès qu'un code projet est défini.

**Correctif** : reproduire exactement la résolution de clé d'`upload.js`.

Remplacer (ligne 13 + 22) :
```js
const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_\-]/g, "_").substring(0, 100);
...
const key = sanitize(`${p.ProjectName}__${p.LevelName}`);
```
par :
```js
const sanitize = (s) => String(s || "").replace(/[^a-zA-Z0-9_\-]/g, "_").substring(0, 80); // aligné sur upload.js
const clean    = (s) => String(s || "").trim();
...
const rawCode = clean(p.ProjectCode) || clean(p.ProjectNumber) || "";
const code    = sanitize(rawCode);
const key = code
  ? sanitize(`${code}__${p.LevelName}`)
  : sanitize(`${p.ProjectName}__${p.LevelName}`);
```

> ⚠️ **Cohérence critique** : `upload.js` tronque à **80** caractères, `params.js` tronquait à **100**. Pour un nom long, les deux produiraient des clés différentes → plan introuvable. Aligner sur **80** dans les deux (fait ci-dessus). Vérifier qu'aucune autre fonction n'utilise une autre longueur.

**Validation** : définir un code projet dans Revit, envoyer le plan complet, puis « Envoyer paramètres » → `200 { ok:true, updated:N }`, plus aucun `404`.

---

## T3 — `plans.js` DELETE : optimisation (optionnelle, basse priorité)

**Fichier** : `bimflow-web/functions/api/plans.js` (lignes 131-146)
**Réalité** : le DELETE est **déjà paginé** par curseur, donc le risque de timeout est moindre que ne le dit le plan d'origine. Le coût reste un `kv.get()` par clé `meta:`.

**Correctif léger recommandé** : le `meta:` contient déjà `projectCode`, et la clé de plan est dérivable. On peut éviter le `kv.get` par clé en encodant le code dans le **nom** de la clé `meta:` à l'écriture (ex. `meta:<code>:<key>`) — mais cela impose une **migration** des données existantes. **Ne pas faire** sauf demande explicite : risque > bénéfice à ce stade.

**Action minimale sûre** : laisser la logique, mais paralléliser les lectures par page avec `Promise.all` au lieu d'un `await` séquentiel dans la boucle `for` :
```js
const metas = await Promise.all(listed.keys.map(k => kv.get(k.name, { type: "json" }).catch(() => null)));
for (let i = 0; i < listed.keys.length; i++) {
  const meta = metas[i];
  const match = meta && (
    (code    && (meta.projectCode || "") === code) ||
    (project && (meta.project || "") === project && !meta.projectCode)
  );
  if (match) { await kv.delete("plan:" + meta.key); await kv.delete("meta:" + meta.key); removed++; }
}
```

**Validation** : supprimer un projet de 50+ plans s'exécute sans timeout (< quelques secondes).

---

## T4 — Icône manquante du bouton « Gérer le projet »

**Fichiers** : `BIMFlowPlugin/Application.cs` (lignes 99-100), `BIMFlowPlugin/BIMFlowPlugin.csproj` (lignes 16-23), dossier `BIMFlowPlugin/Icons/`.
**Réalité vérifiée** : `LoadIcon("project_32.png")` / `project_16.png` est appelé, mais ces fichiers **n'existent pas** dans `Icons/` et ne sont **pas** déclarés `EmbeddedResource`. ✅ **Pas de crash** : `LoadIcon` renvoie `null` proprement (ligne 127) — le bouton s'affiche simplement **sans icône**.

**Correctif (2 options, choisir l'une)** :

- **Option A (rapide)** — réutiliser une icône existante. Dans `Application.cs` lignes 99-100 :
  ```csharp
  LargeImage = LoadIcon("send_32.png"),
  Image      = LoadIcon("send_16.png"),
  ```
- **Option B (propre)** — ajouter de vraies icônes. Déposer `project_32.png` (32×32) et `project_16.png` (16×16) dans `BIMFlowPlugin/Icons/`, puis ajouter dans le `.csproj` (après ligne 23) :
  ```xml
  <EmbeddedResource Include="Icons\project_32.png" />
  <EmbeddedResource Include="Icons\project_16.png" />
  ```

**Recommandation** : Option B si des assets sont fournis, sinon Option A. **Ne pas** laisser un appel vers une ressource inexistante.

**Validation** : recompiler, lancer Revit → le bouton « Gérer le projet » affiche une icône.

---

## T5 — `ReceiveFromBIMFlowCommand` : consolider HttpClient + ne plus figer l'UI

**Fichier** : `BIMFlowPlugin/Commands/ReceiveFromBIMFlowCommand.cs` (lignes 29-37 et 104-105).
**Réalité** : `BFSession`, `BimFlowSender`, `ManageProjectCommand` utilisent déjà un `static readonly HttpClient`. Seul **ce** fichier instancie encore `new HttpClient` deux fois (fuite de sockets potentielle).

**Correctif** : ajouter un client statique partagé en tête de classe et l'utiliser :
```csharp
private static readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
```
- Ligne 29-37 : remplacer le `using (var client = new HttpClient {...})` par un appel direct à `_http`.
- Ligne 104-105 : idem pour le `DeleteAsync`.

> **Note sur `.GetAwaiter().GetResult()`** (point 2.2c du plan) : un `IExternalCommand` Revit s'exécute sur le thread API ; un vrai `async/await` n'est pas trivial ici sans `ExternalEvent`. **Ne pas refactorer en async dans cette passe.** Le risque réel de gel est borné par les `Timeout` (déjà présents). Se contenter de consolider le client. Si un gel UI persistant est signalé plus tard, ouvrir une tâche dédiée « ExternalEvent + IExternalEventHandler ».

**Validation** : build OK ; la réception fonctionne ; plus aucun `new HttpClient` dans ce fichier.

---

## T6 — ManageProjectCommand : header `Authorization` manquant (401) — **bug réel, prioritaire**

**Fichiers** : `BIMFlowPlugin/Commands/ManageProjectCommand.cs` (lignes 46-68) et `bimflow-web/functions/api/projets.js` (lignes 138-142).
**Confirmé** : `projets.js` POST renvoie `401 Non authentifié` si pas de `Authorization: Bearer <token>` valide. Or `ManageProjectCommand` poste via son `_http.PostAsync(url, content)` **sans** header d'auth → l'enregistrement web du projet échoue toujours en 401.

`BimFlowSender` possède déjà un helper `AuthSend(method, url, content)` (ligne ~37-42) qui pose `Authorization: Bearer BFSession.Current.Session`. **Réutiliser ce helper** au lieu du `_http` local.

Remplacer le bloc d'envoi (lignes 50-53) par :
```csharp
string url  = BimFlowSender.ProjectsUrl + "?code=" + Uri.EscapeDataString(newCode);
string body = JsonConvert.SerializeObject(new { displayName = newName });
using var content = new StringContent(body, Encoding.UTF8, "application/json");
var resp = BimFlowSender.AuthSend(HttpMethod.Post, url, content);  // pose le Bearer token
```
- Vérifier la signature/visibilité réelle de `AuthSend` dans `BimFlowSender.cs` ; si elle est `private`, la passer `internal`/`public static`, ou exposer une méthode `RegisterProject(code, displayName)` dans `BimFlowSender`.
- Si `BFSession.IsAuthenticated == false`, afficher un message clair (« Connectez-vous à BIMFlow avant d'enregistrer un projet sur le web ») plutôt que de partir en 401.
- Le `_http` statique local de `ManageProjectCommand` devient inutile une fois ce changement fait → le supprimer.

**Validation** : connecté, cliquer « Enregistrer » avec « Enregistrer sur le serveur » coché → `200`, le projet apparaît dans `GET /api/projets`. Non connecté → message explicite, pas de 401 silencieux.

---

## T7 — `SetParamValue` : nettoyer le test `ElementId` (cosmétique)

**Fichier** : `BIMFlowPlugin/Commands/ReceiveFromBIMFlowCommand.cs` (ligne 226).
**Réalité** : le bug du plan d'origine (`param.AsElementId() != null` toujours vrai car `ElementId` est un `struct` depuis 2024) est **déjà corrigé** — la ligne teste `targetId != null && targetId != ElementId.InvalidElementId`. Le `!= null` est redondant (un `struct` n'est jamais null) mais inoffensif.

**Correctif (cosmétique, facultatif)** : retirer le `!= null` redondant pour la clarté, aux **deux** endroits où le motif apparaît :
- `ReceiveFromBIMFlowCommand.cs:226`
- `Exporters/SvgPlanExporter.cs:552`
```csharp
if (targetId != ElementId.InvalidElementId)
```

**Validation** : build sans warning ; comportement inchangé.

---

## T8 — Binding des Pièces : forcer `InstanceBinding` (le bug a muté)

**Fichier** : `BIMFlowPlugin/Commands/ReceiveFromBIMFlowCommand.cs` (lignes 172-174).
**Réalité** : le code ne fait plus systématiquement du `TypeBinding`. Il choisit désormais selon un flag web :
```csharp
Binding binding = req.Instance
    ? (Binding)new InstanceBinding(catSet)
    : new TypeBinding(catSet);
```
**Problème résiduel** : les Pièces (Rooms) sont des éléments **d'instance**. Si l'UID web envoie `Instance = false` (valeur par défaut d'un bool non renseigné en JSON !), on crée un `TypeBinding` sur `OST_Rooms` → paramètre non éditable par pièce, exactement le bug d'origine.

**Correctif** : comme ce binding ne concerne que la catégorie `OST_Rooms`, **toujours** forcer l'instance :
```csharp
// Les pièces sont des éléments d'instance : un TypeBinding sur OST_Rooms est invalide.
Binding binding = new InstanceBinding(catSet);
```
Si plus tard d'autres catégories sont supportées, réintroduire le choix `req.Instance` **uniquement** pour celles qui sont type-based. Pour l'instant : instance forcée.

**Validation** : depuis le web, créer un nouveau paramètre de pièce → il apparaît dans Revit sur **chaque pièce** (et non au niveau du type), et est éditable.

---

## T9 — Remplacer les `catch { }` silencieux par des logs

**Fichiers concernés (catch vides confirmés)** :
- `ReceiveFromBIMFlowCommand.cs` : lignes 89 (`SetParamValue` par paramètre), 107 (clear serveur — OK de rester silencieux, c'est non-critique).
- `SvgPlanExporter.cs` : nombreux `catch { }` autour de l'export PNG, du crop, de la transparence (ex. 139, 332, 371, 382, 403…).
- `ProjectManagerDialog.cs` : ligne 50 (clipboard).

**Principe** : ne **pas** tout rendre bruyant. Règle :
1. **Erreurs métier visibles par l'utilisateur** (échec génération SVG, échec écriture fichier, échec set d'un paramètre demandé) → accumuler dans le `StringBuilder log` déjà présent, ou afficher un `TaskDialog` récapitulatif.
2. **Best-effort réellement optionnel** (restauration de crop, clipboard, clear serveur post-apply) → garder silencieux mais **commenter pourquoi** (`/* non-critique : ... */`).

Exemple ciblé — `ReceiveFromBIMFlowCommand.cs` ligne 89, le `catch {}` masque l'échec d'écriture d'un paramètre demandé par l'utilisateur :
```csharp
catch (Exception ex) { log.AppendLine($"  ✗ {kv.Key} : {ex.Message}"); }
```

Pour la génération SVG, ajouter au minimum un log fichier. Proposition : un petit helper statique `BFLog.Warn(string)` qui écrit dans `%APPDATA%/BIMFlow/bimflow.log` avec horodatage, appelé dans les catches « importants ». **Créer ce helper** dans `BIMFlowPlugin/` (nouveau fichier `BFLog.cs`) :
```csharp
internal static class BFLog {
    private static readonly string Path = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BIMFlow", "bimflow.log");
    public static void Warn(string msg) {
        try {
            System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path));
            System.IO.File.AppendAllText(Path, $"{DateTime.Now:s}  {msg}{Environment.NewLine}");
        } catch { /* logging ne doit jamais throw */ }
    }
}
```

**Validation** : provoquer une erreur (vue sans crop possible, paramètre read-only ciblé) → l'utilisateur voit un récapitulatif d'erreurs et/ou `bimflow.log` contient une entrée, au lieu d'un silence total.

---

## T10 — `ProjectManagerDialog` : le bouton copie le mauvais champ

**Fichier** : `BIMFlowPlugin/UI/ProjectManagerDialog.cs` (ligne 50).
**Confirmé** : le bouton `_btnCopy` est placé à côté de `autoBox` (le « Code Revit automatique ») et libellé pour le copier, mais le handler copie `_codeBox.Text` (le « Code personnalisé »).

**Correctif** : copier le champ auto. `autoBox` est une variable locale du constructeur ; elle est capturée par la lambda, donc la référence fonctionne directement.

Ligne 50, remplacer :
```csharp
try { WF.Clipboard.SetText(_codeBox.Text.Trim()); } catch { }
```
par :
```csharp
try { WF.Clipboard.SetText(autoBox.Text.Trim()); } catch (Exception ex) { BFLog.Warn("Clipboard: " + ex.Message); }
```
(Le `BFLog` vient de T9 ; sinon garder `catch {}`.)

**Validation** : ouvrir « Gérer le projet », cliquer « 📋 Copier », coller → on obtient le **code auto** affiché dans `autoBox`, pas le code personnalisé.

---

## T11 — `SvgPlanExporter` : division par zéro sur crop dégénéré

**Fichier** : `BIMFlowPlugin/Exporters/SvgPlanExporter.cs` (ligne 449).
**Confirmé** : `double scale = Math.Min(imgW / box.SpanX, imgH / box.SpanY);` — si `SpanX == 0` ou `SpanY == 0` (cadrage dégénéré, vue vide), division par zéro → `Infinity`/`NaN` propagé dans toutes les coordonnées SVG (polygones invalides) et potentiel plantage en aval.

**Correctif** : garde préventive en tête de `ProjectRooms` (juste avant la ligne 449) :
```csharp
if (box.SpanX <= 1e-9 || box.SpanY <= 1e-9)
{
    BFLog.Warn($"Crop dégénéré (SpanX={box.SpanX}, SpanY={box.SpanY}) — projection annulée.");
    // Pas de géométrie projetable : renvoyer les pièces sans polygone plutôt que NaN.
    return geoms.Select(g => { g.Data.SvgPolygon = ""; return g.Data; }).ToList();
}
double scale = Math.Min(imgW / box.SpanX, imgH / box.SpanY);
```
(Si `BFLog` non créé, remplacer la ligne `BFLog.Warn(...)` par un commentaire.)

**Validation** : exporter une vue dont le crop est dégénéré/vide → pas d'exception, les pièces sont renvoyées sans polygone (au lieu de coordonnées `NaN`), un avertissement est loggé.

---

## Vérification & validation finale (à exécuter par Antigravity après les tâches)

1. **Build C# propre** :
   ```
   dotnet build -c Release.R24 BIMFlowPlugin/BIMFlowPlugin.csproj
   ```
   Zéro erreur, idéalement zéro nouveau warning. Refaire aussi en config `Release` (Revit 2023) pour non-régression.
2. **Backend** : `params.js` ne renvoie plus « Plan introuvable » quand un code projet est défini (T2). `updates.js` isole bien par code (T1). Tester via `curl`/wrangler sur les fonctions Pages avant déploiement.
3. **Plugin dans Revit 2024** :
   - « Gérer le projet » : icône présente (T4), enregistrement web en 200 sans 401 (T6), bouton copier = code auto (T10).
   - « Envoyer paramètres » : succès après un envoi complet préalable (T2).
   - « Recevoir » : création d'un nouveau paramètre de pièce → binding **instance** sur chaque pièce (T8) ; les erreurs par paramètre sont remontées (T9).
   - Export d'une vue normale : OK ; export d'une vue à crop dégénéré : pas de crash, log présent (T11).
   - UI non figée durablement même en cas de lag réseau (timeouts en place ; pas de régression T5).
4. **Régression d'alignement** : vérifier que les corrections n'ont **pas** altéré l'alignement PNG/polygones (cf. logique de crop/template du `SvgPlanExporter` — voir mémoire projet « Alignment root cause »). T11 ne touche que le cas dégénéré, T7 est cosmétique : aucun impact attendu sur le chemin nominal.

---

## Notes de gouvernance pour l'agent Antigravity

- **Ne déploie pas** sur Cloudflare sans validation explicite de l'utilisateur (action externe/irréversible). Build et test local d'abord.
- **Ignore** le dossier `bimflow-web/netlify/` (legacy mort) et toute mention « WebSocket » dans les `CLAUDE.md` (la comm réelle est HTTP/JSON).
- **Commits** : un commit atomique par tâche (T1…T11), message en français préfixé `fix:`/`feat:`, pour faciliter la revue et le rollback ciblé.
- **Si un fichier ne correspond plus** à ce document (le code a encore bougé), re-vérifie l'état réel avant d'appliquer le diff — ce handoff reflète l'état du dépôt au moment de sa rédaction.
