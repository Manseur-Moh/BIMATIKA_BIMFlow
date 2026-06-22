using Autodesk.Revit.UI;
using System;
using System.IO;
using System.Reflection;
using System.Windows.Media.Imaging;

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
                const string tabName = "BIMATIKA-BIMFLOW";
                app.CreateRibbonTab(tabName);
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
                    LargeImage = LoadIcon("send_32.png"),
                    Image      = LoadIcon("send_16.png"),
                };

                // ── Button 1b: Fast Send ──
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
                    LargeImage = LoadIcon("quicksend_32.png"),
                    Image      = LoadIcon("quicksend_16.png"),
                };

                // ── Button 1c: Send room PARAMETERS only ──
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
                    LargeImage = LoadIcon("params_32.png"),
                    Image      = LoadIcon("params_16.png"),
                };

                // ── Button 2: Receive updates ──
                var receiveBtn = new PushButtonData(
                    name:        "ReceiveFromBIMFlow",
                    text:        "Recevoir\ndepuis BIMFlow",
                    assemblyName: assemblyPath,
                    className:   "BIMFlowPlugin.Commands.ReceiveFromBIMFlowCommand")
                {
                    ToolTip = "Récupère les modifications faites sur le site web et les applique dans Revit.",
                    LargeImage = LoadIcon("receive_32.png"),
                    Image      = LoadIcon("receive_16.png"),
                };

                // ── Button: Manage Project ──
                var projectBtn = new PushButtonData(
                    name:         "ManageProject",
                    text:         "Gérer\nle projet",
                    assemblyName: assemblyPath,
                    className:    "BIMFlowPlugin.Commands.ManageProjectCommand")
                {
                    ToolTip = "Définissez le code et le nom de ce projet Revit pour BIMFlow.",
                    LongDescription =
                        "Crée ou modifie le code projet utilisé lors des envois vers BIMFlow.\n\n" +
                        "Utiliser un code unique par projet évite que les plans d'un projet\n" +
                        "écrasent ceux d'un autre (problème fréquent avec les fichiers copiés).\n\n" +
                        "Le code peut être partagé avec l'équipe pour accéder au projet sur le web.",
                    LargeImage = LoadIcon("manage_32.png"),
                    Image      = LoadIcon("manage_16.png"),
                };

                panel.AddItem(sendBtn);
                panel.AddItem(quickBtn);
                panel.AddItem(paramsBtn);
                panel.AddSeparator();
                panel.AddItem(receiveBtn);
                panel.AddSeparator();
                panel.AddItem(projectBtn);

                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                TaskDialog.Show("BIMFlow — Erreur démarrage", ex.Message);
                return Result.Failed;
            }
        }

        private static BitmapImage? LoadIcon(string filename)
        {
            try
            {
                var asm    = Assembly.GetExecutingAssembly();
                var name   = $"BIMFlowPlugin.Icons.{filename}";
                using var stream = asm.GetManifestResourceStream(name);
                if (stream == null) return null;
                var img = new BitmapImage();
                img.BeginInit();
                img.StreamSource    = stream;
                img.CacheOption     = BitmapCacheOption.OnLoad;
                img.EndInit();
                img.Freeze();
                return img;
            }
            catch { return null; }
        }

        public Result OnShutdown(UIControlledApplication app) => Result.Succeeded;
    }
}
