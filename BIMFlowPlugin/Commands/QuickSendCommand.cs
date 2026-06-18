using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using System;
using System.Collections.Generic;

namespace BIMFlowPlugin.Commands
{
    /// <summary>
    /// Envoi rapide — pushes only the rooms whose parameters changed since the
    /// last successful send. No PNG re-export, no geometry upload. Relies on the
    /// local diff cache (%AppData%\BIMFlow\cache\*) populated by any previous
    /// "Envoyer vers BIMFlow" or "Envoyer paramètres" operation.
    ///
    /// Use "Envoyer vers BIMFlow" the first time (or after geometry changes).
    /// Use "Envoi rapide" whenever you only change parameter values.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class QuickSendCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var doc = commandData.Application.ActiveUIDocument.Document;

            try
            {
                var favIds = BimFlowSender.LoadFavoriteIds();
                if (favIds.Count == 0)
                {
                    TaskDialog.Show("BIMFlow — Envoi rapide",
                        "Aucun favori enregistré.\n\n" +
                        "Cliquez « Envoyer vers BIMFlow », cochez vos plans habituels, " +
                        "puis cliquez « ⭐ Favori ».\n\n" +
                        "L'envoi rapide mettra ensuite à jour uniquement les paramètres modifiés, " +
                        "sans réexporter l'image du plan.");
                    return Result.Cancelled;
                }

                // Resolve favourite UniqueIds — no project-wide view enumeration.
                var views = new List<ViewPlan>();
                foreach (var uid in favIds)
                {
                    try
                    {
                        if (doc.GetElement(uid) is ViewPlan vp && !vp.IsTemplate)
                            views.Add(vp);
                    }
                    catch { }
                }

                if (views.Count == 0)
                {
                    TaskDialog.Show("BIMFlow — Envoi rapide",
                        "Les plans favoris sont introuvables dans ce projet.\n" +
                        "(Un favori est lié au projet dans lequel il a été enregistré.)");
                    return Result.Cancelled;
                }

                // Send only rooms whose parameters changed since the last snapshot.
                // No PNG export — much faster than a full send.
                var (sent, failed, unchanged, errors) = BimFlowSender.SendParams(doc, views);

                string summary;
                if (sent == 0 && failed == 0)
                {
                    summary = $"Aucune modification détectée.\n\n" +
                              $"Les {unchanged} plan{(unchanged > 1 ? "s" : "")} sont déjà à jour — " +
                              $"aucune valeur de paramètre n'a changé depuis le dernier envoi.";
                }
                else
                {
                    summary = $"Envoi rapide terminé (paramètres seulement).\n\n" +
                              $"✓ {sent} plan{(sent > 1 ? "s" : "")} mis à jour.";
                    if (unchanged > 0)
                        summary += $"\n• {unchanged} plan{(unchanged > 1 ? "s" : "")} inchangé{(unchanged > 1 ? "s" : "")} — ignoré{(unchanged > 1 ? "s" : "")}.";
                    if (failed > 0)
                        summary += $"\n\n✗ {failed} erreur{(failed > 1 ? "s" : "")} :\n" + string.Join("\n", errors);
                }

                summary += "\n\nOuvrez https://bimatika-bimplan.pages.dev/ pour voir les plans.";
                TaskDialog.Show("BIMFlow — Envoi rapide " + (failed == 0 ? "✓" : "partiel"), summary);
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show("BIMFlow — Erreur", $"Erreur lors de l'envoi rapide :\n\n{ex.Message}");
                return Result.Failed;
            }
        }
    }
}
