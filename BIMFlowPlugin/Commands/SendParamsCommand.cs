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
    /// Envoyer paramètres — fast update of room parameters only (no image/geometry).
    /// Requires the plan(s) to have been sent at least once. Uses favourites if set,
    /// otherwise shows the plan picker.
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
                        try { if (doc.GetElement(uid) is ViewPlan vp && !vp.IsTemplate) views.Add(vp); } catch { }
                }

                // 2. No favourites → let the user pick.
                if (views.Count == 0)
                {
                    var allPlans = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
                        .Where(v => v.ViewType == ViewType.FloorPlan && !v.IsTemplate).ToList();
                    if (allPlans.Count == 0) { TaskDialog.Show("BIMFlow", "Aucun plan d'étage."); return Result.Cancelled; }
                    var withCount = allPlans.Select(v => (v, new FilteredElementCollector(doc, v.Id)
                        .OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType().GetElementCount())).ToList();
                    var dialog = new PlanSelectionDialog(withCount);
                    if (dialog.ShowDialog() != System.Windows.Forms.DialogResult.OK) return Result.Cancelled;
                    views = dialog.SelectedPlans;
                }

                if (views.Count == 0) { TaskDialog.Show("BIMFlow", "Aucun plan sélectionné."); return Result.Cancelled; }

                var (sent, failed, errors) = BimFlowSender.SendParams(doc, views);

                string summary = $"Paramètres envoyés (mise à jour rapide).\n\n✓ {sent} plan{(sent > 1 ? "s" : "")} mis à jour.";
                if (failed > 0)
                    summary += $"\n\n✗ {failed} erreur{(failed > 1 ? "s" : "")} :\n" + string.Join("\n", errors)
                             + "\n\nAstuce : envoyez d'abord le plan complet (Envoyer vers BIMFlow) si le niveau n'existe pas encore en ligne.";
                summary += "\n\nLes plans/pièces ne sont pas réexportés — seules les valeurs de paramètres sont mises à jour.";

                TaskDialog.Show("BIMFlow — Paramètres " + (failed == 0 ? "✓" : "partiel"), summary);
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
