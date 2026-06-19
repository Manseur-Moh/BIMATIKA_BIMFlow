using System;
using WF = System.Windows.Forms;
using SD = System.Drawing;

namespace BIMFlowPlugin.UI
{
    public class ProjectManagerDialog : WF.Form
    {
        private WF.TextBox _codeBox;
        private WF.TextBox _nameBox;
        private WF.CheckBox _registerCb;
        private WF.Button _btnOk, _btnCancel, _btnCopy;
        private bool _changingCode;

        public string ProjectCode { get; private set; } = "";
        public string ProjectName { get; private set; } = "";
        public bool RegisterOnWeb { get; private set; }

        public ProjectManagerDialog(string autoCode, string currentCode, string currentName)
        {
            Text            = "BIMFlow — Gérer le projet";
            Size            = new SD.Size(460, 346);
            StartPosition   = WF.FormStartPosition.CenterScreen;
            FormBorderStyle = WF.FormBorderStyle.FixedDialog;
            MaximizeBox     = false;
            MinimizeBox     = false;
            BackColor       = SD.Color.FromArgb(22, 33, 52);
            ForeColor       = SD.Color.FromArgb(226, 232, 240);
            Font            = new SD.Font("Segoe UI", 9f);

            // ── Section 1 : code automatique (lecture seule) ──
            var lbl1 = MkLabel("Code Revit automatique (lecture seule) :", 12, 16);

            var autoBox = new WF.TextBox
            {
                Text        = autoCode,
                ReadOnly    = true,
                Location    = new SD.Point(12, 38),
                Size        = new SD.Size(298, 28),
                BackColor   = SD.Color.FromArgb(15, 23, 42),
                ForeColor   = SD.Color.FromArgb(100, 116, 139),
                BorderStyle = WF.BorderStyle.FixedSingle,
                Font        = new SD.Font("Consolas", 10f, SD.FontStyle.Bold),
            };

            _btnCopy = MkBtn("📋 Copier", 318, 38, 110,
                SD.Color.FromArgb(30, 41, 59), SD.Color.FromArgb(148, 163, 184));
            _btnCopy.Click += (s, e) =>
            {
                try { WF.Clipboard.SetText(autoBox.Text.Trim()); } catch (Exception ex) { BFLog.Warn("Clipboard: " + ex.Message); }
                _btnCopy.Text = "✅ Copié !";
                var t = new WF.Timer { Interval = 1500 };
                t.Tick += (ts, te) => { _btnCopy.Text = "📋 Copier"; t.Stop(); t.Dispose(); };
                t.Start();
            };

            // ── Section 2 : code personnalisé ──
            var lbl2 = MkLabel("Code projet personnalisé (utilisé pour les envois) :", 12, 82);

            _codeBox = new WF.TextBox
            {
                Text        = currentCode,
                Location    = new SD.Point(12, 104),
                Size        = new SD.Size(418, 28),
                BackColor   = SD.Color.FromArgb(15, 23, 42),
                ForeColor   = SD.Color.FromArgb(226, 232, 240),
                BorderStyle = WF.BorderStyle.FixedSingle,
                Font        = new SD.Font("Consolas", 10f, SD.FontStyle.Bold),
                MaxLength   = 30,
            };
            _codeBox.TextChanged += (s, e) =>
            {
                if (_changingCode) return;
                _changingCode = true;
                int pos = _codeBox.SelectionStart;
                string t = _codeBox.Text.ToUpperInvariant().Replace(" ", "-");
                if (_codeBox.Text != t) { _codeBox.Text = t; _codeBox.SelectionStart = Math.Min(pos, t.Length); }
                _changingCode = false;
            };

            // ── Section 3 : nom affiché ──
            var lbl3 = MkLabel("Nom du projet (affiché sur BIMFlow) :", 12, 148);

            _nameBox = new WF.TextBox
            {
                Text        = currentName,
                Location    = new SD.Point(12, 170),
                Size        = new SD.Size(418, 28),
                BackColor   = SD.Color.FromArgb(15, 23, 42),
                ForeColor   = SD.Color.FromArgb(226, 232, 240),
                BorderStyle = WF.BorderStyle.FixedSingle,
                MaxLength   = 60,
            };

            // ── Checkbox ──
            _registerCb = new WF.CheckBox
            {
                Text      = "Enregistrer ce nom sur le serveur BIMFlow",
                Location  = new SD.Point(12, 214),
                Size      = new SD.Size(418, 22),
                Checked   = true,
                ForeColor = SD.Color.FromArgb(148, 163, 184),
            };

            // ── Buttons ──
            _btnCancel = MkBtn("Annuler", 238, 268, 90,
                SD.Color.FromArgb(30, 41, 59), SD.Color.FromArgb(148, 163, 184));
            _btnCancel.DialogResult = WF.DialogResult.Cancel;

            _btnOk = MkBtn("Enregistrer", 336, 268, 96,
                SD.Color.FromArgb(29, 78, 216), SD.Color.White);
            _btnOk.DialogResult = WF.DialogResult.OK;
            _btnOk.Font = new SD.Font("Segoe UI", 9f, SD.FontStyle.Bold);
            _btnOk.FlatAppearance.BorderColor = SD.Color.FromArgb(37, 99, 235);

            AcceptButton = _btnOk;
            CancelButton = _btnCancel;

            Controls.AddRange(new WF.Control[]
            {
                lbl1, autoBox, _btnCopy,
                lbl2, _codeBox,
                lbl3, _nameBox,
                _registerCb, _btnCancel, _btnOk,
            });
        }

        protected override void OnFormClosed(WF.FormClosedEventArgs e)
        {
            base.OnFormClosed(e);
            if (DialogResult == WF.DialogResult.OK)
            {
                ProjectCode   = _codeBox.Text.Trim().ToUpperInvariant();
                ProjectName   = _nameBox.Text.Trim();
                RegisterOnWeb = _registerCb.Checked;
            }
        }

        private static WF.Label MkLabel(string text, int x, int y) => new WF.Label
        {
            Text      = text,
            Location  = new SD.Point(x, y),
            AutoSize  = true,
            ForeColor = SD.Color.FromArgb(148, 163, 184),
            Font      = new SD.Font("Segoe UI", 8.5f),
        };

        private static WF.Button MkBtn(string text, int x, int y, int w, SD.Color bg, SD.Color fg)
        {
            var b = new WF.Button
            {
                Text      = text,
                Location  = new SD.Point(x, y),
                Size      = new SD.Size(w, 32),
                BackColor = bg,
                ForeColor = fg,
                FlatStyle = WF.FlatStyle.Flat,
            };
            b.FlatAppearance.BorderColor = SD.Color.FromArgb(51, 65, 85);
            return b;
        }
    }
}
