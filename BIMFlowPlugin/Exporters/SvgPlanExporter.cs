using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using BIMFlowPlugin.Models;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

namespace BIMFlowPlugin.Exporters
{
    public class SvgPlanExporter
    {
        private readonly Document _doc;
        private readonly ViewPlan _view;
        private readonly string   _outputDir;

        // outputDir may be null when only RunParamsOnly() will be called (no files written).
        public SvgPlanExporter(Document doc, ViewPlan view, string outputDir = null)
        {
            _doc       = doc;
            _view      = view;
            _outputDir = outputDir;
            if (!string.IsNullOrEmpty(outputDir))
                Directory.CreateDirectory(outputDir);
        }

        public PlanExport Run()
        {
            // 1. Gather every room's boundary in WORLD coordinates + its data.
            var geoms = GatherRooms();

            // 2. Force the view's crop box to the rooms' extents and activate it, so the
            //    exported image covers EXACTLY a region we control — this is what makes the
            //    PNG and the room polygons line up deterministically. We restore the crop
            //    afterwards so the user's view is untouched.
            CropState saved = null;
            ProjectionBox box;
            try
            {
                box = ApplyExportCrop(geoms, out saved);
            }
            catch
            {
                // View doesn't allow crop manipulation — fall back to its current crop box.
                box = ProjectionBox.FromView(_view);
            }

            string pngPath;
            int imgW, imgH;
            try
            {
                pngPath = ExportPng();
                (imgW, imgH) = ReadImageSize(pngPath);
            }
            finally
            {
                if (saved != null) RestoreCrop(saved);
            }

            // 3. Project each room's world points into the known crop region → pixels.
            var rooms = ProjectRooms(geoms, box, imgW, imgH);

            var export = BuildExport(rooms, pngPath, imgW, imgH);

            string jsonPath = Path.Combine(_outputDir, SafeName() + ".bimflow.json");
            File.WriteAllText(jsonPath, JsonConvert.SerializeObject(export, Formatting.Indented));

            string svgPath = Path.Combine(_outputDir, SafeName() + ".svg");
            File.WriteAllText(svgPath, BuildSvg(export), Encoding.UTF8);

            return export;
        }

        // Fast path: collect ONLY room parameters (no PNG, no crop, no geometry projection),
        // for the "Envoyer paramètres" button. The server merges these into the existing plan.
        public PlanExport RunParamsOnly()
        {
            var collector = new FilteredElementCollector(_doc, _view.Id)
                .OfCategory(BuiltInCategory.OST_Rooms)
                .WhereElementIsNotElementType();
            ElementId levelId = _view.GenLevel?.Id ?? ElementId.InvalidElementId;

            var rooms = new List<RoomData>();
            foreach (Room room in collector.Cast<Room>())
            {
                if (room.Area < 0.01) continue;
                if (levelId != ElementId.InvalidElementId && room.LevelId != levelId) continue;
                rooms.Add(ExtractRoomData(room));
            }

            var info = _doc.ProjectInformation;
            return new PlanExport
            {
                ProjectName   = info.Name,
                ProjectNumber = info.Number,
                LevelName     = _view.GenLevel?.Name ?? _view.Name,
                LevelElevation= (_view.GenLevel?.Elevation ?? 0) * 0.3048,
                ExportDate    = DateTime.Now.ToString("yyyy-MM-dd HH:mm"),
                RevitVersion  = _doc.Application.VersionNumber,
                ImageWidth    = 0,
                ImageHeight   = 0,
                ImageBase64   = "",
                Rooms         = rooms,
            };
        }

