using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

namespace ColisLauncher
{
    static class Program
    {
        private static Process serverProcess = null;

        private static void KillServer()
        {
            if (serverProcess != null && !serverProcess.HasExited)
            {
                try
                {
                    Process killer = Process.Start(new ProcessStartInfo
                    {
                        FileName = "taskkill",
                        Arguments = "/F /T /PID " + serverProcess.Id,
                        CreateNoWindow = true,
                        UseShellExecute = false
                    });
                    if (killer != null)
                    {
                        killer.WaitForExit(3000);
                    }
                }
                catch { }
            }
        }

        [STAThread]
        static void Main(string[] args)
        {
            AppDomain.CurrentDomain.ProcessExit += (s, e) => KillServer();

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            Directory.SetCurrentDirectory(baseDir);

            // 1. Verify Node.js
            if (!CheckCommand("node", "-v"))
            {
                MessageBox.Show(
                    "Для работы игры необходим установленный Node.js (v18+).\n\nПожалуйста, установите его с официального сайта: https://nodejs.org",
                    "Colis - Не найден Node.js",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            // 2. Check dependencies (npm install if missing)
            if (!Directory.Exists(Path.Combine(baseDir, "node_modules")))
            {
                RunCmd("npm.cmd", "install", baseDir);
            }

            // 3. Check client build (npm run build if missing)
            string distHtml = Path.Combine(baseDir, "packages", "client", "dist", "index.html");
            string serverJs = Path.Combine(baseDir, "packages", "server", "dist", "server.js");

            if (!File.Exists(distHtml) || !File.Exists(serverJs))
            {
                RunCmd("npm.cmd", "run build", baseDir);
            }

            // 4. Start Server silently without console window
            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = "node",
                Arguments = "packages/server/dist/server.js",
                WorkingDirectory = baseDir,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            try
            {
                serverProcess = Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Ошибка запуска сервера игры:\n" + ex.Message,
                    "Colis",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            // 5. Wait for server port 8080 to become active
            bool ready = WaitForPort(8080, 15000);
            if (ready)
            {
                // Open default browser
                try
                {
                    Process.Start(new ProcessStartInfo("http://localhost:8080") { UseShellExecute = true });
                }
                catch { }

                // Wait until the server process exits (e.g. when user closes browser tab)
                if (serverProcess != null)
                {
                    serverProcess.WaitForExit();
                }
            }
            else
            {
                KillServer();
                MessageBox.Show(
                    "Игровой сервер не ответил вовремя. Попробуйте запустить еще раз.",
                    "Colis",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning
                );
            }

            KillServer();
        }

        private static bool CheckCommand(string cmd, string args)
        {
            try
            {
                Process p = Process.Start(new ProcessStartInfo
                {
                    FileName = cmd,
                    Arguments = args,
                    CreateNoWindow = true,
                    UseShellExecute = false
                });
                p.WaitForExit(4000);
                return p.ExitCode == 0;
            }
            catch
            {
                return false;
            }
        }

        private static void RunCmd(string cmd, string args, string workDir)
        {
            try
            {
                Process p = Process.Start(new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c " + cmd + " " + args,
                    WorkingDirectory = workDir,
                    CreateNoWindow = true,
                    UseShellExecute = false
                });
                p.WaitForExit();
            }
            catch { }
        }

        private static bool WaitForPort(int port, int timeoutMs)
        {
            int elapsed = 0;
            while (elapsed < timeoutMs)
            {
                try
                {
                    using (TcpClient tcp = new TcpClient())
                    {
                        var ar = tcp.BeginConnect("127.0.0.1", port, null, null);
                        if (ar.AsyncWaitHandle.WaitOne(400))
                        {
                            tcp.EndConnect(ar);
                            return true;
                        }
                    }
                }
                catch { }
                Thread.Sleep(250);
                elapsed += 250;
            }
            return false;
        }
    }
}
