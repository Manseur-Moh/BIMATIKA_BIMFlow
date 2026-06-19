# Guide d'exécution amélioré — Fix « Importer » + bouton « Actualiser »

> **But de ce document.** Reprendre le plan `Fix_Import_and_Reload.md` et le transformer en **runbook exécutable** : étapes ordonnées, ancres fichier/ligne exactes, code précis, pièges manqués par le plan d'origine, et un protocole de vérification réel (local + prod). Rédigé après relecture du code réel.
>
> **Statut constaté au moment de la rédaction :** les deux modifications principales sont **déjà appliquées** dans le working tree (non commitées). Ce guide sert donc à la fois de **validation** de l'existant et de **checklist de finition** (un point oublié + déploiement).

---

## 0. Cause racine confirmée (pourquoi « Importer » ne marchait pas)

Fichier `bimflow-web/public/parametres.html`, fonction `applyLang` (ligne **351**) :
```js
document.querySelectorAll('[data-en]').forEach(el=>{
  if(el._fr===undefined)el._fr=el.innerHTML;
  el.innerHTML=(l==='en')?el.getAttribute('data-en'):el._fr;   // ← réécrit innerHTML
});
```
L'ancien markup plaçait `data-en` **sur le `<label>`** qui **contenait** le `<input type="file">`. Dès que `applyLang` réécrivait `innerHTML` du label (au switch de langue), l'`<input>` était détruit/recréé → l'écouteur `change` attaché à `#fileImport` (ligne **328**) était perdu → bouton inerte.

✅ Le correctif déplace `data-en` sur un `<span>` enfant, donc `applyLang` ne réécrit plus que le span ; l'`<input>` (frère du span) survit et conserve son écouteur.

---

## Étape 1 — `parametres.html` : isoler le texte traduit de l'input

**Ancre** : ligne **137** (toolbar de création de paramètres).

**État attendu (déjà en place)** :
```html
<label class="filebtn"><span data-en="&#8593; Import">&#8593; Importer</span><input type="file" id="fileImport" accept=".xlsx" hidden/></label>
```
Points de contrôle :
- [x] `data-en` est sur le `<span>`, **pas** sur le `<label>`.
- [x] L'`<input id="fileImport">` est en dehors de tout élément `[data-en]`.
- [x] `accept=".xlsx"` (ExcelJS ne lit que le format OOXML `.xlsx`, pas `.xls` binaire ni `.csv`).

> ⚠️ **Piège oublié par le plan d'origine** : restreindre `accept` à `.xlsx` est correct, **mais** le message d'état vide (lignes **158-159**) promet encore « Excel / CSV ». Incohérence à corriger.