        // ── STEP 1: Export PNG ──
        private string ExportPng()
        {
            string pngName = SafeName() + "_background";
            string pngPath = Path.Combine(_outputDir, pngName + ".png");

            var options = new ImageExportOptions
            {
                ExportRange          = ExportRange.SetOfViews,
                FilePath             = Path.Combine(_outputDir, pngName),
                HLRandWFViewsFileType = ImageFileType.PNG,
                ImageResolution      = ImageResolution.DPI_150,
                ZoomType             = ZoomFitType.FitToPage,
                PixelSize            = 1400,   // 2048→1400: ~55% smaller file, still sharp
                ShadowViewsFileType  = ImageFileType.PNG,
            };
            options.SetViewsAndSheets(new List<ElementId> { _view.Id });
            _doc.ExportImage(options);

            var files = Directory.GetFiles(_outputDir, pngName + "*.png");
            if (files.Length > 0 && files[0] != pngPath)
            {
                if (File.Exists(pngPath)) File.Delete(pngPath);
                File.Move(files[0], pngPath);
            }

            // Make the white background transparent so the plan blends on any viewer theme.
            try { MakeTransparent(pngPath); } catch { }

            return pngPath;
        }

        // Convert the white-background plan into transparent line-art: alpha = 255 − luminance
        // (white → fully transparent, dark lines → opaque), keeping the original line colours.
        private static void MakeTransparent(string pngPath)
        {
            Bitmap bmp;
            using (var src = (Bitmap)Image.FromFile(pngPath))
                bmp = new Bitmap(src);   // detaches from the file so we can overwrite it

            var rect = new System.Drawing.Rectangle(0, 0, bmp.Width, bmp.Height);
            using (var argb = bmp.Clone(rect, PixelFormat.Format32bppArgb))
            {
                bmp.Dispose();
                var data = argb.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
                int len = Math.Abs(data.Stride) * argb.Height;
                var buf = new byte[len];
                Marshal.Copy(data.Scan0, buf, 0, len);
                for (int i = 0; i < len; i += 4)   // BGRA
                {
                    int b = buf[i], g = buf[i + 1], r = buf[i + 2];
                    int lum = (r * 299 + g * 587 + b * 114) / 1000;
                    buf[i + 3] = (byte)(255 - lum);   // alpha
                }
                Marshal.Copy(buf, 0, data.Scan0, len);
                argb.UnlockBits(data);
                argb.Save(pngPath, ImageFormat.Png);
            }
        }

        // Room geometry captured in WORLD coordinates (before any crop changes).
        private class RoomGeom
        {
            public RoomData Data;
            public List<XYZ> Points = new List<XYZ>();   // outer boundary, world coords
        }

        // The known crop region the exported image covers. Min/Max are in crop-local
        // coordinates; Inverse maps world → crop-local.
        private class ProjectionBox
        {
            public Transform Inverse;
            public double MinX, MinY, MaxY, SpanX, SpanY;

            public static ProjectionBox From(Transform cropTransform, XYZ min, XYZ max)
            {
                return new ProjectionBox
                {
                    Inverse = cropTransform.Inverse,
                    MinX = min.X, MinY = min.Y, MaxY = max.Y,
                    SpanX = max.X - min.X, SpanY = max.Y - min.Y,
                };
            }

            public static ProjectionBox FromView(View v)
            {
                var cb = v.CropBox;
                return From(cb.Transform, cb.Min, cb.Max);
            }
        }

        private class CropState
        {
            public BoundingBoxXYZ Box;
            public bool Active;
            public bool Visible;
            public bool AnnoActive;
            public ElementId TemplateId = ElementId.InvalidElementId;
            public List<ElementId> HiddenCats = new List<ElementId>();
        }

