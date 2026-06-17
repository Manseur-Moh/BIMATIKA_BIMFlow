using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using System;
using System.Collections.Generic;

namespace BIMFlowPlugin.Commands
{
    /// <summary>
    /// Envoi rapide — sends the favourite plans directly, WITHOUT enumerating/counting
    /// every view in the project or showing the selection dialog. Favourites are saved
    /// from the normal "Envoyer vers BIMFlow" dialog via the ⭐ Favori button.
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
                        "Aucun favori enregistré.\n\nCliquez « Envoyer vers BIMFlow », cochez vos plans habituels, puis « ⭐ Favori ». " +
                        "L'envoi rapide les renverra ensuite en un clic, sans attendre le chargement de toutes les vues.");
                    return Result.Cancelled;
                }

                // Resolve favourite UniqueIds directly — no project-wide view enumeration.
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

                var (sent, failed, errors) = BimFlowSender.Send(doc, views);

                string summary = $"Envoi rapide terminé.\n\n✓ {sent} plan{(sent > 1 ? "s" : "")} envoyé{(sent > 1 ? "s" : "")}.";
                if (failed > 0)
                    summary += $"\n\n✗ {failed} erreur{(failed > 1 ? "s" : "")} :\n" + string.Join("\n", errors);
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
