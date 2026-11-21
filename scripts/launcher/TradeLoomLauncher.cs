using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace TradeLoomLauncher
{
    static class Program
    {
        private static Process _nodeProc;
        private static NotifyIcon _trayIcon;
        private static string _baseDir;
        private static string _workspaceDir;
        private static string _runtimeJsonPath;
        private static string _logPath;
        private static string _url;
        private static int _port;
        private static volatile bool _exiting;

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            _baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            _workspaceDir = Path.Combine(_baseDir, "workspace");
            Directory.CreateDirectory(_workspaceDir);
            _runtimeJsonPath = Path.Combine(_workspaceDir, ".runtime.json");
            _logPath = Path.Combine(_workspaceDir, "server.log");

            string mutexName = "Global\\TradeLoom_" + ShortHash(_baseDir.ToLowerInvariant());
            bool createdNew;
            using (var mutex = new Mutex(true, mutexName, out createdNew))
            {
                if (!createdNew)
                {
                    string existingUrl = ReadRunningUrl();
                    if (!string.IsNullOrEmpty(existingUrl))
                    {
                        OpenAppWindow(existingUrl);
                        return;
                    }
                    MessageBox.Show(
                        "TradeLoom 已在后台运行，请查看任务栏右下角系统托盘图标。",
                        "TradeLoom · 织脉",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information
                    );
                    return;
                }

                string nodeExe = Path.Combine(_baseDir, "runtime", "node.exe");
                string serverJs = Path.Combine(_baseDir, "app", "server.js");
                if (!File.Exists(nodeExe) || !File.Exists(serverJs))
                {
                    MessageBox.Show(
                        "未找到内置运行环境（runtime\\node.exe 或 app\\server.js）。\n请先完整解压整个压缩包，不要直接在压缩软件内双击运行。",
                        "TradeLoom 启动失败",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                _port = FindAvailablePort(3200, 3230);
                if (_port <= 0)
                {
                    MessageBox.Show(
                        "本地端口 3200–3230 均被占用，无法启动服务。",
                        "TradeLoom 启动失败",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                _url = "http://127.0.0.1:" + _port;

                if (!StartNodeServer(nodeExe, serverJs))
                {
                    return;
                }

                bool ready = WaitForServerReady(_url + "/api/vault", 25000);
                if (!ready)
                {
                    StopNodeServer();
                    MessageBox.Show(
                        "TradeLoom 本地服务启动超时。\n请查看日志文件排查：\n" + _logPath,
                        "TradeLoom 启动超时",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                WriteRuntimeJson();
                SetupTrayIcon();
                OpenAppWindow(_url);

                Application.ApplicationExit += (s, e) => Shutdown();
                Application.Run();
            }
        }

        private static bool StartNodeServer(string nodeExe, string serverJs)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = nodeExe,
                    Arguments = "\"" + serverJs + "\"",
                    WorkingDirectory = Path.Combine(_baseDir, "app"),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                psi.EnvironmentVariables["HOSTNAME"] = "127.0.0.1";
                psi.EnvironmentVariables["PORT"] = _port.ToString();
                psi.EnvironmentVariables["NODE_ENV"] = "production";
                psi.EnvironmentVariables["TRADELOOM_WORKSPACE_DIR"] = _workspaceDir;

                var logWriter = new StreamWriter(_logPath, false, Encoding.UTF8) { AutoFlush = true };
                logWriter.WriteLine("=== TradeLoom Portable Start @ " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " ===");
                logWriter.WriteLine("URL: " + _url);
                logWriter.WriteLine("Workspace: " + _workspaceDir);

                _nodeProc = new Process { StartInfo = psi, EnableRaisingEvents = true };
                _nodeProc.OutputDataReceived += (s, e) =>
                {
                    if (e.Data != null) { try { lock (logWriter) logWriter.WriteLine(e.Data); } catch { } }
                };
                _nodeProc.ErrorDataReceived += (s, e) =>
                {
                    if (e.Data != null) { try { lock (logWriter) logWriter.WriteLine("[ERR] " + e.Data); } catch { } }
                };
                _nodeProc.Exited += (s, e) =>
                {
                    try { lock (logWriter) logWriter.Dispose(); } catch { }
                    if (!_exiting)
                    {
                        try { Application.Exit(); } catch { }
                    }
                };

                _nodeProc.Start();
                _nodeProc.BeginOutputReadLine();
                _nodeProc.BeginErrorReadLine();
                return true;
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "启动内置 Node 服务失败：" + ex.Message,
                    "TradeLoom 启动失败",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return false;
            }
        }

        private static bool WaitForServerReady(string healthUrl, int timeoutMs)
        {
            var sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < timeoutMs)
            {
                if (_nodeProc == null || _nodeProc.HasExited) return false;
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create(healthUrl);
                    req.Timeout = 1200;
                    req.Method = "GET";
                    using (var resp = (HttpWebResponse)req.GetResponse())
                    {
                        if ((int)resp.StatusCode == 200) return true;
                    }
                }
                catch { }
                Thread.Sleep(250);
            }
            return false;
        }

        private static void SetupTrayIcon()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("打开 TradeLoom 独立窗口", null, (s, e) => OpenAppWindow(_url));
            menu.Items.Add("打开实盘账本 (/ledger)", null, (s, e) => OpenAppWindow(_url + "/ledger"));
            menu.Items.Add("在默认浏览器中打开", null, (s, e) => OpenDefaultBrowser(_url));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("打开本地工作区 (Obsidian Vault)", null, (s, e) => OpenFolder(_workspaceDir));
            menu.Items.Add("查看本地运行日志", null, (s, e) => OpenFile(_logPath));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出并停止本地服务", null, (s, e) =>
            {
                Shutdown();
                Application.Exit();
            });

            _trayIcon = new NotifyIcon
            {
                Icon = CreateBrandIcon(),
                Text = "TradeLoom · 织脉 (" + _url + ")",
                ContextMenuStrip = menu,
                Visible = true,
            };
            _trayIcon.DoubleClick += (s, e) => OpenAppWindow(_url);
            _trayIcon.ShowBalloonTip(
                2800,
                "TradeLoom · 织脉已就绪",
                "本地服务运行于 " + _url + "（右键托盘图标可随时打开或退出）",
                ToolTipIcon.Info
            );
        }

        private static void OpenAppWindow(string targetUrl)
        {
            string browser = FindChromiumBrowser();
            if (!string.IsNullOrEmpty(browser))
            {
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = browser,
                        Arguments = "--app=\"" + targetUrl + "\" --window-size=1440,920",
                        UseShellExecute = false,
                    });
                    return;
                }
                catch { }
            }
            OpenDefaultBrowser(targetUrl);
        }

        private static void OpenDefaultBrowser(string targetUrl)
        {
            try
            {
                Process.Start(new ProcessStartInfo { FileName = targetUrl, UseShellExecute = true });
            }
            catch { }
        }

        private static void OpenFolder(string dir)
        {
            try
            {
                Process.Start(new ProcessStartInfo { FileName = "explorer.exe", Arguments = "\"" + dir + "\"", UseShellExecute = true });
            }
            catch { }
        }

        private static void OpenFile(string file)
        {
            try
            {
                if (File.Exists(file))
                {
                    Process.Start(new ProcessStartInfo { FileName = file, UseShellExecute = true });
                }
            }
            catch { }
        }

        private static string FindChromiumBrowser()
        {
            string[] candidates = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google\\Chrome\\Application\\chrome.exe"),
            };
            foreach (var p in candidates)
            {
                if (File.Exists(p)) return p;
            }
            return null;
        }

        private static int FindAvailablePort(int startPort, int endPort)
        {
            for (int p = startPort; p <= endPort; p++)
            {
                try
                {
                    var listener = new TcpListener(IPAddress.Loopback, p);
                    listener.Start();
                    listener.Stop();
                    return p;
                }
                catch { }
            }
            return -1;
        }

        private static void WriteRuntimeJson()
        {
            try
            {
                string json = "{\n"
                    + "  \"url\": \"" + _url + "\",\n"
                    + "  \"port\": " + _port + ",\n"
                    + "  \"pid\": " + (_nodeProc != null ? _nodeProc.Id : 0) + ",\n"
                    + "  \"launcherPid\": " + Process.GetCurrentProcess().Id + ",\n"
                    + "  \"startedAt\": \"" + DateTime.UtcNow.ToString("o") + "\"\n"
                    + "}\n";
                File.WriteAllText(_runtimeJsonPath, json, Encoding.UTF8);
            }
            catch { }
        }

        private static string ReadRunningUrl()
        {
            try
            {
                if (!File.Exists(_runtimeJsonPath)) return null;
                string txt = File.ReadAllText(_runtimeJsonPath, Encoding.UTF8);
                int idx = txt.IndexOf("\"url\":");
                if (idx < 0) return null;
                int q1 = txt.IndexOf('"', idx + 6);
                int q2 = txt.IndexOf('"', q1 + 1);
                if (q1 > 0 && q2 > q1) return txt.Substring(q1 + 1, q2 - q1 - 1);
            }
            catch { }
            return null;
        }

        private static void StopNodeServer()
        {
            try
            {
                if (_nodeProc != null && !_nodeProc.HasExited)
                {
                    _nodeProc.Kill();
                    _nodeProc.WaitForExit(3000);
                }
            }
            catch { }
            try
            {
                if (File.Exists(_runtimeJsonPath)) File.Delete(_runtimeJsonPath);
            }
            catch { }
        }

        private static void Shutdown()
        {
            if (_exiting) return;
            _exiting = true;
            try
            {
                if (_trayIcon != null)
                {
                    _trayIcon.Visible = false;
                    _trayIcon.Dispose();
                    _trayIcon = null;
                }
            }
            catch { }
            StopNodeServer();
        }

        private static Icon CreateBrandIcon()
        {
            using (var bmp = new Bitmap(32, 32))
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.FromArgb(12, 15, 23));
                using (var border = new Pen(Color.FromArgb(140, 110, 255), 2.2f))
                {
                    g.DrawRectangle(border, 2, 2, 27, 27);
                }
                using (var pen = new Pen(Color.FromArgb(34, 211, 238), 2.6f))
                {
                    pen.StartCap = LineCap.Round;
                    pen.EndCap = LineCap.Round;
                    g.DrawLine(pen, 8, 10, 24, 10);
                    g.DrawLine(pen, 16, 10, 16, 22);
                    g.DrawLines(pen, new[] { new Point(7, 21), new Point(12, 16), new Point(17, 20), new Point(25, 13) });
                }
                return Icon.FromHandle(bmp.GetHicon());
            }
        }

        private static string ShortHash(string s)
        {
            using (var sha = SHA256.Create())
            {
                byte[] b = sha.ComputeHash(Encoding.UTF8.GetBytes(s));
                return BitConverter.ToString(b, 0, 6).Replace("-", "");
            }
        }
    }
}