        // ── STEP 2a: Gather rooms + boundary points in world coordinates ──
        private List<RoomGeom> GatherRooms()
        {
            var collector = new FilteredElementCollector(_doc, _view.Id)
                .OfCategory(BuiltInCategory.OST_Rooms)
                .WhereElementIsNotElementType();

            var geoms = new List<RoomGeom>();
            var opts = new SpatialElementBoundaryOptions
            {
                SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish
            };

            // Only keep rooms that belong to THIS view's level, so the exported outlines
            // match exactly the rooms visible on this floor plan (no rooms bleeding in
            // from the level below via the view range).
            ElementId levelId = _view.GenLevel?.Id ?? ElementId.InvalidElementId;

            foreach (Room room in collector.Cast<Room>())
            {
                if (room.Area < 0.01) continue;
                if (levelId != ElementId.InvalidElementId && room.LevelId != levelId) continue;

                var segments = room.GetBoundarySegments(opts);
                if (segments == null || segments.Count == 0) continue;

                var g = new RoomGeom { Data = ExtractRoomData(room) };

                // Outer boundary only (loop 0), tessellating arcs/splines.
                foreach (var seg in segments[0])
                {
                    var curve = seg.GetCurve();
                    if (curve is Line)
                        g.Points.Add(curve.GetEndPoint(0));
                    else
                    {
                        var tess = curve.Tessellate();
                        for (int i = 0; i < tess.Count - 1; i++) g.Points.Add(tess[i]);
                    }
                }

                if (g.Points.Count >= 3)
                {
                    // Footprint in metres (model X,Y) → extruded to 3D on the web.
                    g.Data.Footprint = g.Points
                        .Select(p => new double[] { System.Math.Round(p.X * 0.3048, 3), System.Math.Round(p.Y * 0.3048, 3) })
                        .ToList();
                    geoms.Add(g);
                }
            }

            return geoms;
        }

        // ── STEP 2b: Constrain the view crop to the rooms' extents ──
        private ProjectionBox ApplyExportCrop(List<RoomGeom> geoms, out CropState saved)
        {
            saved = null;
            var srcBox = _view.CropBox;
            Transform t = srcBox.Transform;
            Transform inv = t.Inverse;

            // Bounding box of all room points in crop-local coords.
            double minX = double.MaxValue, minY = double.MaxValue;
            double maxX = double.MinValue, maxY = double.MinValue;
            foreach (var g in geoms)
                foreach (var p in g.Points)
                {
                    var l = inv.OfPoint(p);
                    if (l.X < minX) minX = l.X; if (l.X > maxX) maxX = l.X;
                    if (l.Y < minY) minY = l.Y; if (l.Y > maxY) maxY = l.Y;
                }

            if (minX > maxX || minY > maxY)
                return ProjectionBox.FromView(_view);   // no rooms — keep current crop

            // Add a 10% margin so room edges / surrounding walls stay visible.
            double mx = Math.Max((maxX - minX) * 0.10, 1.5);
            double my = Math.Max((maxY - minY) * 0.10, 1.5);
            minX -= mx; maxX += mx; minY -= my; maxY += my;

            // A valid BoundingBoxXYZ needs Min.Z < Max.Z; an inactive crop can report a
            // degenerate Z range, which makes set-CropBox throw and silently fall back.
            double zMin = Math.Min(srcBox.Min.Z, srcBox.Max.Z);
            double zMax = Math.Max(srcBox.Min.Z, srcBox.Max.Z);
            if (zMax - zMin < 1e-6) { zMin -= 1000; zMax += 1000; }

            var newMin = new XYZ(minX, minY, zMin);
            var newMax = new XYZ(maxX, maxY, zMax);

            saved = new CropState
            {
                Box = srcBox,
                Active = _view.CropBoxActive,
                Visible = _view.CropBoxVisible,
                AnnoActive = GetAnnoCropActive(),
                TemplateId = _view.ViewTemplateId
            };

            var newBox = new BoundingBoxXYZ { Transform = t };
            newBox.Min = newMin;
            newBox.Max = newMax;

            using (var tx = new Transaction(_doc, "BIMFlow — crop export"))
            {
                tx.Start();

                // A view template very often LOCKS the crop region/visibility — assigning
                // CropBox then throws and we silently fall back to the full (misaligned)
                // view. Temporarily detach the template so the crop is editable; we restore
                // it afterwards. This is the usual reason the PNG showed the whole plan
                // (grids, trees) instead of just the rooms.
                if (_view.ViewTemplateId != ElementId.InvalidElementId)
                {
                    try { _view.ViewTemplateId = ElementId.InvalidElementId; } catch { }
                }

                _view.CropBoxActive = true;
                _view.CropBox = newBox;
                try { _view.CropBoxVisible = false; } catch { }

                // Clip annotations to the crop AND hide annotation categories so NOTHING
                // (grid bubbles, tags, section heads) extends past the rooms. With only
                // model geometry clipped to the crop, the exported PNG covers exactly the
                // crop region → room polygons line up pixel-for-pixel.
                SetAnnoCrop(true, 0.0);
                saved.HiddenCats = HideAnnotationCategories();

                tx.Commit();   // commit regenerates the view
            }

            // Project against the crop Revit ACTUALLY applied (it may snap slightly),
            // not the box we requested — this removes any residual offset.
            var applied = _view.CropBox;
            return ProjectionBox.From(applied.Transform, applied.Min, applied.Max);
        }

