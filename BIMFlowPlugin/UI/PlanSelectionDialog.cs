using Autodesk.Revit.DB;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

using WF = System.Windows.Forms;
using SD = System.Drawing;

namespace BIMFlowPlugin.UI
{
    public class PlanSelectionDialog : WF.Form
    {
        private WF.CheckedListBox _list;
        private WF.Button _btnOk, _btnCancel, _btnAll, _btnNone, _btnFav, _btnQuick;
        private WF.Label  _lblInfo;

        private readonly List<ViewPlan> _views = new List<ViewPlan>();
        public List<ViewPlan> SelectedPlans { get; private set; } = new List<ViewPlan>();

        private static string FavPath => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BIMFlow", "fav_plans.txt");

        private static HashSet<string> LoadFavorites()
        {
            try { if (File.Exists(FavPath)) return new HashSet<string>(File.ReadAllLines(FavPath).Where(l => !string.IsNullOrWhiteSpace(l))); }
            catch { }
            return new HashSet<string>();
        }
        private void SaveFavorites()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(FavPath));
                var ids = new List<string>();
                for (int i = 0; i < _list.Items.Count; i++)
                    if (_list.GetItemChecked(i)) ids.Add(_views[i].UniqueId);
                File.WriteAllLines(FavPath, ids);
            }
            catch { }
        }

        public PlanSelectionDialog(List<(ViewPlan view, int roomCount)> plans)
        {
            Text            = "BIMFlow — Sélectionner les plans à envoyer";
            Size            = new SD.Size(524, 500);
            StartPosition   = WF.FormStartPosition.CenterScreen;
            FormBorderStyle = WF.FormBorderStyle.FixedDialog;
            MaximizeBox     = false;
            MinimizeBox     = false;
            BackColor       = SD.Color.FromArgb(22, 33, 52);
            ForeColor       = SD.Color.FromArgb(226, 232, 240);
            Font            = new SD.Font("Segoe UI", 9f);

            var header = new WF.Label
            {
                Text      = "Sélectionnez les plans de niveaux à envoyer vers BIMFlow :",
                Location  = new SD.Point(12, 12),
                Size      = new SD.Size(496, 20),
                ForeColor = SD.Color.FromArgb(148, 163, 184),
            };

            _list = new WF.CheckedListBox
            {
                Location     = new SD.Point(12, 38),
                Size         = new SD.Size(496, 300),
                BackColor    = SD.Color.FromArgb(15, 23, 42),
                ForeColor    = SD.Color.FromArgb(226, 232, 240),
                Font         = new SD.Font("Segoe UI", 9.5f),
                CheckOnClick = true,
                BorderStyle  = WF.BorderStyle.FixedSingle,
            };

            foreach (var (view, count) in plans.OrderBy(p => p.view.Name))
            {
                string label = count > 0
                    ? $"{view.Name}  ({count} pièce{(count > 1 ? "s" : "")})"
                    : $"{view.Name}  (aucune pièce)";
                _list.Items.Add(label, isChecked: count > 0);
                _views.Add(view);
            }

            // If the user saved a favourite selection, apply it instead of the default.
            var fav = LoadFavorites();
            if (fav.Count > 0)
                for (int i = 0; i < _views.Count; i++)
                    _list.SetItemChecked(i, fav.Contains(_views[i].UniqueId));

            _btnAll  = MakeSmall("Tout",      12,  344, 78);
            _btnAll.Click  += (s, e) => { for (int i = 0; i < _list.Items.Count; i++) _list.SetItemChecked(i, true); RefreshInfo(); };
            _btnNone = MakeSmall("Aucun",     94,  344, 78);
            _btnNone.Click += (s, e) => { for (int i = 0; i < _list.Items.Count; i++) _list.SetItemChecked(i, false); RefreshInfo(); };
            _btnFav  = MakeSmall("⭐ Favori", 176, 344, 150);
            _btnFav.Click  += (s, e) => { SaveFavorites(); WF.MessageBox.Show("Sélection enregistrée comme favori ⭐.\nLe bouton « ⚡ Envoi rapide » la renverra en un clic.", "BIMFlow"); };
            _btnQuick = MakeSmall("⚡ Envoi rapide", 330, 344, 178);
            _btnQuick.BackColor = SD.Color.FromArgb(13, 68, 41);
            _btnQuick.ForeColor = SD.Color.FromArgb(63, 185, 80);
            _btnQuick.Click += (s, e) =>
            {
                var f = LoadFavorites();
                if (f.Count == 0) { WF.MessageBox.Show("Aucun favori enregistré.\nCochez des plans puis cliquez « ⭐ Favori ».", "BIMFlow"); return; }
                for (int i = 0; i < _views.Count; i++) _list.SetItemChecked(i, f.Contains(_views[i].UniqueId));
                DialogResult = WF.DialogResult.OK; Close();
            };

            _lblInfo = new WF.Label
            {
                Location  = new SD.Point(12, 380), Size = new SD.Size(330, 18),
                ForeColor = SD.Color.FromArgb(56, 189, 248), Font = new SD.Font("Segoe UI", 8.5f),
            };

            _btnCancel = new WF.Button
            {
                Text = "Annuler", DialogResult = WF.DialogResult.Cancel,
                Location = new SD.Point(336, 410), Size = new SD.Size(84, 32),
                BackColor = SD.Color.FromArgb(30, 41, 59), ForeColor = SD.Color.FromArgb(148, 163, 184), FlatStyle = WF.FlatStyle.Flat,
            };
            _btnCancel.FlatAppearance.BorderColor = SD.Color.FromArgb(51, 65, 85);

            _btnOk = new WF.Button
            {
                Text = "Envoyer", DialogResult = WF.DialogResult.OK,
                Location = new SD.Point(424, 410), Size = new SD.Size(84, 32),
                BackColor = SD.Color.FromArgb(29, 78, 216), ForeColor = SD.Color.White, FlatStyle = WF.FlatStyle.Flat,
                Font = new SD.Font("Segoe UI", 9f, SD.FontStyle.Bold),
            };
            _btnOk.FlatAppearance.BorderColor = SD.Color.FromArgb(37, 99, 235);

            _list.ItemCheck += (s, e) =>
            {
                int delta = e.NewValue == WF.CheckState.Checked ? 1 : -1;
                int n = _list.CheckedItems.Count + delta;
                _lblInfo.Text = n <= 0 ? "Aucun plan sélectionné" : $"{n} plan{(n > 1 ? "s" : "")} sélectionné{(n > 1 ? "s" : "")}";
            };

            RefreshInfo();
            AcceptButton = _btnOk;
            CancelButton = _btnCancel;
            Controls.AddRange(new WF.Control[] { header, _list, _btnAll, _btnNone, _btnFav, _btnQuick, _lblInfo, _btnCancel, _btnOk });
        }

        private WF.Button MakeSmall(string text, int x, int y, int w)
        {
            var b = new WF.Button
            {
                Text = text, Location = new SD.Point(x, y), Size = new SD.Size(w, 28),
                BackColor = SD.Color.FromArgb(30, 41, 59), ForeColor = SD.Color.FromArgb(148, 163, 184), FlatStyle = WF.FlatStyle.Flat,
                Font = new SD.Font("Segoe UI", 8.5f),
            };
            b.FlatAppearance.BorderColor = SD.Color.FromArgb(51, 65, 85);
            return b;
        }

        private void RefreshInfo()
        {
            int n = _list.CheckedItems.Count;
            _lblInfo.Text = n == 0 ? "Aucun plan sélectionné" : $"{n} plan{(n > 1 ? "s" : "")} sélectionné{(n > 1 ? "s" : "")}";
        }

        protected override void OnFormClosed(WF.FormClosedEventArgs e)
        {
            base.OnFormClosed(e);
            if (DialogResult == WF.DialogResult.OK)
            {
                SelectedPlans = new List<ViewPlan>();
                for (int i = 0; i < _list.Items.Count; i++)
                    if (_list.GetItemChecked(i)) SelectedPlans.Add(_views[i]);
            }
        }
    }
}
