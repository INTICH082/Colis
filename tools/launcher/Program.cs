using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;

namespace ColisLauncher
{
    class Program
    {
        private static Process serverProcess = null;

        [DllImport("Kernel32")]
        private static extern bool SetConsoleCtrlHandler(EventHandler handler, bool add);

        private delegate bool EventHandler(CtrlType sig);
        private static EventHandler exitHandler;

        private enum CtrlType
        {
            CTRL_C_EVENT = 0,
            CTRL_BREAK_EVENT = 1,
            CTRL_CLOSE_EVENT = 2,
            CTRL_LOGOFF_EVENT = 5,
            CTRL_SHUTDOWN_EVENT = 6
        }

        private static bool Handler(CtrlType sig)
        {
            KillServer();
            return true;
        }

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

        static void Main(string[] args)
        {
            Console.Title = "Colis - Supermarket Simulator 3D";
            Console.OutputEncoding = System.Text.Encoding.UTF8;

            exitHandler += new EventHandler(Handler);
            SetConsoleCtrlHandler(exitHandler, true);
            AppDomain.CurrentDomain.ProcessExit += (s, e) => KillServer();

            PrintHeader();

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            Directory.SetCurrentDirectory(baseDir);

            // 1. Check Node.js
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.Write("[1/4] Проверка Node.js... ");
            if (!CheckCommand("node", "-v"))
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("НЕ НАЙДЕН!");
                Console.WriteLine("\n[ОШИБКА] Для работы игры необходим Node.js (v18+).");
                Console.WriteLine("Пожалуйста, установите его с официального сайта: https://nodejs.org");
                Console.ResetColor();
                Console.WriteLine("\nНажмите любую клавишу для выхода...");
                Console.ReadKey();
                return;
            }
            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine("OK");

            // 2. Check dependencies
            if (!Directory.Exists(Path.Combine(baseDir, "node_modules")))
            {
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine("[2/4] Установка зависимостей (npm install)... Это займет немного времени.");
                Console.ResetColor();
                RunCmd("npm.cmd", "install", baseDir);
            }
            else
            {
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("[2/4] Зависимости проверены: OK");
            }

            // 3. Check build
            string distHtml = Path.Combine(baseDir, "packages", "client", "dist", "index.html");
            string serverJs = Path.Combine(baseDir, "packages", "server", "dist", "server.js");

            if (!File.Exists(distHtml) || !File.Exists(serverJs))
            {
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine("[3/4] Сборка проекта (npm run build)...");
                Console.ResetColor();
                RunCmd("npm.cmd", "run build", baseDir);
            }
            else
            {
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("[3/4] Сборка проверена: OK");
            }

            // 4. Start Server
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("[4/4] Запуск игрового сервера на http://localhost:8080...");
            Console.ResetColor();

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = "node",
                Arguments = "packages/server/dist/server.js",
                WorkingDirectory = baseDir,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            serverProcess = Process.Start(psi);
            if (serverProcess == null)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("[ОШИБКА] Не удалось запустить сервер.");
                Console.ResetColor();
                Console.ReadKey();
                return;
            }

            serverProcess.OutputDataReceived += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                    Console.WriteLine("  [Server] " + e.Data);
            };
            serverProcess.ErrorDataReceived += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                    Console.WriteLine("  [Server Error] " + e.Data);
            };
            serverProcess.BeginOutputReadLine();
            serverProcess.BeginErrorReadLine();

            // Wait for port 8080 to become active
            bool ready = WaitForPort(8080, 10000);
            if (ready)
            {
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("\n[УСПЕХ] Игра запущена!");
                Console.ForegroundColor = ConsoleColor.White;
                Console.WriteLine("Ссылка: http://localhost:8080");
                Console.WriteLine("Открытие игры в браузере...");
                Console.ResetColor();

                try
                {
                    Process.Start(new ProcessStartInfo("http://localhost:8080") { UseShellExecute = true });
                }
                catch { }

                Console.WriteLine("\n" + new string('-', 60));
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine("Кооператив с другом:");
                Console.WriteLine("Друг может подключиться в браузере по адресу: http://<ВАШ_IP>:8080");
                Console.WriteLine("(через локальную сеть, Radmin VPN, Hamachi или ZeroTier)");
                Console.ResetColor();
                Console.WriteLine(new string('-', 60));
                Console.ForegroundColor = ConsoleColor.DarkGray;
                Console.WriteLine("Нажмите [Q] или закройте это окно для завершения игры...");
                Console.ResetColor();

                while (!serverProcess.HasExited)
                {
                    if (Console.KeyAvailable)
                    {
                        var key = Console.ReadKey(true);
                        if (key.Key == ConsoleKey.Q || key.Key == ConsoleKey.Escape)
                            break;
                    }
                    Thread.Sleep(200);
                }
            }
            else
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("[ВНИМАНИЕ] Сервер не ответил вовремя.");
                Console.ResetColor();
            }

            Console.WriteLine("Остановка сервера...");
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
                p.WaitForExit(3000);
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
                    UseShellExecute = false
                });
                p.WaitForExit();
            }
            catch (Exception ex)
            {
                Console.WriteLine("[Ошибка запуска команды] " + ex.Message);
            }
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
                Thread.Sleep(300);
                elapsed += 300;
            }
            return false;
        }

        private static void PrintHeader()
        {
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine(@"
  ======================================================
             COLIS - SUPERMARKET SIMULATOR 3D
  ======================================================
");
            Console.ResetColor();
        }
    }
}