        private void RestoreCrop(CropState saved)
        {
            try
            {
                using var tx = new Transaction(_doc, "BIMFlow — restore crop");
                tx.Start();

                // Un-hide the annotation categories we hid for the export.
                foreach (var id in saved.HiddenCats)
                {
                    try { _view.SetCategoryHidden(id, false); } catch { }
                }

                _view.CropBox = saved.Box;
                _view.CropBoxActive = saved.Active;
                try { _view.CropBoxVisible = saved.Visible; } catch { }
                try
                {
                    var p = _view.get_Parameter(BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE);
                    if (p != null && !p.IsReadOnly) p.Set(saved.AnnoActive ? 1 : 0);
                }
                catch { }

                // Re-attach the view template last (it re-locks the crop, so it must come
                // after we've restored the crop values).
                if (saved.TemplateId != ElementId.InvalidElementId)
                {
                    try { _view.ViewTemplateId = saved.TemplateId; } catch { }
                }

                tx.Commit();
            }
            catch { /* best effort */ }
        }

        // Hide every annotation category that's visible in this view so the exported image
        // contains only model geometry clipped to the crop. Returns the categories hidden
        // so they can be restored. (Trees, furniture, walls are MODEL categories and stay.)
        private List<ElementId> HideAnnotationCategories()
        {
            var hidden = new List<ElementId>();
            try
            {
                foreach (Category cat in _doc.Settings.Categories)
                {
                    try
                    {
                        if (cat == null || cat.CategoryType != CategoryType.Annotation) continue;
                        if (!cat.get_AllowsVisibilityControl(_view)) continue;
                        if (_view.GetCategoryHidden(cat.Id)) continue;   // already hidden
                        _view.SetCategoryHidden(cat.Id, true);
                        hidden.Add(cat.Id);
                    }
                    catch { }
                }
            }
            catch { }
            return hidden;
        }

        private bool GetAnnoCropActive()
        {
            try
            {
                var p = _view.get_Parameter(BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE);
                return p != null && p.AsInteger() == 1;
            }
            catch { return false; }
        }

        // Activate the annotation crop and pull its offsets in tight so it matches the
        // model crop (Revit clamps to a small minimum, which is sub-pixel at plan scale).
        private void SetAnnoCrop(bool active, double offset)
        {
            try
            {
                var p = _view.get_Parameter(BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE);
                if (p != null && !p.IsReadOnly) p.Set(active ? 1 : 0);
                if (!active) return;
                var mgr = _view.GetCropRegionShapeManager();
                try { mgr.LeftAnnotationCropOffset   = offset; } catch { }
                try { mgr.RightAnnotationCropOffset  = offset; } catch { }
                try { mgr.TopAnnotationCropOffset    = offset; } catch { }
                try { mgr.BottomAnnotationCropOffset = offset; } catch { }
            }
            catch { }
        }

        private static (int w, int h) ReadImageSize(string pngPath)
        {
            try { using var bmp = System.Drawing.Image.FromFile(pngPath); return (bmp.Width, bmp.Height); }
            catch { return (2048, 2048); }
        }

