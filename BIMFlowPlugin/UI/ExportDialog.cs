using System.Windows.Forms;

namespace BIMFlowPlugin.UI
{
    /// <summary>
    /// Simple WPF dialog: shows view info and lets user pick an output folder.
    /// </summary>
    public class ExportDialog
    {
        private readonly string _viewName;
        private readonly int    _roomCount;

        public string OutputDirectory { get; private set; } =
            System.IO.Path.Combine(
                System.Environment.GetFolderPath(System.Environment.SpecialFolder.Desktop),
                "BIMFlow_Export");

        public bool IncludeBackground { get; private set; } = true;
        public bool EmbedBase64       { get; private set; } = true;

        public ExportDialog(string viewName, int roomCount)
        {
            _viewName  = viewName;
            _roomCount = roomCount;
        }

        /// <summary>Returns true if user confirmed, false if cancelled.</summary>
        public bool ShowDialog()
        {
            // Build the dialog via TaskDialog (no XAML needed — simpler deployment)
            var td = new Autodesk.Revit.UI.TaskDialog("BIMFlow — Export SVG Plan")
            {
                MainInstruction = $"Exporter le plan : {_viewName}",
                MainContent =
                    $"• Pièces détectées : {_roomCount}\n" +
                    $"• Image PNG arrière-plan : Oui (150 DPI)\n" +
                    $"• Paramètres JSON : Tous\n" +
                    $"• SVG interactif : Oui\n\n" +
                    $"Dossier de sortie :\n{OutputDirectory}",
                CommonButtons =
                    Autodesk.Revit.UI.TaskDialogCommonButtons.Ok |
                    Autodesk.Revit.UI.TaskDialogCommonButtons.Cancel,
                DefaultButton = Autodesk.Revit.UI.TaskDialogResult.Ok,
            };

            td.AddCommandLink(
                Autodesk.Revit.UI.TaskDialogCommandLinkId.CommandLink1,
                "Changer le dossier de sortie…");

            var result = td.Show();

            if (result == Autodesk.Revit.UI.TaskDialogResult.CommandLink1)
            {
                // Let user pick folder, then re-show
                var browser = new FolderBrowserDialog
                {
                    Description      = "Choisir le dossier d'export BIMFlow",
                    ShowNewFolderButton = true,
                    SelectedPath     = OutputDirectory,
                };
                if (browser.ShowDialog() == DialogResult.OK)
                    OutputDirectory = browser.SelectedPath;

                return ShowDialog(); // recurse
            }

            return result == Autodesk.Revit.UI.TaskDialogResult.Ok;
        }
    }

    /// <summary>
    /// Minimal progress indicator using TaskDialog (non-blocking).
    /// For production, replace with a proper WPF progress window.
    /// </summary>
    public class ProgressDialog : System.IDisposable
    {
        private readonly string _message;

        public ProgressDialog(string message) => _message = message;

        public void Show()
        {
            // In production: show WPF window with progress bar
            // For now: status bar message via Revit API would go here
            // We keep it simple — Revit shows a spinning cursor automatically
        }

        public void Close() { }

        public void Dispose() => Close();
    }
}
