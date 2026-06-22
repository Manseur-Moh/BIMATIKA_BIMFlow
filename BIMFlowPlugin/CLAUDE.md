# PROJET BIMFlowPlugin - Plugin Revit

## STACK
- Langage : C#
- API : Revit API
- Communication : JSON HTTP vers bimflow-web (Cloudflare Pages)

## COMMANDES
- Compilation : dotnet build -c Release.R24 BIMFlowPlugin.csproj
- Déploiement : Copy-Item bin\Release.R24\net48\BIMFlowPlugin.dll $env:APPDATA\Autodesk\Revit\Addins\2024\

## WORKFLOW CLAUDE + OLLAMA
Claude = manager/vérificateur. Ollama (qwen2.5-coder:7b) = exécutant.

Étapes obligatoires pour chaque tâche :
1. Claude lit les fichiers concernés
2. Claude rédige un prompt précis avec le contexte complet
3. Claude appelle Ollama : curl http://localhost:11434/api/chat
4. Claude **révise** la réponse d'Ollama (bugs, sécurité, style)
5. Claude applique les changements (Edit/Write) — jamais Ollama directement
6. Claude build + vérifie (0 erreurs de compilation)
7. Claude déploie UNIQUEMENT après vérification

## RÈGLES
- Ne jamais déployer sans vérification (build OK + review)
- Toujours copier le DLL dans Revit\Addins\2024\ après build
- Push git uniquement après déploiement confirmé
- xcopy post-build échoue car Revit n'est pas au chemin attendu — copier manuellement

## LIENS
- App web : ../bimflow-web (Cloudflare Pages : bimatika-bimplan.pages.dev)
- Ollama local : http://localhost:11434 — modèle : qwen2.5-coder:7b
