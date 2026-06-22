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

        private readonly List<View>   _views   = new List<View>();
        private readonly List<string> _labels  = new List<string>();
        private readonly List<bool>   _checked = new List<bool>();
        private readonly List<int>    _vis     = new List<int>();   // visible row -> master index
        private bool   _syncing;

        public List<View> SelectedPlans { get; private set; } = new List<View>();

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
                for (int i = 0; i < _views.Count; i++)
                    if (_checked[i]) ids.Add(_views[i].UniqueId);
                File.WriteAllLines(FavPath, ids);
            }
            catch { }
        }

        public PlanSelectionDialog(List<(View view, int roomCount)> plans)
        {
            Text            = "BIMFlow — Sélectionner les vues à envoyer";
            Size            = new SD.Size(524, 540);
            StartPosition   = WF.FormStartPosition.CenterScreen;
            FormBorderStyle = WF.FormBorderStyle.FixedDialog;
            MaximizeBox     = false;
            MinimizeBox     = false;
            BackColor       = SD.Color.FromArgb(22, 33, 52);
            ForeColor       = SD.Color.FromArgb(226, 232, 240);
            Font            = new SD.Font("Segoe UI", 9f);

            var header = new WF.Label
            {
                Text      = "Sélectionnez les plans à envoyer vers BIMFlow :",
                Location  = new SD.Point(12, 12),
                Size      = new SD.Size(496, 20),
                ForeColor = SD.Color.FromArgb(148, 163, 184),
            };

            foreach (var (view, count) in plans.OrderBy(p => p.view.Name))
            {
                string label = $"📐 {view.Name}  ({count} pièce{(count > 1 ? "s" : "")})";
                _views.Add(view);
                _labels.Add(label);
                _checked.Add(count > 0);
            }

            // Apply a saved favourite selection instead of the default, if any.
            var fav = LoadFavorites();
            if (fav.Count > 0)
                for (int i = 0; i < _views.Count; i++)
                    _checked[i] = fav.Contains(_views[i].UniqueId);

            _list = new WF.CheckedListBox
            {
                Location     = new SD.Point(12, 38),
                Size         = new SD.Size(496, 268),
                BackColor    = SD.Color.FromArgb(15, 23, 42),
                ForeColor    = SD.Color.FromArgb(226, 232, 240),
                Font         = new SD.Font("Segoe UI", 9.5f),
                CheckOnClick = true,
                BorderStyle  = WF.BorderStyle.FixedSingle,
            };
            _list.ItemCheck += (s, e) =>
            {
                if (_syncing) return;
                if (e.Index >= 0 && e.Index < _vis.Count)
                    _checked[_vis[e.Index]] = (e.NewValue == WF.CheckState.Checked);
                BeginInvoke(new Action(RefreshInfo));
            };

            // ── Action row ──
            _btnAll  = MakeSmall("Tout",      12,  312, 78);
            _btnAll.Click  += (s, e) => { SetVisible(true);  };
            _btnNone = MakeSmall("Aucun",     94,  312, 78);
            _btnNone.Click += (s, e) => { SetVisible(false); };
            _btnFav  = MakeSmall("⭐ Favori", 176, 312, 150);
            _btnFav.Click  += (s, e) => { SaveFavorites(); WF.MessageBox.Show("Sélection enregistrée comme favori ⭐.\nLe bouton « ⚡ Envoi rapide » la renverra en un clic.", "BIMFlow"); };
            _btnQuick = MakeSmall("⚡ Envoi rapide", 330, 312, 178);
            _btnQuick.BackColor = SD.Color.FromArgb(13, 68, 41);
            _btnQuick.ForeColor = SD.Color.FromArgb(63, 185, 80);
            _btnQuick.Click += (s, e) =>
            {
                var f = LoadFavorites();
                if (f.Count == 0) { WF.MessageBox.Show("Aucun favori enregistré.\nCochez des vues puis cliquez « ⭐ Favori ».", "BIMFlow"); return; }
                for (int i = 0; i < _views.Count; i++) _checked[i] = f.Contains(_views[i].UniqueId);
                DialogResult = WF.DialogResult.OK; Close();
            };

            _lblInfo = new WF.Label
            {
                Location  = new SD.Point(12, 350), Size = new SD.Size(330, 18),
                ForeColor = SD.Color.FromArgb(56, 189, 248), Font = new SD.Font("Segoe UI", 8.5f),
            };

            _btnCancel = new WF.Button
            {
                Text = "Annuler", DialogResult = WF.DialogResult.Cancel,
                Location = new SD.Point(336, 446), Size = new SD.Size(84, 32),
                BackColor = SD.Color.FromArgb(30, 41, 59), ForeColor = SD.Color.FromArgb(148, 163, 184), FlatStyle = WF.FlatStyle.Flat,
            };
            _btnCancel.FlatAppearance.BorderColor = SD.Color.FromArgb(51, 65, 85);

            _btnOk = new WF.Button
            {
                Text = "Envoyer", DialogResult = WF.DialogResult.OK,
                Location = new SD.Point(424, 446), Size = new SD.Size(84, 32),
                BackColor = SD.Color.FromArgb(29, 78, 216), ForeColor = SD.Color.White, FlatStyle = WF.FlatStyle.Flat,
                Font = new SD.Font("Segoe UI", 9f, SD.FontStyle.Bold),
            };
            _btnOk.FlatAppearance.BorderColor = SD.Color.FromArgb(37, 99, 235);

            AcceptButton = _btnOk;
            CancelButton = _btnCancel;
            Controls.AddRange(new WF.Control[]
            {
                header, _list,
                _btnAll, _btnNone, _btnFav, _btnQuick, _lblInfo, _btnCancel, _btnOk,
            });

            RebuildList();
        }

        private void RebuildList()
        {
            _syncing = true;
            _list.Items.Clear();
            _vis.Clear();
            for (int i = 0; i < _views.Count; i++)
            {
                _list.Items.Add(_labels[i], _checked[i]);
                _vis.Add(i);
            }
            _syncing = false;
            RefreshInfo();
        }

        // Check/uncheck every VISIBLE row.
        private void SetVisible(bool value)
        {
            _syncing = true;
            for (int j = 0; j < _list.Items.Count; j++) { _list.SetItemChecked(j, value); _checked[_vis[j]] = value; }
            _syncing = false;
            RefreshInfo();
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
            int n = _checked.Count(c => c);
            _lblInfo.Text = n == 0 ? "Aucun plan sélectionné"
                : $"{n} plan{(n > 1 ? "s" : "")} sélectionné{(n > 1 ? "s" : "")}";
        }

        protected override void OnFormClosed(WF.FormClosedEventArgs e)
        {
            base.OnFormClosed(e);
            if (DialogResult == WF.DialogResult.OK)
            {
                SelectedPlans = new List<View>();
                for (int i = 0; i < _views.Count; i++)
                    if (_checked[i]) SelectedPlans.Add(_views[i]);
            }
        }
    }
}
