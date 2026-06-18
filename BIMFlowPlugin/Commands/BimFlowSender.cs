using Autodesk.Revit.DB;
using BIMFlowPlugin.Exporters;
using BIMFlowPlugin.Models;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

namespace BIMFlowPlugin.Commands
{
    internal static class BimFlowSender
    {
        public const string UploadUrl = "https://bimatika-bimplan.pages.dev/api/upload";
        public const string ResetUrl  = "https://bimatika-bimplan.pages.dev/api/plans";
        public const string ParamsUrl = "https://bimatika-bimplan.pages.dev/api/params";

        // ── Reusable HttpClient (not disposed between calls) ──
        private static readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };

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

            // 1. Wipe server state so the site reflects only this batch.
            try { _http.DeleteAsync(ResetUrl).GetAwaiter().GetResult(); } catch { }

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
                    var resp = _http.PostAsync(UploadUrl, content).GetAwaiter().GetResult();
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
                    var resp = _http.PostAsync(ParamsUrl, content).GetAwaiter().GetResult();
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
