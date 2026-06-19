using Autodesk.Revit.DB;
using BIMFlowPlugin.Auth;
using BIMFlowPlugin.Exporters;
using BIMFlowPlugin.Models;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace BIMFlowPlugin.Commands
{
    internal static class BimFlowSender
    {
        public const string UploadUrl   = "https://bimatika-bimplan.pages.dev/api/upload";
        public const string ResetUrl    = "https://bimatika-bimplan.pages.dev/api/plans";
        public const string ParamsUrl   = "https://bimatika-bimplan.pages.dev/api/params";
        public const string ProjectsUrl = "https://bimatika-bimplan.pages.dev/api/projets";

        // ── Reusable HttpClient (not disposed between calls) ──
        private static readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };

        // ── Ensure user is logged in — shows login dialog if needed ──
        // Returns false if user cancels login.
        public static bool EnsureAuthenticated()
        {
            if (BFSession.IsAuthenticated) return true;
            using var dlg = new LoginDialog();
            return dlg.ShowDialog() == DialogResult.OK && BFSession.IsAuthenticated;
        }

        // ── Build an HTTP request with Authorization header ──
        private static HttpResponseMessage AuthSend(HttpMethod method, string url, HttpContent content = null)
        {
            var req = new HttpRequestMessage(method, url) { Content = content };
            if (BFSession.IsAuthenticated)
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", BFSession.Current.Session);
            return _http.SendAsync(req).GetAwaiter().GetResult();
        }

        // ═══════════════════════════════════════════════════════════
        // FULL EXPORT — exports PNG + geometry + params, parallel uploads
        // Called by "Envoyer vers BIMFlow" and "Envoi rapide" (force mode)
        // ═══════════════════════════════════════════════════════════
        public static (int sent, int failed, List<string> errors) Send(Document doc, IList<ViewPlan> views)
        {
            int sent = 0, failed = 0;
            var errors  = new List<string>();
            var lockObj = new object();

            string tempRoot = Path.Combine(Path.GetTempPath(),
                "BIMFlow_" + Guid.NewGuid().ToString("N").Substring(0, 8));

            // 1. Wipe only THIS project's plans so the site reflects only this batch.
            string projectName = "";
            try { projectName = doc.ProjectInformation?.Name ?? ""; } catch { }
            string projectCode = ComputeProjectCode(doc);
            // Include both code (new key scheme) and project name (legacy fallback).
            string deleteUrl = ResetUrl
                + "?code=" + Uri.EscapeDataString(projectCode)
                + "&project=" + Uri.EscapeDataString(projectName);
            try { AuthSend(HttpMethod.Delete, deleteUrl); } catch { }

            // 2. Export ALL views sequentially — Revit API is single-threaded.
            var exports = new List<(ViewPlan view, PlanExport export, Exception err)>();
            try
            {
                foreach (var view in views)
                {
                    try
                    {
                        string tempDir = Path.Combine(tempRoot, view.Id.Value.ToString());
                        var export = new SvgPlanExporter(doc, view, tempDir).Run();
                        export.ProjectCode = projectCode;
                        exports.Add((view, export, null));
                    }
                    catch (Exception ex)
                    {
                        exports.Add((view, null, ex));
                    }
                }
            }
            catch { /* outer safety net */ }

            // 3. Upload ALL exports in parallel — HTTP is thread-safe.
            var tasks = exports.Select(x => Task.Run(() =>
            {
                if (x.err != null)
                {
                    lock (lockObj) { failed++; errors.Add($"• {x.view.Name}: {x.err.Message}"); }
                    return;
                }
                try
                {
                    string json = JsonConvert.SerializeObject(x.export, Formatting.None);
                    using var content = new StringContent(json, Encoding.UTF8, "application/json");
                    var resp = AuthSend(HttpMethod.Post, UploadUrl, content);
                    string body = resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    if (!resp.IsSuccessStatusCode)
                        throw new Exception($"HTTP {(int)resp.StatusCode}: {body}");

                    // Save param snapshot so SendParams can diff against this state.
                    SaveSnapshot(doc, x.view, x.export.Rooms);
                    lock (lockObj) { sent++; }
                }
                catch (Exception ex)
                {
                    lock (lockObj) { failed++; errors.Add($"• {x.view.Name}: {ex.Message}"); }
                }
            })).ToArray();

            Task.WaitAll(tasks);

            // 4. Cleanup temp files.
            try { Directory.Delete(tempRoot, recursive: true); } catch { }

            return (sent, failed, errors);
        }

        // ═══════════════════════════════════════════════════════════
        // PARAMS-ONLY UPDATE — no image, sends only CHANGED rooms.
        // Called by "Envoyer paramètres" and "Envoi rapide".
        // Returns (sent, failed, unchanged, errors).
        // ═══════════════════════════════════════════════════════════
        public static (int sent, int failed, int unchanged, List<string> errors) SendParams(
            Document doc, IList<ViewPlan> views)
        {
            int sent = 0, failed = 0, unchanged = 0;
            var errors = new List<string>();

            foreach (var view in views)
            {
                try
                {
                    // Collect current parameters (no PNG, no geometry projection — fast).
                    var export = new SvgPlanExporter(doc, view).RunParamsOnly();
                    export.ProjectCode = ComputeProjectCode(doc);
                    var allRooms = export.Rooms;

                    // Diff against last-sent snapshot.
                    var snapshot  = LoadSnapshot(doc, view);
                    var toSend    = DiffRooms(allRooms, snapshot);

                    if (toSend.Count == 0)
                    {
                        unchanged++;
                        continue; // nothing changed for this view
                    }

                    // Send only changed rooms (server merges, keeps geometry untouched).
                    export.Rooms = toSend;
                    string json = JsonConvert.SerializeObject(export, Formatting.None);
                    using var content = new StringContent(json, Encoding.UTF8, "application/json");
                    var resp = AuthSend(HttpMethod.Post, ParamsUrl, content);
                    string body = resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    if (!resp.IsSuccessStatusCode)
                        throw new Exception($"HTTP {(int)resp.StatusCode}: {body}");

                    // Update snapshot with the full current state.
                    SaveSnapshot(doc, view, allRooms);
                    sent++;
                }
                catch (Exception ex)
                {
                    failed++;
                    errors.Add($"• {view.Name}: {ex.Message}");
                }
            }

            return (sent, failed, unchanged, errors);
        }

        // ═══════════════════════════════════════════════════════════
        // PROJECT CODE — checks for user-defined override first,
        // then falls back to the auto-generated code from the
        // Revit document UniqueId. Use "Gérer le projet" button
        // in the ribbon to set a custom code and avoid collisions
        // when two Revit files were copied from the same source.
        // ═══════════════════════════════════════════════════════════
        public static string ComputeProjectCode(Document doc)
        {
            string auto = ComputeAutoCode(doc);
            string custom = LoadCustomCode(auto);
            return string.IsNullOrEmpty(custom) ? auto : custom;
        }

        // Raw auto-code derived from the Revit document UniqueId.
        // Called by ManageProjectCommand to display the read-only code.
        internal static string ComputeAutoCode(Document doc)
        {
            try
            {
                string uid = doc.ProjectInformation?.UniqueId ?? "";
                if (!string.IsNullOrWhiteSpace(uid))
                    return uid.Replace("-", "").Substring(0, 8).ToUpperInvariant();
            }
            catch { }
            try
            {
                string name = doc.ProjectInformation?.Name ?? "";
                if (!string.IsNullOrEmpty(name))
                    return Math.Abs(name.GetHashCode()).ToString("X8").Substring(0, 8).ToUpperInvariant();
            }
            catch { }
            return "DEFAULT0";
        }

        // ── Project code override persistence ──
        private static string CodeSettingsFile => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BIMFlow", "project_codes.json");

        private static string LoadCustomCode(string autoCode)
        {
            try
            {
                if (!File.Exists(CodeSettingsFile)) return null;
                var dict = JsonConvert.DeserializeObject<
                    System.Collections.Generic.Dictionary<string, ProjectCodeEntry>>(
                        File.ReadAllText(CodeSettingsFile));
                if (dict != null && dict.TryGetValue(autoCode, out var e) && !string.IsNullOrEmpty(e?.Code))
                    return e.Code;
            }
            catch { }
            return null;
        }

        internal static void SaveProjectCode(string autoCode, string customCode, string name)
        {
            try
            {
                System.Collections.Generic.Dictionary<string, ProjectCodeEntry> dict = null;
                if (File.Exists(CodeSettingsFile))
                    dict = JsonConvert.DeserializeObject<
                        System.Collections.Generic.Dictionary<string, ProjectCodeEntry>>(
                            File.ReadAllText(CodeSettingsFile));
                dict ??= new System.Collections.Generic.Dictionary<string, ProjectCodeEntry>();
                dict[autoCode] = new ProjectCodeEntry { Code = customCode, Name = name };
                Directory.CreateDirectory(Path.GetDirectoryName(CodeSettingsFile)!);
                File.WriteAllText(CodeSettingsFile, JsonConvert.SerializeObject(dict, Formatting.Indented));
            }
            catch { }
        }

        private class ProjectCodeEntry
        {
            [JsonProperty("code")] public string Code { get; set; }
            [JsonProperty("name")] public string Name { get; set; }
        }

        // ═══════════════════════════════════════════════════════════
        // PARAMETER CHANGE DETECTION
        // Cache: %AppData%\BIMFlow\cache\{proj}_{viewId}.json
        // Snapshot format: { roomId → { paramName → value } }
        // ═══════════════════════════════════════════════════════════
        private static string CacheDir => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BIMFlow", "cache");

        private static string SnapshotFile(Document doc, ViewPlan view)
        {
            // Build a short filesystem-safe project key.
            string proj = "p";
            try
            {
                proj = new string(
                    doc.ProjectInformation.Name
                       .Where(c => char.IsLetterOrDigit(c) || c == '_')
                       .Take(20)
                       .ToArray());
                if (string.IsNullOrEmpty(proj)) proj = "p";
            }
            catch { }

            Directory.CreateDirectory(CacheDir);
            return Path.Combine(CacheDir, $"{proj}_{view.Id.Value:X}.json");
        }

        private static Dictionary<string, Dictionary<string, string>> LoadSnapshot(
            Document doc, ViewPlan view)
        {
            try
            {
                string f = SnapshotFile(doc, view);
                if (!File.Exists(f)) return null;
                return JsonConvert.DeserializeObject<
                    Dictionary<string, Dictionary<string, string>>>(File.ReadAllText(f));
            }
            catch { return null; }
        }

        private static void SaveSnapshot(Document doc, ViewPlan view, IList<RoomData> rooms)
        {
            try
            {
                var snap = rooms.ToDictionary(
                    r => r.RevitId,
                    r => new Dictionary<string, string>(r.Parameters));
                File.WriteAllText(SnapshotFile(doc, view), JsonConvert.SerializeObject(snap));
            }
            catch { }
        }

        // Returns rooms that have at least one changed / new / removed parameter.
        // If snapshot is null (first run), returns everything.
        private static List<RoomData> DiffRooms(
            IList<RoomData> current,
            Dictionary<string, Dictionary<string, string>> snapshot)
        {
            if (snapshot == null) return current.ToList(); // first send — push everything

            var changed = new List<RoomData>();
            foreach (var room in current)
            {
                if (!snapshot.TryGetValue(room.RevitId, out var prev))
                {
                    changed.Add(room); // new room not in last snapshot
                    continue;
                }

                // Any param added, removed, or changed?
                bool dirty =
                    room.Parameters.Any(kv =>
                        !prev.TryGetValue(kv.Key, out string pv) || pv != kv.Value) ||
                    prev.Any(kv => !room.Parameters.ContainsKey(kv.Key));

                if (dirty) changed.Add(room);
            }
            return changed;
        }

        // ═══════════════════════════════════════════════════════════
        // FAVOURITES
        // ═══════════════════════════════════════════════════════════
        private static string FavPath => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BIMFlow", "fav_plans.txt");

        public static List<string> LoadFavoriteIds()
        {
            try
            {
                if (File.Exists(FavPath))
                    return File.ReadAllLines(FavPath)
                               .Where(l => !string.IsNullOrWhiteSpace(l))
                               .ToList();
            }
            catch { }
            return new List<string>();
        }
    }
}