        // ── STEP 2c: Project gathered world points → SVG pixels in the known region ──
        private List<RoomData> ProjectRooms(List<RoomGeom> geoms, ProjectionBox box, int imgW, int imgH)
        {
            // The image covers the crop region uniformly-scaled and centered (FitToPage),
            // so map crop-local coords → pixels with a centered letter-box offset.
            double scale = Math.Min(imgW / box.SpanX, imgH / box.SpanY);
            double offX  = (imgW - box.SpanX * scale) / 2.0;
            double offY  = (imgH - box.SpanY * scale) / 2.0;

            double ToSvgX(XYZ p) { var l = box.Inverse.OfPoint(p); return offX + (l.X - box.MinX) * scale; }
            double ToSvgY(XYZ p) { var l = box.Inverse.OfPoint(p); return offY + (box.MaxY - l.Y) * scale; }

            var rooms = new List<RoomData>();
            foreach (var g in geoms)
            {
                var svgPoints = new List<string>();
                double sumX = 0, sumY = 0;
                foreach (var pt in g.Points)
                {
                    double sx = ToSvgX(pt), sy = ToSvgY(pt);
                    svgPoints.Add($"{sx:F2},{sy:F2}");
                    sumX += sx; sumY += sy;
                }

                g.Data.SvgPolygon = string.Join(" ", svgPoints);
                g.Data.CentroidX  = sumX / g.Points.Count;
                g.Data.CentroidY  = sumY / g.Points.Count;
                rooms.Add(g.Data);
            }
            return rooms;
        }

        // ── Export ALL room parameters (including hidden and read-only) ──
        private RoomData ExtractRoomData(Room room)
        {
            var data = new RoomData
            {
                RevitId   = room.Id.Value.ToString(),
                Number    = room.Number    ?? "",
                Name      = room.Name      ?? "",
                LevelName = room.Level?.Name ?? "",
                AreaM2    = room.Area * 0.09290304,   // ft² → m²
            };

            // Perimeter (ft → m) for wall-finish costing
            try
            {
                var perimP = room.get_Parameter(BuiltInParameter.ROOM_PERIMETER);
                if (perimP != null) data.PerimeterM = perimP.AsDouble() * 0.3048;
            }
            catch { }

            // Volume + 3D extrusion data (metres)
            try { data.Volume = room.Volume * 0.0283168466; } catch { }                       // ft³ → m³
            try { data.BaseZ  = (room.Level?.Elevation ?? 0) * 0.3048; } catch { }              // ft → m
            try { double h = room.UnboundedHeight * 0.3048; data.Height = h > 0.1 ? h : 2.8; }  // ft → m
            catch { data.Height = 2.8; }

            foreach (Autodesk.Revit.DB.Parameter param in room.Parameters)
            {
                try
                {
                    if (param?.Definition == null) continue;
                    string paramName = param.Definition.Name;
                    if (string.IsNullOrWhiteSpace(paramName)) continue;
                    if (data.Parameters.ContainsKey(paramName)) continue;

                    // Determine type
                    string pType = "text";
                    string value = "";
                    bool   isReadOnly = param.IsReadOnly;

                    switch (param.StorageType)
                    {
                        case StorageType.String:
                            pType = "text";
                            value = param.AsString() ?? "";
                            break;

                        case StorageType.Double:
                            pType = "number";
                            value = FormatDouble(param);
                            break;

                        case StorageType.Integer:
                            // Detect Yes/No boolean parameters
                            string vs = param.AsValueString() ?? "";
                            if (vs == "Yes" || vs == "No" || vs == "Oui" || vs == "Non")
                            {
                                pType = "boolean";
                                value = vs;
                                data.ParameterChoices[paramName] = new System.Collections.Generic.List<string> { "Yes", "No" };
                            }
                            else
                            {
                                pType = "integer";
                                value = string.IsNullOrWhiteSpace(vs) ? param.AsInteger().ToString() : vs;
                            }
                            break;

                        case StorageType.ElementId:
                            pType = "text";
                            value = param.AsValueString() ?? "";
                            isReadOnly = true; // ElementId params not settable as text
                            // Collect all possible choices (e.g. Phase, Level, etc.)
                            try
                            {
                                var targetId = param.AsElementId();
                                if (targetId != null && targetId != ElementId.InvalidElementId)
                                {
                                    var targetElem = _doc.GetElement(targetId);
                                    if (targetElem != null)
                                    {
                                        var choices = new FilteredElementCollector(_doc)
                                            .OfClass(targetElem.GetType())
                                            .Select(e => e.Name ?? "")
                                            .Where(n => !string.IsNullOrEmpty(n))
                                            .Distinct()
                                            .OrderBy(n => n)
                                            .ToList();
                                        if (choices.Count >= 2)
                                        {
                                            data.ParameterChoices[paramName] = choices;
                                            isReadOnly = false; // can pick from list
                                            pType = "choice";
                                        }
                                    }
                                }
                            }
                            catch { }
                            break;
                    }

                    // Export ALL parameters — even empty ones — so the web app can show
                    // and fill the full room schema (the user explicitly wants every param).
                    data.Parameters[paramName]          = value ?? "";
                    data.ParameterTypes[paramName]      = pType;
                    data.ParameterReadOnly[paramName]   = isReadOnly;
                }
                catch { }
            }

            return data;
        }

