# Plan de correction et d'amélioration de BIMFlow

Ce document résume toutes les erreurs identifiées lors de l'analyse du code source et propose les modifications techniques pour les corriger.

## 1. Serveur Cloudflare / Web Frontend (JavaScript)

### 1.1 Conflits de synchronisation dans `updates.js`
- **Problème** : Les mises à jour de paramètres depuis le site web vers Revit sont stockées dans une clé unique et globale `"pending"`. Cela signifie que si l'utilisateur A et l'utilisateur B modifient deux projets différents en même temps, l'un écrase la file d'attente de l'autre.
- **Modification** : Séparer la clé par projet (ex: `"pending:" + payload.ProjectCode` ou `ProjectName`). Le plugin Revit devra inclure le nom ou le code du projet lorsqu'il fera la requête `GET /api/updates`.

### 1.2 Incohérence des clés entre `upload.js` et `params.js`
- **Problème** : `upload.js` génère la clé de sauvegarde en utilisant `ProjectCode__LevelName` si le code projet est défini. Cependant, `params.js` utilise aveuglément `ProjectName__LevelName`. Conséquence : la fonctionnalité "Envoyer Paramètres" échoue si on a défini un code projet.
- **Modification** : Modifier `params.js` pour inclure la logique de fallback vers `ProjectCode` de la même façon que `upload.js`. 

### 1.3 Performance de suppression `plans.js` (N+1 Problem)
- **Problème** : La route `DELETE` boucle sur toutes les clés et fait un `await kv.get()` pour chacune afin de vérifier le `ProjectCode`. Sur un gros volume, cela mènera à une erreur Timeout.
- **Modification** : Optimiser cette récupération ou s'assurer que les clés de métadonnées incluent le code projet directement dans leur nom.

---

## 2. Plugin Revit (C#)

### 2.1 Interface et Icônes manquantes
- **Problème** : Le fichier `.csproj` et le code de `Application.cs` essaient de charger `project_32.png` et `project_16.png`, mais ces icônes n'existent pas et le code ne gère pas proprement l'exception.
- **Modification** : Ajouter ou remplacer l'icône manquante pour le bouton "Gérer le projet", corriger la déclaration dans le `.csproj`.

### 2.2 Problèmes de requêtes HTTP et de réseau
- **Problème** : Multiples instanciations de `HttpClient` (fuites de sockets). Utilisation généralisée de requêtes asynchrones bloquantes (`.GetAwaiter().GetResult()`) ce qui fige l'interface de Revit.
- **Modification** : 
  - Consolider vers un seul `HttpClient` global partagé.
  - S'assurer que le header `Authorization` est bien passé dans `ManageProjectCommand.cs` (actuellement manquant, ce qui provoque une erreur 401 Unauthorized lors de l'enregistrement du projet).

### 2.3 Erreur d'API Revit dans `ReceiveFromBIMFlowCommand.cs`
- **Problème 1** : Le code teste `param.AsElementId() != null`. Depuis Revit 2024, `ElementId` est une structure (struct), ce qui rend cette vérification toujours vraie et mène à des bugs.
  - **Modification** : Remplacer par `targetId != ElementId.InvalidElementId`.
- **Problème 2** : Le plugin tente d'attacher de nouveaux paramètres aux Pièces (Rooms) en utilisant `TypeBinding`. 
  - **Modification** : Les pièces étant des éléments d'instance, il faut corriger cela en `InstanceBinding`.

### 2.4 Erreurs silencieuses (Catch-all)
- **Problème** : De nombreux blocs `catch { }` cachent des erreurs.
- **Modification** : Ajouter des logs minimaux ou des retours d'informations à l'utilisateur lors d'erreurs internes (surtout lors de la génération SVG ou de l'enregistrement de fichiers).

### 2.5 Bug UI dans le `ProjectManagerDialog`
- **Problème** : Le bouton de copie copie la valeur du "Code personnalisé" même si l'utilisateur essaie de copier le "Code auto-généré".
- **Modification** : Lier le bouton de copie au bon champ de saisie (`autoBox`).

### 2.6 Division par Zéro dans l'export SVG (`SvgPlanExporter.cs`)
- **Problème** : Si une vue a un cadrage dégénéré (`SpanX` ou `SpanY` = 0), le calcul d'échelle va provoquer une division par zéro (`Math.Min(imgW / box.SpanX, ...)`).
- **Modification** : Ajouter une vérification préventive `if (box.SpanX > 0 && box.SpanY > 0)` avant le calcul de l'échelle.

## Vérification et Validation

Une fois les modifications implémentées, nous validerons en :
1. Compilant le projet C# sans erreurs ni avertissements majeurs (ciblage Revit 2024).
2. Vérifiant que l'export des paramètres n'émet plus de "Plan introuvable".
3. Validant que l'UI de Revit ne bloque plus indéfiniment sans raison en cas de lag réseau.
