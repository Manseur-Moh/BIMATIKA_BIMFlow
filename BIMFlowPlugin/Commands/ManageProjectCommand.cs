using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using BIMFlowPlugin.UI;
using Newtonsoft.Json;
using System;
using System.Net.Http;
using System.Text;

namespace BIMFlowPlugin.Commands
{
    [Transaction(TransactionMode.ReadOnly)]
    public class ManageProjectCommand : IExternalCommand
    {
        private static readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var doc = commandData.Application.ActiveUIDocument?.Document;
            if (doc == null)
            {
                TaskDialog.Show("BIMFlow", "Aucun document Revit ouvert.");
                return Result.Cancelled;
            }

            string autoCode    = BimFlowSender.ComputeAutoCode(doc);
            string currentCode = BimFlowSender.ComputeProjectCode(doc); // with override if set
            string currentName = "";
            try { currentName = doc.ProjectInformation?.Name ?? ""; } catch { }

            using var dlg = new ProjectManagerDialog(autoCode, currentCode, currentName);
            if (dlg.ShowDialog() != System.Windows.Forms.DialogResult.OK)
                return Result.Cancelled;

            string newCode = dlg.ProjectCode;
            string newName = dlg.ProjectName;

            if (string.IsNullOrEmpty(newCode))
            {
                TaskDialog.Show("BIMFlow", "Le code projet ne peut pas être vide.");
                return Result.Cancelled;
            }

            BimFlowSender.SaveProjectCode(autoCode, newCode, newName);

            if (dlg.RegisterOnWeb && !string.IsNullOrEmpty(newName))
            {
                try
                {
                    string url  = BimFlowSender.ProjectsUrl + "?code=" + Uri.EscapeDataString(newCode);
                    string body = JsonConvert.SerializeObject(new { displayName = newName });
                    using var content = new StringContent(body, Encoding.UTF8, "application/json");
                    var resp = _http.PostAsync(url, content).GetAwaiter().GetResult();
                    if (resp.IsSuccessStatusCode)
                        TaskDialog.Show("BIMFlow — Projet",
                            $"✅ Projet enregistré sur BIMFlow !\n\nCode : {newCode}\nNom  : {newName}\n\n" +
                            "Partagez ce code avec votre équipe pour accéder au projet depuis le web.\n" +
                            "Envoyez vos plans depuis Revit pour les voir apparaître.");
                    else
                        TaskDialog.Show("BIMFlow — Projet",
                            $"Code enregistré localement : {newCode}\n" +
                            $"Erreur enregistrement web : HTTP {(int)resp.StatusCode}");
                }
                catch (Exception ex)
                {
                    TaskDialog.Show("BIMFlow — Projet",
                        $"Code enregistré localement : {newCode}\nErreur réseau : {ex.Message}");
                }
            }
            else
            {
                TaskDialog.Show("BIMFlow — Projet",
                    $"Code projet mis à jour.\n\nCode actif : {newCode}\n\n" +
                    "Ce code sera utilisé lors du prochain envoi de plans vers BIMFlow.");
            }

            return Result.Succeeded;
        }
    }
}