        private static string FormatDouble(Autodesk.Revit.DB.Parameter p)
        {
            // Prefer the formatted string (with units), fall back to raw value
            string vs = p.AsValueString();
            if (!string.IsNullOrWhiteSpace(vs)) return vs;
            double d = p.AsDouble();
            return d == 0 ? "" : d.ToString("G6");
        }

        // ── STEP 3: Assemble PlanExport ──
        private PlanExport BuildExport(List<RoomData> rooms, string pngPath, int imgW, int imgH)
        {
            string base64 = File.Exists(pngPath)
                ? Convert.ToBase64String(File.ReadAllBytes(pngPath))
                : "";

            var info = _doc.ProjectInformation;
            return new PlanExport
            {
                ProjectName   = info.Name,
                ProjectNumber = info.Number,
                LevelName     = _view.GenLevel?.Name ?? _view.Name,
                LevelElevation= (_view.GenLevel?.Elevation ?? 0) * 0.3048,
                ExportDate    = DateTime.Now.ToString("yyyy-MM-dd HH:mm"),
                RevitVersion  = _doc.Application.VersionNumber,
                ImageWidth    = imgW,
                ImageHeight   = imgH,
                ImageBase64   = base64,
                Rooms         = rooms,
            };
        }

        // ── STEP 4: Standalone SVG ──
        private string BuildSvg(PlanExport export)
        {
            int w = export.ImageWidth, h = export.ImageHeight;
            var sb = new StringBuilder();
            sb.AppendLine($@"<?xml version=""1.0"" encoding=""UTF-8""?>
<svg xmlns=""http://www.w3.org/2000/svg"" viewBox=""0 0 {w} {h}"" width=""{w}"" height=""{h}""
     data-project=""{Esc(export.ProjectName)}"" data-level=""{Esc(export.LevelName)}"">
  <image href=""data:image/png;base64,{export.ImageBase64}"" x=""0"" y=""0"" width=""{w}"" height=""{h}""/>
  <g id=""rooms"">");

            foreach (var room in export.Rooms)
            {
                // Encode all parameters as data attributes
                var paramAttrs = string.Join(" ", room.Parameters.Select(kv =>
                    $"data-p-{Esc(kv.Key.Replace(" ", "-"))}=\"{Esc(kv.Value)}\""));

                sb.AppendLine($@"    <polygon id=""room-{room.RevitId}"" class=""bimflow-room""
      points=""{room.SvgPolygon}""
      fill=""transparent"" stroke=""transparent"" stroke-width=""2""
      data-id=""{room.RevitId}"" data-name=""{Esc(room.Name)}"" data-number=""{Esc(room.Number)}""
      {paramAttrs}>
      <title>{Esc(room.Number)} — {Esc(room.Name)}</title>
    </polygon>");
            }

            sb.AppendLine("  </g>\n</svg>");
            return sb.ToString();
        }

        private string SafeName() =>
            System.Text.RegularExpressions.Regex.Replace(
                $"{_doc.ProjectInformation.Name}_{_view.Name}", @"[^\w]", "_");

        private static string Esc(string s) =>
            s.Replace("&", "&amp;").Replace("\"", "&quot;").Replace("<", "&lt;").Replace(">", "&gt;");
    }
}
