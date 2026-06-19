# Objectif

1. Réparer le bouton "Importer" sur la page de Création de paramètres (`parametres.html`).
2. Ajouter un bouton "Actualiser depuis Revit" (Reload) sur toutes les pages pour faciliter le rafraîchissement des données après un envoi depuis Revit.

## Explication du bug du bouton "Importer"

Le bouton "Importer" ne fonctionne pas car le système de traduction (`data-en`) remplace tout le contenu HTML (`innerHTML`) du `<label>` lorsqu'il applique la langue (ou même lorsqu'il initialise le texte en français).
Puisque le `<input type="file">` se trouve **à l'intérieur** du `<label>`, il est détruit et recréé. L'écouteur d'événement (`addEventListener`) qui était attaché à l'ancien input est donc perdu, ce qui rend le bouton inactif.

## Modifications Proposées

### 1. `bimflow-web/public/parametres.html`
- **[MODIFY]** Séparer le texte du `<label>` de la balise `<input>`. Je vais placer l'attribut `data-en` sur un `<span>` dédié à l'intérieur du label, de sorte que la traduction n'écrase pas l'élément `<input>`.
- **[MODIFY]** Restreindre l'attribut `accept` à `.xlsx`, car la bibliothèque `ExcelJS` utilisée dans le script ne supporte que ce format pour la lecture.

### 2. `bimflow-web/public/bimflow-projet.js`
- **[MODIFY]** Dans la fonction `injectProjectSwitcher` ou `inject`, je vais créer un nouveau bouton "🔄 Actualiser" (Reload) et l'ajouter à la barre de navigation supérieure (`.topbar-right`). Ce bouton appellera `window.location.reload()` pour recharger les données instantanément après que l'utilisateur a cliqué sur "Envoyer vers BIMFlow" dans Revit.

## Plan de vérification
- Je vais ouvrir le fichier `parametres.html` pour m'assurer que le script s'attache bien à l'input persistant.
- J'injecterai le bouton Actualiser dans `bimflow-projet.js` et vérifierai qu'il s'affiche bien de manière globale (index, fiches, parametres, analyse...).
