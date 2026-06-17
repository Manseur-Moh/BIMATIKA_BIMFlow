using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using BIMFlowPlugin.Exporters;
using BIMFlowPlugin.UI;
using System;
using System.IO;
using System.Linq;

namespace BIMFlowPlugin.Commands
{
    /// <summary>
    /// Command: Export SVG Plan
    /// Triggered by the "Export SVG Plan" ribbon button.
    /// Works on the currently active ViewPlan.
    /// </summary>
    [Transaction(TransactionMode.ReadOnly)]
    [Regeneration(RegenerationOption.Manual)]
    public class ExportSvgCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData,
                              ref string message,
                              ElementSet elements)
        {
            var uiDoc = commandData.Application.ActiveUIDocument;
            var doc   = uiDoc.Document;

            try
            {
                // ── Validate active view ──
                if (doc.ActiveView is not ViewPlan viewPlan)
                {
                    TaskDialog.Show("BIMFlow",
                        "Veuillez activer un plan (Vue en plan) avant d'exporter.\n\n" +
                        "Vue actuelle : " + doc.ActiveView.ViewType);
                    return Result.Cancelled;
                }

                // ── Check rooms exist ──
                var roomCount = new FilteredElementCollector(doc, viewPlan.Id)
                    .OfCategory(BuiltInCategory.OST_Rooms)
                    .WhereElementIsNotElementType()
                    .GetElementCount();

                if (roomCount == 0)
                {
                    TaskDialog.Show("BIMFlow",
                        "Aucune pièce trouvée dans la vue active.\n\n" +
                        "Assurez-vous que les pièces sont placées et visibles dans cette vue.");
                    return Result.Cancelled;
                }

                // ── Show export dialog ──
                var dialog = new ExportDialog(viewPlan.Name, roomCount);
                if (!dialog.ShowDialog()) return Result.Cancelled;

                string outputDir = dialog.OutputDirectory;

                // ── Run export ──
                using var progress = new ProgressDialog("Export BIMFlow en cours…");
                progress.Show();

                var exporter = new SvgPlanExporter(doc, viewPlan, outputDir);
                var export   = exporter.Run();

                progress.Close();

                // ── Success dialog ──
                var result = TaskDialog.Show(
                    "BIMFlow — Export réussi ✓",
                    $"Plan exporté avec succès !\n\n" +
                    $"Projet : {export.ProjectName}\n" +
                    $"Niveau : {export.LevelName}\n" +
                    $"Pièces : {export.Rooms.Count}\n" +
                    $"Image  : {export.ImageWidth} × {export.ImageHeight} px\n\n" +
                    $"Fichiers créés dans :\n{outputDir}\n\n" +
                    $"• {Path.GetFileNameWithoutExtension(outputDir)}*.svg\n" +
                    $"• *.bimflow.json\n" +
                    $"• *_background.png",
                    TaskDialogCommonButtons.Ok | TaskDialogCommonButtons.Cancel,
                    TaskDialogResult.Ok);

                // Open folder in Explorer
                if (result == TaskDialogResult.Ok)
                    System.Diagnostics.Process.Start("explorer.exe", outputDir);

                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show("BIMFlow — Erreur",
                    $"Erreur lors de l'export :\n\n{ex.Message}\n\n{ex.StackTrace}");
                return Result.Failed;
            }
        }
    }

    /// <summary>
    /// Command: Export all levels at once.
    /// </summary>
    [Transaction(TransactionMode.ReadOnly)]
    [Regeneration(RegenerationOption.Manual)]
    public class ExportAllLevelsCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData,
                              ref string message,
                              ElementSet elements)
        {
            var uiDoc = commandData.Application.ActiveUIDocument;
            var doc   = uiDoc.Document;

            try
            {
                // Collect all floor plan views that have rooms
                var floorPlans = new FilteredElementCollector(doc)
                    .OfClass(typeof(ViewPlan))
                    .Cast<ViewPlan>()
                    .Where(v => v.ViewType == ViewType.FloorPlan && !v.IsTemplate)
                    .ToList();

                if (floorPlans.Count == 0)
                {
                    TaskDialog.Show("BIMFlow", "Aucun plan d'étage trouvé dans le projet.");
                    return Result.Cancelled;
                }

                // Let user pick output folder
                var folderBrowser = new System.Windows.Forms.FolderBrowserDialog
                {
                    Description = "Choisir le dossier de sortie pour tous les niveaux",
                    ShowNewFolderButton = true,
                };
                if (folderBrowser.ShowDialog() != System.Windows.Forms.DialogResult.OK)
                    return Result.Cancelled;

                string rootDir   = folderBrowser.SelectedPath;
                int    exported  = 0;
                var    errors    = new System.Collections.Generic.List<string>();

                using var progress = new ProgressDialog($"Export de {floorPlans.Count} niveaux…");
                progress.Show();

                foreach (var view in floorPlans)
                {
                    try
                    {
                        string levelDir = Path.Combine(rootDir, SanitizeName(view.Name));
                        var exporter = new SvgPlanExporter(doc, view, levelDir);
                        exporter.Run();
                        exported++;
                    }
                    catch (Exception ex)
                    {
                        errors.Add($"{view.Name}: {ex.Message}");
                    }
                }

                progress.Close();

                string summary = $"Export terminé.\n\n{exported}/{floorPlans.Count} niveaux exportés.";
                if (errors.Count > 0)
                    summary += $"\n\nErreurs ({errors.Count}) :\n" + string.Join("\n", errors);

                TaskDialog.Show("BIMFlow — Export tous niveaux", summary);
                System.Diagnostics.Process.Start("explorer.exe", rootDir);

                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                return Result.Failed;
            }
        }

        private static string SanitizeName(string name) =>
            System.Text.RegularExpressions.Regex.Replace(name, @"[^\w\-]", "_");
    }
}
