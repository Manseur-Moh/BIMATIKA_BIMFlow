using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using BIMFlowPlugin.Commands;
using BIMFlowPlugin.Exporters;
using BIMFlowPlugin.UI;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;

namespace BIMFlowPlugin.Commands
{
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class SendToBIMFlowCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData,
                              ref string message,
                              ElementSet elements)
        {
            var uiDoc = commandData.Application.ActiveUIDocument;
            var doc   = uiDoc.Document;

            try
            {
                // Floor plans associated with a level AND containing rooms (empty/level-less
                // plans are hidden from the list to avoid mistakes).
                var combined = new FilteredElementCollector(doc)
                    .OfClass(typeof(ViewPlan))
                    .Cast<ViewPlan>()
                    .Where(v => v.ViewType == ViewType.FloorPlan && !v.IsTemplate && v.GenLevel != null)
                    .Select(v => ((View)v,
                        new FilteredElementCollector(doc, v.Id)
                            .OfCategory(BuiltInCategory.OST_Rooms)
                            .WhereElementIsNotElementType()
                            .GetElementCount()))
                    .Where(x => x.Item2 > 0)
                    .ToList();

                if (combined.Count == 0)
                {
                    TaskDialog.Show("BIMFlow", "Aucun plan avec pièces à envoyer.");
                    return Result.Cancelled;
                }

                // Show multi-view selection dialog
                var dialog = new PlanSelectionDialog(combined);
                if (dialog.ShowDialog() != System.Windows.Forms.DialogResult.OK)
                    return Result.Cancelled;

                var selected = dialog.SelectedPlans;
                if (selected.Count == 0)
                {
                    TaskDialog.Show("BIMFlow", "Aucun plan sélectionné.");
                    return Result.Cancelled;
                }

                if (!BimFlowSender.EnsureAuthenticated())
                {
                    TaskDialog.Show("BIMFlow", "Connexion requise.\nCréez un compte sur bimatika-bimplan.pages.dev.");
                    return Result.Cancelled;
                }

                var (sent, failed, errors) = BimFlowSender.Send(doc, selected);

                string summary = $"Envoi terminé.\n\n✓ {sent} plan{(sent > 1 ? "s" : "")} envoyé{(sent > 1 ? "s" : "")} avec succès.";
                if (failed > 0)
                    summary += $"\n\n✗ {failed} erreur{(failed > 1 ? "s" : "")} :\n" + string.Join("\n", errors);
                summary += "\n\nOuvrez https://bimatika-bimplan.pages.dev/ pour voir les plans.";

                TaskDialog.Show("BIMFlow — Envoi " + (failed == 0 ? "réussi ✓" : "partiel"), summary);

                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show("BIMFlow — Erreur envoi", $"Erreur :\n\n{ex.Message}");
                return Result.Failed;
            }
        }
    }
}