**[À FAIRE — correctif manquant]** Remplacer aux lignes 158-159 la mention « Excel / CSV » par « Excel (.xlsx) » :
```html
<div class="empty-state" id="emptyState" data-en="No parameters&lt;p&gt;Click &laquo; + Add row &raquo; or import an Excel (.xlsx) file&lt;/p&gt;">
  Aucun param&egrave;tre<p>Cliquez &laquo; + Ajouter ligne &raquo; ou importez un fichier Excel (.xlsx)</p>
```
*(Alternative, si le support CSV est souhaité : garder `accept=".xlsx,.csv"` et ajouter une branche de lecture CSV dans le handler ligne 328 — hors périmètre de ce fix ; choisir l'option « .xlsx seul » par défaut.)*

---

## Étape 2 — `bimflow-projet.js` : bouton « Actualiser » global

**Ancre** : fonction d'injection de la topbar (~ligne **154**), CSS `.bfp-gear-btn` déjà défini (lignes **69-75**).

**État attendu (déjà en place)** :
```js
function injectReloadButton(tbr) {
  const btn = document.createElement('button');
  btn.className = 'bfp-gear-btn';
  btn.style.marginRight = '4px';
  btn.innerHTML = `<span style="font-size:14px">🔄</span><span style="font-size:12px;font-weight:700" data-en="Reload">Actualiser</span>`;
  btn.title = "Actualiser les données";
  btn.addEventListener('click', () => window.location.reload());
  tbr.insertBefore(btn, tbr.firstChild);
}
```
Et l'appel `injectReloadButton(tbr);` avant `injectProjectSwitcher(tbr);` dans l'injecteur principal.

Points de contrôle :
- [x] Réutilise la classe existante `.bfp-gear-btn` (cohérence visuelle, pas de CSS orphelin).
- [x] Cible `.tbr, .topbar-right` → présent sur **6 pages** (`index`, `fiches`, `analyse`, `parametres`, `projets`, `profil`). Le bouton apparaît donc globalement.
- [x] `data-en="Reload"` sur le span texte → i18n cohérent avec le reste.

> 💡 **Amélioration recommandée (optionnelle)** : `window.location.reload()` recharge toute la page. Sur les pages qui exposent déjà une fonction de rechargement de données AJAX (ex. `loadPlans()` / `loadProjects()`), préférer appeler cette fonction si elle existe pour éviter un flash complet :
> ```js
> btn.addEventListener('click', () => {
>   if (typeof window.bfReload === 'function') window.bfReload();
>   else window.location.reload();
> });
> ```
> À ne faire que si une page expose un hook ; sinon `reload()` reste l'option sûre et universelle.

---

## Étape 3 — Vérification (protocole réel, à exécuter avant déploiement)

### 3.1 Aperçu local
```
cd bimflow-web
npx wrangler pages dev
```
Ouvrir l'URL locale affichée.

### 3.2 Test du bouton « Importer » (le bug initial)
1. Page **Paramètres** → cliquer « ↑ Importer » → la boîte de fichiers s'ouvre. ✔
2. Sélectionner un `.xlsx` valide (colonnes Nom/Type/Groupe…) → les lignes se remplissent. ✔
3. **Test de non-régression i18n (essentiel)** : cliquer le bouton **EN/FR** pour basculer la langue, **puis re-cliquer « Importer »** → la boîte de fichiers s'ouvre toujours (l'input n'est plus détruit par `applyLang`). ✔
4. Recharger la page en anglais (langue persistée en `localStorage`) → « Importer » fonctionne dès le premier clic. ✔

### 3.3 Test du bouton « Actualiser »
- Le bouton 🔄 apparaît en haut à droite sur `index`, `fiches`, `analyse`, `parametres`, `projets`, `profil`. ✔
- Après un envoi depuis Revit (« Envoyer vers BIMFlow »), cliquer 🔄 → les nouvelles données apparaissent. ✔
- Bascule EN/FR → le libellé devient « Reload » / « Actualiser ». ✔

### 3.4 Console
- Aucune erreur JS au chargement ni au clic (vérifier l'onglet Console du navigateur).

---

## Étape 4 — Livraison

> ⚠️ Action externe : ne déployer qu'après validation locale (3.x) réussie.

```
# Depuis la racine du dépôt
git add bimflow-web/public/parametres.html bimflow-web/public/bimflow-projet.js
git commit -m "fix(web): repair Import button (i18n innerHTML) + add global Reload button"
git push origin main        # déclenche le build Cloudflare Pages (intégration Git)

# Déploiement explicite optionnel (certitude immédiate)
cd bimflow-web && npx wrangler pages deploy
```
Vérifier en prod : https://bimatika-bimplan.pages.dev/parametres.html

---

## Récapitulatif des écarts vs plan d'origine

| Élément | Plan d'origine | Ce guide |
|---------|----------------|----------|
| Cause racine | Décrite correctement | **Confirmée** avec ancre (ligne 351) |
| `data-en` sur span | Proposé | Vérifié appliqué (ligne 137) |
| `accept` → `.xlsx` | Proposé | Appliqué **+ corrige le texte « Excel / CSV » oublié** (l.158-159) |
| Bouton Reload | Proposé | Vérifié appliqué + variante AJAX optionnelle |
| Vérification | 2 lignes vagues | **Protocole reproductible** (local + test i18n + prod) |
| Déploiement | Absent | Étapes Git + wrangler ajoutées |
