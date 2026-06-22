using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;
using BIMFlowPlugin.Models;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;

namespace BIMFlowPlugin.Commands
{
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class ReceiveFromBIMFlowCommand : IExternalCommand
    {
        private const string UpdatesUrl = "https://bimatika-bimplan.pages.dev/api/updates";
        private static readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var doc = commandData.Application.ActiveUIDocument.Document;

            try
            {
                // Pull pending updates from web app
                PlanUpdate update;
                string code = Uri.EscapeDataString(BimFlowSender.ComputeProjectCode(doc) ?? "");
                string url  = string.IsNullOrEmpty(code) ? UpdatesUrl : $"{UpdatesUrl}?code={code}";

                var resp = _http.GetAsync(url).GetAwaiter().GetResult();
                var body = resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                if (!resp.IsSuccessStatusCode)
                    throw new Exception($"HTTP {(int)resp.StatusCode}\n{body}");

                update = JsonConvert.DeserializeObject<PlanUpdate>(body);

                bool hasUpdates   = update?.Updates       != null && update.Updates.Count       > 0;
                bool hasNewParams = update?.NewParameters != null && update.NewParameters.Count > 0;

                if (!hasUpdates && !hasNewParams)
                {
                    TaskDialog.Show("BIMFlow — Recevoir",
                        "Aucune modification en attente depuis le site web.\n\n" +
                        $"Code projet utilisé : {Uri.UnescapeDataString(code)}\n" +
                        $"URL interrogée : {url}\n\n" +
                        "Si vous venez d'envoyer des modifications depuis le site, vérifiez que le " +
                        "code projet affiché ci-dessus correspond à celui de votre projet sur le web " +
                        "(bouton « Gérer le projet » dans Revit).");
                    return Result.Cancelled;
                }

                // Collect all rooms in the project indexed by ElementId
                var allRooms = new FilteredElementCollector(doc)
                    .OfCategory(BuiltInCategory.OST_Rooms)
                    .WhereElementIsNotElementType()
                    .Cast<Room>()
                    .ToDictionary(r => r.Id.Value.ToString());

                int applied = 0, skipped = 0, created = 0;
                var log = new System.Text.StringBuilder();

                using var tx = new Transaction(doc, "BIMFlow — Mise à jour depuis web");
                tx.Start();

                // ── Create new parameters requested from web ──
                if (update.NewParameters != null && update.NewParameters.Count > 0)
                {
                    foreach (var req in update.NewParameters)
                        if (CreateRoomParameter(doc, req, log)) created++;
                }

                // ── Apply parameter updates to rooms ──
                foreach (var roomUpdate in update.Updates)
                {
                    if (!allRooms.TryGetValue(roomUpdate.RevitId, out var room))
                    {
                        skipped++;
                        log.AppendLine($"ID {roomUpdate.RevitId} : pièce introuvable");
                        continue;
                    }

                    int paramCount = 0;
                    foreach (var kv in roomUpdate.Parameters)
                    {
                        try
                        {
                            var param = room.LookupParameter(kv.Key);
                            if (param == null || param.IsReadOnly) continue;

                            SetParamValue(param, kv.Value, doc);
                            paramCount++;
                        }
                        catch (Exception ex) { log.AppendLine($"  ✗ {kv.Key} : {ex.Message}"); }
                    }

                    if (paramCount > 0)
                    {
                        applied++;
                        log.AppendLine($"✓ {room.Name} : {paramCount} paramètre(s)");
                    }
                }

                tx.Commit();

                // Clear updates on server after applying
                try
                {
                    _http.DeleteAsync(url).GetAwaiter().GetResult();
                }
                catch { /* non-critical */ }

                string summary = $"Modifications reçues du site web :\n\n";
                if (created > 0)  summary += $"• Paramètres créés   : {created}\n";
                summary += $"• Pièces mises à jour : {applied}\n";
                if (skipped > 0)  summary += $"• Pièces introuvables : {skipped}\n";
                summary += "\n" + log.ToString();
                TaskDialog.Show("BIMFlow — Mise à jour réussie ✓", summary);

                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show("BIMFlow — Erreur", $"Erreur lors de la réception :\n\n{ex.Message}");
                return Result.Failed;
            }
        }

