using Autodesk.Revit.DB;
using BIMFlowPlugin.Exporters;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;

namespace BIMFlowPlugin.Commands
{
    /// <summary>
    /// Shared upload logic for both "Envoyer vers BIMFlow" and "Envoi rapide".
    /// Clears the server first, then exports + uploads each view.
    /// </summary>
    internal static class BimFlowSender
    {
        public const string UploadUrl = "https://bimatika-bimplan.pages.dev/api/upload";
        public const string ResetUrl  = "https://bimatika-bimplan.pages.dev/api/plans";
        public const string ParamsUrl = "https://bimatika-bimplan.pages.dev/api/params";

        // Fast update: send ONLY room parameters (no PNG/geometry). Merges into the plan
        // already on the server — does NOT clear anything.
        public static (int sent, int failed, List<string> errors) SendParams(Document doc, IList<ViewPlan> views)
        {
            int sent = 0, failed = 0;
            var errors = new List<string>();
            using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(3) };
            string tmp = Path.Combine(Path.GetTempPath(), "BIMFlow_p");
            foreach (var view in views)
            {
                try
                {
                    var export = new SvgPlanExporter(doc, view, tmp).RunParamsOnly();
                    string json = JsonConvert.SerializeObject(export, Formatting.None);
                    using var content = new StringContent(json, Encoding.UTF8, "application/json");
                    var response = client.PostAsync(ParamsUrl, content).GetAwaiter().GetResult();
                    string body  = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    if (!response.IsSuccessStatusCode)
                        throw new Exception($"HTTP {(int)response.StatusCode}: {body}");
                    sent++;
                }
                catch (Exception ex) { failed++; errors.Add($"• {view.Name}: {ex.Message}"); }
            }
            return (sent, failed, errors);
        }

        public static (int sent, int failed, List<string> errors) Send(Document doc, IList<ViewPlan> views)
        {
            int sent = 0, failed = 0;
            var errors = new List<string>();

            string tempRoot = Path.Combine(Path.GetTempPath(),
                "BIMFlow_" + Guid.NewGuid().ToString("N").Substring(0, 8));

            using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };

            // Wipe previous uploads so the site reflects ONLY this batch.
            try { client.DeleteAsync(ResetUrl).GetAwaiter().GetResult(); } catch { }

            try
            {
                foreach (var view in views)
                {
                    try
                    {
                        string tempDir = Path.Combine(tempRoot, view.Id.Value.ToString());
                        var export = new SvgPlanExporter(doc, view, tempDir).Run();

                        string json = JsonConvert.SerializeObject(export, Formatting.None);
                        using var content = new StringContent(json, Encoding.UTF8, "application/json");
                        var response = client.PostAsync(UploadUrl, content).GetAwaiter().GetResult();
                        string body  = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();

                        if (!response.IsSuccessStatusCode)
                            throw new Exception($"HTTP {(int)response.StatusCode}: {body}");

                        sent++;
                    }
                    catch (Exception ex)
                    {
                        failed++;
                        errors.Add($"• {view.Name}: {ex.Message}");
                    }
                }
            }
            finally
            {
                try { Directory.Delete(tempRoot, recursive: true); } catch { }
            }

            return (sent, failed, errors);
        }

        // Favourite plan UniqueIds saved by PlanSelectionDialog (⭐ Favori).
        private static string FavPath => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BIMFlow", "fav_plans.txt");

        public static List<string> LoadFavoriteIds()
        {
            try
            {
                if (File.Exists(FavPath))
                    return File.ReadAllLines(FavPath).Where(l => !string.IsNullOrWhiteSpace(l)).ToList();
            }
            catch { }
            return new List<string>();
        }
    }
}
