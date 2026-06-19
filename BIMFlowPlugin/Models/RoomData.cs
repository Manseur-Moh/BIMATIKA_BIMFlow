using System.Collections.Generic;

namespace BIMFlowPlugin.Models
{
    public class RoomData
    {
        public string RevitId   { get; set; } = "";
        public string Number    { get; set; } = "";
        public string Name      { get; set; } = "";
        public string LevelName { get; set; } = "";

        public string SvgPolygon { get; set; } = "";
        public double CentroidX  { get; set; }
        public double CentroidY  { get; set; }

        // Numeric geometry for analysis/costing (metric units, locale-independent)
        public double AreaM2     { get; set; }   // m²
        public double PerimeterM { get; set; }   // m
        public double Volume     { get; set; }   // m³

        // 3D extrusion data (metres, model coordinates) — boundary footprint + height.
        public double BaseZ  { get; set; }                          // floor elevation (m)
        public double Height { get; set; }                          // room height (m)
        public List<double[]> Footprint { get; set; } = new();      // [[x,y], …] outer loop (m)

        // Parameter value by name
        public Dictionary<string, string> Parameters { get; set; } = new();
        // "text" | "number" | "integer" | "boolean"
        public Dictionary<string, string> ParameterTypes    { get; set; } = new();
        // true = locked (read-only in Revit, cannot be sent back)
        public Dictionary<string, bool>   ParameterReadOnly { get; set; } = new();
        // Non-empty list = dropdown choices for that parameter
        public Dictionary<string, List<string>> ParameterChoices { get; set; } = new();
    }

    public class PlanExport
    {
        public string ProjectName    { get; set; } = "";
        public string ProjectNumber  { get; set; } = "";
        public string ProjectCode    { get; set; } = ""; // stable code derived from Revit GUID
        public string LevelName      { get; set; } = "";
        public double LevelElevation { get; set; }      // m — for ordering levels by height
        public string ExportDate    { get; set; } = "";
        public string RevitVersion  { get; set; } = "";
        public int    ImageWidth    { get; set; }
        public int    ImageHeight   { get; set; }
        public string ImageBase64   { get; set; } = "";
        public List<RoomData> Rooms { get; set; } = new();
    }

    // Payload from website → Revit
    public class RoomUpdate
    {
        public string RevitId { get; set; } = "";
        public Dictionary<string, string> Parameters { get; set; } = new();
    }

    // Request to create a new room parameter in Revit
    public class NewParameterRequest
    {
        public string Name         { get; set; } = "";
        // Spec type token (see ReceiveFromBIMFlowCommand.ResolveSpec):
        // "text" | "integer" | "number" | "length" | "area" | "volume" | "angle" |
        // "yesno" | "url" | "material" | "currency" | "mass" | ...
        public string Type         { get; set; } = "text";
        // Parameter group token (see ResolveGroup): "data" | "identity" | "dimensions" |
        // "constraints" | "text" | "graphics" | "phasing" | "other" ...
        public string Group        { get; set; } = "data";
        // "shared" = stored in shared parameter file (GUID, schedulable across files)
        // "project" = project parameter (file-local)
        public string Kind         { get; set; } = "shared";
        // Bind as instance (true) or type (false) parameter
        public bool   Instance     { get; set; } = true;
        public string DefaultValue { get; set; } = "";
    }

    public class PlanUpdate
    {
        public string PlanKey { get; set; } = "";
        public List<RoomUpdate>           Updates       { get; set; } = new();
        public List<NewParameterRequest>  NewParameters { get; set; } = new();
    }
}
