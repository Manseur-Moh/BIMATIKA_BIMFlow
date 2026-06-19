using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using BIMFlowPlugin.UI;
using System;
using System.Collections.Generic;
using System.Linq;

namespace BIMFlowPlugin.Commands
{
    /// <summary>
    /// Envoyer paramètres — fast differential update.
    /// Collects the current parameter values for every room, compares them against
    /// the locally-cached snapshot from the last successful send, and uploads ONLY
    /// the rooms that have at least one changed parameter value.
    ///
    /// No image re-export, no geometry upload.  Server merges the payload into the
    /// existing plan (polygons + image are kept).
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class SendParamsCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var doc = commandData.Application.ActiveUIDocument.Document;
            try
            {
                List<ViewPlan> views = new List<ViewPlan>();

                // 1. Prefer favourites — no project-wide enumeration (fast).
                var favIds = BimFlowSender.LoadFavoriteIds();
                if (favIds.Count > 0)
                {
                    foreach (var uid in favIds)
                        try { if (doc.GetElement(uid) is ViewPlan vp && !vp.IsTemplate) views.Add(vp); }
                        catch { }
                }

                // 2. No favourites → ask the user.
                if (views.Count == 0)
                {
                    var allPlans = new FilteredElementCollector(doc)
                        .OfClass(typeof(ViewPlan))
                        .Cast<ViewPlan>()
                        .Where(v => v.ViewType == ViewType.FloorPlan && !v.IsTemplate)
                        .ToList();

                    if (allPlans.Count == 0)
                    {
                        TaskDialog.Show("BIMFlow", "Aucun plan d'étage.");
                        return Result.Cancelled;
                    }

                    var withCount = allPlans.Select(v =>
                        (v, new FilteredElementCollector(doc, v.Id)
                              .OfCategory(BuiltInCategory.OST_Rooms)
                              .WhereElementIsNotElementType()
                              .GetElementCount()))
                        .ToList();

                    var dialog = new PlanSelectionDialog(withCount);
                    if (dialog.ShowDialog() != System.Windows.Forms.DialogResult.OK)
                        return Result.Cancelled;

                    views = dialog.SelectedPlans;
                }

                if (views.Count == 0)
                {
                    TaskDialog.Show("BIMFlow", "Aucun plan sélectionné.");
                    return Result.Cancelled;
                }

                if (!BimFlowSender.EnsureAuthenticated())
                {
                    TaskDialog.Show("BIMFlow", "Connexion requise.\nCréez un compte sur bimatika-bimplan.pages.dev.");
                    return Result.Cancelled;
                }

                // 3. Differential send — only rooms with changed parameters.
                var (sent, failed, unchanged, errors) = BimFlowSender.SendParams(doc, views);

                string title = "BIMFlow — Paramètres " + (failed == 0 ? "✓" : "partiel");
                string summary;

                if (sent == 0 && failed == 0)
                {
                    summary = $"Aucune modification détectée.\n\n" +
                              $"Les {unchanged} plan{(unchanged > 1 ? "s" : "")} sont déjà à jour — " +
                              $"aucune valeur de paramètre n'a changé depuis le dernier envoi.\n\n" +
                              $"Pour forcer une mise à jour complète, utilisez « Envoyer vers BIMFlow ».";
                }
                else
                {
                    summary = $"Mise à jour différentielle terminée.\n\n";
                    if (sent > 0)
                        summary += $"✓ {sent} plan{(sent > 1 ? "s" : "")} mis à jour (pièces modifiées seulement).\n";
                    if (unchanged > 0)
                        summary += $"• {unchanged} plan{(unchanged > 1 ? "s" : "")} inchangé{(unchanged > 1 ? "s" : "")} — ignoré{(unchanged > 1 ? "s" : "")}.\n";
                    if (failed > 0)
                        summary += $"\n✗ {failed} erreur{(failed > 1 ? "s" : "")} :\n" + string.Join("\n", errors) +
                                   "\n\nAstuce : utilisez « Envoyer vers BIMFlow » si le plan n'a pas encore été envoyé.";

                    summary += "\n\nSeules les pièces modifiées ont été transmises — l'image et la géométrie sont conservées.";
                }

                TaskDialog.Show(title, summary);
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show("BIMFlow — Erreur", $"Erreur lors de l'envoi des paramètres :\n\n{ex.Message}");
                return Result.Failed;
            }
        }
    }
}
