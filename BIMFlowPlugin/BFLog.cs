using System;

namespace BIMFlowPlugin
{
    internal static class BFLog {
        private static readonly string Path = System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BIMFlow", "bimflow.log");
        public static void Warn(string msg) {
            try {
                System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path));
                System.IO.File.AppendAllText(Path, $"{DateTime.Now:s}  {msg}{Environment.NewLine}");
            } catch { /* logging ne doit jamais throw */ }
        }
    }
}
