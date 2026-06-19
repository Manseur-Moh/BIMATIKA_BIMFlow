using System;
using System.Drawing;
using System.Windows.Forms;

namespace BIMFlowPlugin.Auth
{
    internal class LoginDialog : Form
    {
        private TextBox    _emailBox;
        private TextBox    _pwBox;
        private Label      _errorLabel;
        private Button     _loginBtn;

        public LoginDialog()
        {
            Text            = "BIMFlow — Connexion BIMATIKA";
            Width           = 400;
            Height          = 310;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox     = false;
            MinimizeBox     = false;
            StartPosition   = FormStartPosition.CenterScreen;
            BackColor       = Color.FromArgb(17, 24, 39);

            // Title
            var title = new Label
            {
                Text      = "BIMFlow · BIMATIKA",
                ForeColor = Color.FromArgb(56, 189, 248),
                Font      = new Font("Segoe UI", 14, FontStyle.Bold),
                Left = 24, Top = 20, Width = 340, Height = 28,
            };

            var sub = new Label
            {
                Text      = "Connectez-vous pour envoyer des plans",
                ForeColor = Color.FromArgb(100, 116, 139),
                Font      = new Font("Segoe UI", 9),
                Left = 24, Top = 52, Width = 340, Height = 18,
            };

            // Email
            var lblEmail = MakeLabel("Email", 84);
            _emailBox = MakeInput(104);

            // Password
            var lblPw = MakeLabel("Mot de passe", 136);
            _pwBox = MakeInput(156);
            _pwBox.PasswordChar = '●';

            // Error message
            _errorLabel = new Label
            {
                Text      = "",
                ForeColor = Color.FromArgb(248, 113, 113),
                Font      = new Font("Segoe UI", 9),
                Left = 24, Top = 194, Width = 340, Height = 32,
            };

            // Login button
            _loginBtn = new Button
            {
                Text      = "Se connecter →",
                BackColor = Color.FromArgb(29, 78, 216),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font      = new Font("Segoe UI", 10, FontStyle.Bold),
                Left = 24, Top = 232, Width = 340, Height = 38,
                Cursor    = Cursors.Hand,
            };
            _loginBtn.FlatAppearance.BorderSize = 0;
            _loginBtn.Click  += (s, e) => TryLogin();
            _pwBox.KeyDown   += (s, e) => { if (e.KeyCode == Keys.Enter) TryLogin(); };
            _emailBox.KeyDown += (s, e) => { if (e.KeyCode == Keys.Enter) _pwBox.Focus(); };

            Controls.AddRange(new Control[]
            {
                title, sub, lblEmail, _emailBox, lblPw, _pwBox, _errorLabel, _loginBtn
            });
        }

        private Label MakeLabel(string text, int top) => new Label
        {
            Text = text, ForeColor = Color.FromArgb(148, 163, 184),
            Font = new Font("Segoe UI", 9), Left = 24, Top = top, Width = 340, Height = 16,
        };

        private TextBox MakeInput(int top) => new TextBox
        {
            Left = 24, Top = top, Width = 340, Height = 28,
            BackColor = Color.FromArgb(10, 17, 32), ForeColor = Color.FromArgb(226, 232, 240),
            BorderStyle = BorderStyle.FixedSingle, Font = new Font("Segoe UI", 10),
        };

        private void TryLogin()
        {
            _errorLabel.Text = "Connexion en cours…";
            _loginBtn.Enabled = false;
            Application.DoEvents();

            var (ok, err) = BFSession.Login(_emailBox.Text.Trim(), _pwBox.Text);
            if (ok)
            {
                DialogResult = DialogResult.OK;
                Close();
            }
            else
            {
                _errorLabel.Text  = err ?? "Email ou mot de passe incorrect.";
                _loginBtn.Enabled = true;
            }
        }
    }
}