        // ── Create a new room parameter (shared or project) ──
        private bool CreateRoomParameter(Document doc, NewParameterRequest req, System.Text.StringBuilder log)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(req.Name)) return false;

                var sampleRoom = new FilteredElementCollector(doc)
                    .OfCategory(BuiltInCategory.OST_Rooms)
                    .WhereElementIsNotElementType()
                    .Cast<Room>().FirstOrDefault();
                if (sampleRoom?.LookupParameter(req.Name) != null)
                {
                    log.AppendLine($"⚠ Paramètre '{req.Name}' existe déjà.");
                    return false;
                }

                ForgeTypeId specId  = ResolveSpec(req.Type);
                ForgeTypeId groupId = ResolveGroup(req.Group);

                // The Revit API can only add a parameter binding from a shared-parameter
                // file definition. "shared" → persistent BIMFlow file (keeps its GUID and
                // can be scheduled/reused). "project" → a transient file so the definition
                // stays effectively local to this project.
                bool isProject = string.Equals(req.Kind, "project", StringComparison.OrdinalIgnoreCase);
                string spFile = isProject
                    ? Path.Combine(Path.GetTempPath(),
                        "BIMFlow_proj_" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".txt")
                    : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                        "BIMFlow", "BIMFlowSharedParams.txt");

                Directory.CreateDirectory(Path.GetDirectoryName(spFile));
                if (!File.Exists(spFile)) File.WriteAllText(spFile, "# BIMFlow Shared Parameters\n");

                string prevSpFile = doc.Application.SharedParametersFilename;
                doc.Application.SharedParametersFilename = spFile;

                var spf = doc.Application.OpenSharedParameterFile();
                string groupName = isProject ? "BIMFlow_Project" : "BIMFlow";
                var grp = spf.Groups.get_Item(groupName) ?? spf.Groups.Create(groupName);
                var extDef = grp.Definitions.get_Item(req.Name) as ExternalDefinition
                             ?? grp.Definitions.Create(
                                 new ExternalDefinitionCreationOptions(req.Name, specId)) as ExternalDefinition;

                var catSet = new CategorySet();
                catSet.Insert(Category.GetCategory(doc, BuiltInCategory.OST_Rooms));
                // Les pièces sont des éléments d'instance : un TypeBinding sur OST_Rooms est invalide.
                Binding binding = new InstanceBinding(catSet);

                if (!doc.ParameterBindings.Insert(extDef, binding, groupId))
                    doc.ParameterBindings.ReInsert(extDef, binding, groupId);

                // Restore the persistent shared-param pointer after a transient project file
                if (isProject && !string.IsNullOrEmpty(prevSpFile))
                    try { doc.Application.SharedParametersFilename = prevSpFile; } catch { }

                // Apply a default value to every room if one was provided
                if (!string.IsNullOrWhiteSpace(req.DefaultValue))
                {
                    foreach (Room room in new FilteredElementCollector(doc)
                        .OfCategory(BuiltInCategory.OST_Rooms)
                        .WhereElementIsNotElementType().Cast<Room>())
                    {
                        var p = room.LookupParameter(req.Name);
                        if (p != null && !p.IsReadOnly) SetParamValue(p, req.DefaultValue, doc);
                    }
                }

                log.AppendLine($"✓ Paramètre {(isProject ? "de projet" : "partagé")} créé : "
                               + $"'{req.Name}' ({req.Type}, groupe {req.Group})");
                return true;
            }
            catch (Exception ex)
            {
                log.AppendLine($"✗ Création '{req.Name}' : {ex.Message}");
                return false;
            }
        }

        // ── Set a parameter from a string, respecting its storage type ──
        private static void SetParamValue(Autodesk.Revit.DB.Parameter param, string val, Document doc)
        {
            switch (param.StorageType)
            {
                case StorageType.String:
                    param.Set(val ?? "");
                    break;
                case StorageType.Double:
                    if (double.TryParse(val, System.Globalization.NumberStyles.Any,
                        System.Globalization.CultureInfo.InvariantCulture, out double d))
                        param.Set(d);
                    break;
                case StorageType.Integer:
                    if (int.TryParse(val, out int i)) param.Set(i);
                    else if (val == "Yes" || val == "Oui" || val == "True"  || val == "1") param.Set(1);
                    else if (val == "No"  || val == "Non" || val == "False" || val == "0") param.Set(0);
                    break;
                case StorageType.ElementId:
                    var targetId = param.AsElementId();
                    if (targetId != ElementId.InvalidElementId)
                    {
                        var targetElem = doc.GetElement(targetId);
                        if (targetElem != null)
                        {
                            var match = new FilteredElementCollector(doc)
                                .OfClass(targetElem.GetType())
                                .FirstOrDefault(e => e.Name == val);
                            if (match != null) param.Set(match.Id);
                        }
                    }
                    break;
            }
        }

        // ── Map a web spec-type token → Revit ForgeTypeId (data type) ──
        private static ForgeTypeId ResolveSpec(string t)
        {
            switch ((t ?? "").ToLowerInvariant())
            {
                case "integer":   return SpecTypeId.Int.Integer;
                case "number":    return SpecTypeId.Number;
                case "length":    return SpecTypeId.Length;
                case "area":      return SpecTypeId.Area;
                case "volume":    return SpecTypeId.Volume;
                case "angle":     return SpecTypeId.Angle;
                case "slope":     return SpecTypeId.Slope;
                case "currency":  return SpecTypeId.Currency;
                case "mass":      return SpecTypeId.Mass;
                case "yesno":
                case "boolean":   return SpecTypeId.Boolean.YesNo;
                case "url":       return SpecTypeId.String.Url;
                case "multitext": return SpecTypeId.String.MultilineText;
                case "material":  return SpecTypeId.Reference.Material;
                case "text":
                default:          return SpecTypeId.String.Text;
            }
        }

        // ── Map a web group token → Revit ForgeTypeId (parameter group) ──
        private static ForgeTypeId ResolveGroup(string g)
        {
            switch ((g ?? "").ToLowerInvariant())
            {
                case "identity":    return GroupTypeId.IdentityData;
                case "dimensions":  return GroupTypeId.Geometry;
                case "constraints": return GroupTypeId.Constraints;
                case "text":        return GroupTypeId.Text;
                case "graphics":    return GroupTypeId.Graphics;
                case "materials":   return GroupTypeId.Materials;
                case "phasing":     return GroupTypeId.Phasing;
                case "general":     return GroupTypeId.General;
                case "data":
                default:            return GroupTypeId.Data;
            }
        }
    }
}
