using Autodesk.Revit.UI;
using System;
using System.IO;
using System.Reflection;

namespace BIMFlowPlugin
{
    /// <summary>
    /// Main application entry point.
    /// Revit calls OnStartup when the addin loads.
    /// Creates a "BIMFlow" ribbon tab with export buttons.
    /// </summary>
    public class Application : IExternalApplication
    {
        public Result OnStartup(UIControlledApplication app)
        {
            try
            {
                // Create ribbon tab
                const string tabName = "BIMFlow";
                app.CreateRibbonTab(tabName);

                // Create panel
                RibbonPanel panel = app.CreateRibbonPanel(tabName, "Export");

                string assemblyPath = Assembly.GetExecutingAssembly().Location;

                // ── Button 1: Send to BIMFlow web app ──
                var sendBtn = new PushButtonData(
                    name:        "SendToBIMFlow",
                    text:        "Envoyer\nvers BIMFlow",
                    assemblyName: assemblyPath,
                    className:   "BIMFlowPlugin.Commands.SendToBIMFlowCommand")
                {
                    ToolTip = "Exporte le plan actif et l'envoie directement vers la plateforme web BIMFlow.",
                    LongDescription =
                        "Exporte les données de la vue active (pièces, surfaces, paramètres)\n" +
                        "et les envoie en un clic vers https://bimatika-bimplan.pages.dev/\n\n" +
                        "Aucun fichier local — les données vont directement au serveur.",
                };

                // ── Button 1b: Fast Send — sends saved favourite plans directly ──
                var quickBtn = new PushButtonData(
                    name:        "QuickSendBIMFlow",
                    text:        "Envoi\nrapide",
                    assemblyName: assemblyPath,
                    className:   "BIMFlowPlugin.Commands.QuickSendCommand")
                {
                    ToolTip = "Envoie directement vos plans favoris, sans attendre le chargement de toutes les vues.",
                    LongDescription =
                        "Renvoie en un clic la sélection de plans enregistrée comme favori\n" +
                        "(bouton ⭐ Favori dans « Envoyer vers BIMFlow »).\n\n" +
                        "Aucune énumération des vues du projet — envoi immédiat.",
                };

                // ── Button 1c: Send room PARAMETERS only (fast update, no image) ──
                var paramsBtn = new PushButtonData(
                    name:        "SendParamsBIMFlow",
                    text:        "Envoyer\nparamètres",
                    assemblyName: assemblyPath,
                    className:   "BIMFlowPlugin.Commands.SendParamsCommand")
                {
                    ToolTip = "Met à jour uniquement les paramètres des pièces (sans réexporter les plans).",
                    LongDescription =
                        "Envoi rapide : met à jour les valeurs de paramètres des pièces\n" +
                        "sur des plans DÉJÀ envoyés, sans réexporter l'image ni la géométrie.\n\n" +
                        "Idéal quand les plans n'ont pas changé — beaucoup plus rapide.",
                };

                // ── Button 2: Receive updates from BIMFlow web app ──
                var receiveBtn = new PushButtonData(
                    name:        "ReceiveFromBIMFlow",
                    text:        "Recevoir\ndepuis BIMFlow",
                    assemblyName: assemblyPath,
                    className:   "BIMFlowPlugin.Commands.ReceiveFromBIMFlowCommand")
                {
                    ToolTip = "Récupère les modifications faites sur le site web et les applique dans Revit.",
                };

                panel.AddItem(sendBtn);
                panel.AddItem(quickBtn);
                panel.AddItem(paramsBtn);
                panel.AddSeparator();
                panel.AddItem(receiveBtn);

                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                TaskDialog.Show("BIMFlow — Erreur démarrage", ex.Message);
                return Result.Failed;
            }
        }

        public Result OnShutdown(UIControlledApplication app) => Result.Succeeded;
    }
}
