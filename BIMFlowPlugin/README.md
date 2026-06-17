# BIMFlow Plugin — Revit 2024+
## Export SVG Plan + Paramètres de Pièces → Plateforme Web BIMFlow

---

## Ce que fait le plug-in

Pour chaque vue en plan Revit, il génère **3 fichiers** :

| Fichier | Contenu |
|---------|---------|
| `*.svg` | Plan interactif : image PNG en fond + polygones SVG des pièces |
| `*.bimflow.json` | Tous les paramètres de pièces + image PNG en base64 |
| `*_background.png` | Image raster du plan (150 DPI) |

### Le fichier SVG exporté
- L'image PNG du plan Revit est **embarquée** directement dans le SVG (`data:image/png;base64,...`)
- Chaque pièce est un `<polygon>` **transparent** avec tous ses paramètres en attributs `data-*`
- Le fichier SVG s'ouvre directement dans un navigateur et fonctionne avec la plateforme BIMFlow

---

## Prérequis

| Élément | Version |
|---------|---------|
| Revit | 2024 ou 2025 |
| .NET Framework | 4.8 |
| Windows | 10 / 11 (64-bit) |

---

## Installation

### Option A — Compilation (recommandé)

1. **Installer Visual Studio 2022** (Community gratuit)
   - Workload : `.NET desktop development`

2. **Vérifier le chemin Revit API**
   ```xml
   <!-- Dans BIMFlowPlugin.csproj — adapter si nécessaire -->
   <HintPath>C:\Program Files\Autodesk\Revit 2024\RevitAPI.dll</HintPath>
   ```

3. **Compiler**
   ```
   cd BIMFlowPlugin
   dotnet build -c Release
   ```
   → Les fichiers sont copiés automatiquement dans :
   `%APPDATA%\Autodesk\Revit\Addins\2024\`

4. **Redémarrer Revit** → onglet **BIMFlow** apparaît dans le ruban

### Option B — Copie manuelle (sans compilation)

1. Copier `BIMFlowPlugin.dll` dans :
   ```
   C:\Users\[Vous]\AppData\Roaming\Autodesk\Revit\Addins\2024\
   ```

2. Copier `BIMFlow.addin` dans le même dossier

3. Redémarrer Revit

---

## Utilisation

1. **Ouvrir** votre projet Revit (`.rvt`)
2. **Activer** une vue en plan (double-clic dans l'arborescence)
3. Aller dans l'onglet **BIMFlow** du ruban
4. Cliquer **Export SVG Plan**
5. Confirmer le dossier de sortie → **OK**
6. Les fichiers apparaissent sur le Bureau dans `BIMFlow_Export/`

### Export tous niveaux
Cliquer **Export Tous Niveaux** → exporte automatiquement tous les plans d'étage du projet.

---

## Paramètres exportés

### Identification
- ID Revit, Numéro, Nom, Niveau, Département, Phase, Commentaires

### Surfaces & Volumes
- Surface nette (m²), Surface brute (m²), Volume (m³), Hauteur libre (m), Périmètre (m)

### Finitions
- Revêtement Sol, Revêtement Mur, Revêtement Plafond, Plinthe

### Technique
- Zone CVC, Zone Éclairage, Résistance Feu, Sprinkler, PMR, Charge Occupation

---

## Paramètres partagés personnalisés

Pour que le plug-in lise vos paramètres partagés, nommez-les ainsi dans Revit :

| Paramètre Revit | Nom attendu |
|-----------------|-------------|
| Finition sol | `Revêtement Sol` ou `Floor Finish` |
| Finition mur | `Revêtement Mur` ou `Wall Finish` |
| Finition plafond | `Revêtement Plafond` ou `Ceiling Finish` |
| Zone CVC | `Zone CVC` ou `HVAC Zone` |
| Résistance au feu | `Résistance Feu` ou `Fire Rating` |
| Sprinkler | `Sprinkler` (Oui/Non) |
| PMR | `PMR` (Oui/Non) |

---

## Structure du JSON exporté

```json
{
  "ProjectName": "Résidence Dessina",
  "ProjectNumber": "2024-001",
  "LevelName": "Niveau 1",
  "ExportDate": "2025-06-10 14:32",
  "RevitVersion": "2024",
  "ImageWidth": 2048,
  "ImageHeight": 1680,
  "ImageBase64": "iVBORw0KGgoAAAANSUhEUgAA...",
  "Rooms": [
    {
      "RevitId": "524631",
      "Number": "101",
      "Name": "Chambre #1",
      "LevelName": "Niveau 1",
      "Department": "Logement A",
      "AreaNet": 18.85,
      "Volume": 51.7,
      "Height": 2.74,
      "FinishFloor": "Plancher chêne",
      "SvgPolygon": "245,312 687,312 687,891 245,891",
      "CentroidX": 466.0,
      "CentroidY": 601.5
    }
  ]
}
```

---

## Structure du SVG exporté

```xml
<svg viewBox="0 0 2048 1680">
  <!-- Image raster du plan en fond -->
  <image href="data:image/png;base64,..." width="2048" height="1680"/>

  <!-- Polygones interactifs — transparents par défaut -->
  <g id="rooms">
    <polygon
      id="room-524631"
      class="bimflow-room"
      points="245,312 687,312 687,891 245,891"
      fill="transparent"
      stroke="transparent"
      data-id="524631"
      data-name="Chambre #1"
      data-area="18.85"
      data-volume="51.7"
      data-finish-floor="Plancher chêne"
      ...
    />
  </g>
</svg>
```

La plateforme web BIMFlow lit les attributs `data-*` pour peupler le panneau de détail.

---

## Importer dans la plateforme BIMFlow

1. Dans BIMFlow Web → cliquer **⬇ Importer depuis Revit**
2. Glisser le fichier `*.bimflow.json` ou `*.svg`
3. Le plan et les pièces s'affichent automatiquement

---

## Support Revit 2025

Le même plug-in fonctionne sur Revit 2025. Changer le chemin dans `.csproj` :
```xml
<HintPath>C:\Program Files\Autodesk\Revit 2025\RevitAPI.dll</HintPath>
```
Et déployer dans :
```
%APPDATA%\Autodesk\Revit\Addins\2025\
```

---

## Fichiers du projet

```
BIMFlowPlugin/
├── BIMFlow.addin               ← Manifeste Revit
├── BIMFlowPlugin.csproj        ← Projet .NET
├── Application.cs              ← Boutons ruban
├── Commands/
│   └── ExportSvgCommand.cs     ← Commandes export
├── Exporters/
│   └── SvgPlanExporter.cs      ← Logique export SVG/JSON/PNG
├── Models/
│   └── RoomData.cs             ← Modèles de données
├── UI/
│   └── ExportDialog.cs         ← Dialogues
└── README.md                   ← Ce fichier
```
