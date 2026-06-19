using Newtonsoft.Json;
using System;
using System.IO;
using System.Net.Http;
using System.Text;

namespace BIMFlowPlugin.Auth
{
    internal class SessionData
    {
        [JsonProperty("email")]   public string Email   { get; set; }
        [JsonProperty("name")]    public string Name    { get; set; }
        [JsonProperty("session")] public string Session { get; set; }
        [JsonProperty("plan")]    public string Plan    { get; set; }
    }

    internal static class BFSession
    {
        public const string BaseUrl  = "https://bimatika-bimplan.pages.dev";
        public const string LoginUrl = BaseUrl + "/api/auth/login";

        private static readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };

        private static string SessionFile => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BIMFlow", "session.json");

        public static SessionData Current { get; private set; }
        public static bool IsAuthenticated => Current?.Session?.Length > 0;

        static BFSession() { TryLoad(); }

        private static void TryLoad()
        {
            try
            {
                if (!File.Exists(SessionFile)) return;
                Current = JsonConvert.DeserializeObject<SessionData>(File.ReadAllText(SessionFile));
            }
            catch { Current = null; }
        }

        public static void Save(SessionData data)
        {
            Current = data;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(SessionFile));
                File.WriteAllText(SessionFile, JsonConvert.SerializeObject(data, Formatting.Indented));
            }
            catch { }
        }

        public static void Clear()
        {
            Current = null;
            try { if (File.Exists(SessionFile)) File.Delete(SessionFile); } catch { }
        }

        // Returns (ok, errorMessage)
        public static (bool ok, string error) Login(string email, string password)
        {
            try
            {
                var body    = JsonConvert.SerializeObject(new { email, password });
                var content = new StringContent(body, Encoding.UTF8, "application/json");
                var resp    = _http.PostAsync(LoginUrl, content).GetAwaiter().GetResult();
                var json    = resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                dynamic data = JsonConvert.DeserializeObject<dynamic>(json);

                if (!resp.IsSuccessStatusCode)
                {
                    string msg = data?.error ?? "Erreur de connexion";
                    return (false, msg.ToString());
                }

                Save(new SessionData
                {
                    Email   = data.user.email.ToString(),
                    Name    = data.user.name.ToString(),
                    Session = data.session.ToString(),
                    Plan    = data.user.plan?.ToString() ?? "free",
                });
                return (true, null);
            }
            catch (Exception ex)
            {
                return (false, "Erreur réseau : " + ex.Message);
            }
        }
    }
}
