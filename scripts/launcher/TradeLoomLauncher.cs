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
using Microsoft.Win32;

namespace TradeLoomLauncher
{
    static class Program
    {
        private static Process _nodeProc;
        private static NotifyIcon _trayIcon;
        private static ControlForm _form;
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
                        "TradeLoom 已在后台运行，请查看任务栏或右下角托盘图标。",
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
                        "未找到内置运行环境（runtime\\node.exe 或 app\\server.js）。\n请先将压缩包完整解压到普通文件夹，不要在压缩软件内直接双击运行。",
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

                Icon brandIcon = CreateBrandIcon();
                _form = new ControlForm(brandIcon, _url, _workspaceDir, _logPath);
                SetupTrayIcon(brandIcon);

                var bootThread = new Thread(() =>
                {
                    if (!StartNodeServer(nodeExe, serverJs))
                    {
                        SafeUi(() => _form.SetFailed("内置 Node 服务启动失败，请点击右上角查看启动日志。"));
                        return;
                    }

                    bool ready = WaitForServerReady(_url + "/api/vault", 30000);
                    if (!ready)
                    {
                        StopNodeServer();
                        SafeUi(() => _form.SetFailed("本地服务启动超时，请点击右上角查看启动日志。"));
                        return;
                    }

                    WriteRuntimeJson();
                    SafeUi(() =>
                    {
                        _form.SetReady(_url);
                        OpenAppWindow(_url);
                    });
                });
                bootThread.IsBackground = true;
                bootThread.Start();

                Application.ApplicationExit += (s, e) => Shutdown();
                Application.Run(_form);
            }
        }

        private static void SafeUi(Action act)
        {
            if (_form == null || _form.IsDisposed) return;
            try
            {
                if (_form.InvokeRequired) _form.BeginInvoke(act);
                else act();
            }
            catch { }
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
                // Strip any inherited Electron/Node debug env vars if launched from an IDE/chat client
                psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
                psi.EnvironmentVariables.Remove("NODE_OPTIONS");

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
                };

                _nodeProc.Start();
                _nodeProc.BeginOutputReadLine();
                _nodeProc.BeginErrorReadLine();
                return true;
            }
            catch (Exception ex)
            {
                try { File.AppendAllText(_logPath, "\n[LAUNCHER ERR] " + ex + "\n", Encoding.UTF8); } catch { }
                return false;
            }
        }

        private static bool WaitForServerReady(string healthUrl, int timeoutMs)
        {
            var sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < timeoutMs)
            {
                if (_exiting || _nodeProc == null || _nodeProc.HasExited) return false;
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create(healthUrl);
                    req.Timeout = 1200;
                    req.Method = "GET";
                    req.Proxy = null;
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

        private static void SetupTrayIcon(Icon brandIcon)
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("打开 TradeLoom 独立窗口", null, (s, e) => OpenAppWindow(_url));
            menu.Items.Add("打开实盘账本 (/ledger)", null, (s, e) => OpenAppWindow(_url + "/ledger"));
            menu.Items.Add("在默认浏览器中打开", null, (s, e) => OpenDefaultBrowser(_url));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("显示控制面板", null, (s, e) => ShowControlPanel());
            menu.Items.Add("打开本地工作区 (Obsidian Vault)", null, (s, e) => OpenFolder(_workspaceDir));
            menu.Items.Add("查看本地运行日志", null, (s, e) => OpenFile(_logPath));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出并停止本地服务", null, (s, e) => ExitAll());

            _trayIcon = new NotifyIcon
            {
                Icon = brandIcon,
                Text = "TradeLoom · 织脉 (" + _url + ")",
                ContextMenuStrip = menu,
                Visible = true,
            };
            _trayIcon.DoubleClick += (s, e) => OpenAppWindow(_url);
        }

        public static void ShowControlPanel()
        {
            if (_form == null || _form.IsDisposed) return;
            _form.Show();
            _form.WindowState = FormWindowState.Normal;
            _form.Activate();
        }

        public static void OpenAppWindow(string targetUrl)
        {
            string browser = FindPreferredChromiumBrowser();
            if (!string.IsNullOrEmpty(browser))
            {
                try
                {
                    // Clean unquoted --app= URL without creating bloated profile folders inside workspace.
                    // Uses ShellExecute so Windows spawns cleanly via the desktop shell!
                    var psi = new ProcessStartInfo
                    {
                        FileName = browser,
                        Arguments = "--app=" + targetUrl + " --window-size=1440,920 --new-window",
                        UseShellExecute = true,
                    };
                    Process.Start(psi);
                    return;
                }
                catch { }
            }
            OpenDefaultBrowser(targetUrl);
        }

        public static void OpenDefaultBrowser(string targetUrl)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = targetUrl,
                    UseShellExecute = true,
                });
                return;
            }
            catch { }

            // Fallback via direct Chromium executable if Shell URL association is restricted
            string browser = FindPreferredChromiumBrowser();
            if (!string.IsNullOrEmpty(browser))
            {
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = browser,
                        Arguments = targetUrl,
                        UseShellExecute = true,
                    });
                }
                catch { }
            }
        }

        public static void OpenFolder(string dir)
        {
            try
            {
                Directory.CreateDirectory(dir);
                // Opening the directory path directly via ShellExecute delegates to the existing desktop
                // Explorer shell via IPC instead of spawning a new explorer.exe child process (avoids 0xc0000142).
                Process.Start(new ProcessStartInfo
                {
                    FileName = dir,
                    UseShellExecute = true,
                    Verb = "open",
                });
            }
            catch (Exception ex)
            {
                MessageBox.Show("无法直接打开文件夹：" + ex.Message + "\n请手动打开：\n" + dir, "TradeLoom", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        public static void OpenFile(string file)
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

        public static void ExitAll()
        {
            Shutdown();
            Application.Exit();
        }

        private static string FindPreferredChromiumBrowser()
        {
            string chrome1 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google\\Chrome\\Application\\chrome.exe");
            string chrome2 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google\\Chrome\\Application\\chrome.exe");
            string chrome3 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google\\Chrome\\Application\\chrome.exe");
            string edge1 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft\\Edge\\Application\\msedge.exe");
            string edge2 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft\\Edge\\Application\\msedge.exe");

            bool preferChrome = false;
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice"))
                {
                    string progId = key != null ? Convert.ToString(key.GetValue("ProgId")) : "";
                    if (!string.IsNullOrEmpty(progId) && progId.IndexOf("Chrome", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        preferChrome = true;
                    }
                }
            }
            catch { }

            string[] candidates = preferChrome
                ? new[] { chrome1, chrome2, chrome3, edge1, edge2 }
                : new[] { edge1, edge2, chrome1, chrome2, chrome3 };

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

        public static bool IsExiting { get { return _exiting; } }
    }

    sealed class ControlForm : Form
    {
        private readonly Label _statusLabel;
        private readonly Label _urlLabel;
        private readonly ProgressBar _progress;
        private readonly Button _btnOpenApp;
        private readonly Button _btnOpenBrowser;
        private readonly Button _btnOpenWorkspace;
        private readonly Button _btnExit;
        private readonly LinkLabel _copyLink;
        private string _activeUrl;

        public ControlForm(Icon icon, string url, string workspaceDir, string logPath)
        {
            _activeUrl = url;
            Text = "TradeLoom · 织脉";
            Icon = icon;
            Width = 468;
            Height = 258;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(12, 15, 23);
            ForeColor = Color.FromArgb(228, 233, 247);
            Font = new Font("Microsoft YaHei UI", 9.5f);

            var title = new Label
            {
                Text = "TradeLoom · 织脉  本地投研复盘工作台",
                Left = 22,
                Top = 18,
                Width = 315,
                Height = 26,
                Font = new Font("Microsoft YaHei UI", 12f, FontStyle.Bold),
                ForeColor = Color.FromArgb(241, 242, 245),
            };

            _statusLabel = new Label
            {
                Text = "正在启动本地引擎与 A 股行情服务，请稍候 2~5 秒...",
                Left = 22,
                Top = 50,
                Width = 415,
                Height = 22,
                ForeColor = Color.FromArgb(179, 136, 255),
            };

            _urlLabel = new Label
            {
                Text = "本地地址：" + url,
                Left = 22,
                Top = 74,
                Width = 285,
                Height = 20,
                Font = new Font("Microsoft YaHei UI", 8.5f),
                ForeColor = Color.FromArgb(143, 155, 184),
            };

            _copyLink = new LinkLabel
            {
                Text = "复制访问地址",
                Left = 340,
                Top = 74,
                Width = 92,
                LinkColor = Color.FromArgb(34, 211, 238),
                ActiveLinkColor = Color.White,
                Font = new Font("Microsoft YaHei UI", 8.5f),
            };
            _copyLink.Click += (s, e) =>
            {
                try
                {
                    Clipboard.SetText(_activeUrl);
                    _copyLink.Text = "已复制地址 ✓";
                }
                catch { }
            };

            _progress = new ProgressBar
            {
                Left = 22,
                Top = 102,
                Width = 408,
                Height = 10,
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 28,
            };

            _btnOpenApp = MakeButton("打开独立应用窗口", 22, 128, 198, Color.FromArgb(124, 77, 255), Color.White);
            _btnOpenApp.Enabled = false;
            _btnOpenApp.Click += (s, e) => Program.OpenAppWindow(_activeUrl);

            _btnOpenBrowser = MakeButton("在默认浏览器打开", 232, 128, 198, Color.FromArgb(24, 32, 52), Color.FromArgb(228, 233, 247));
            _btnOpenBrowser.Enabled = false;
            _btnOpenBrowser.Click += (s, e) => Program.OpenDefaultBrowser(_activeUrl);

            _btnOpenWorkspace = MakeButton("打开本地工作区 (Obsidian)", 22, 172, 198, Color.FromArgb(24, 32, 52), Color.FromArgb(34, 211, 238));
            _btnOpenWorkspace.Click += (s, e) => Program.OpenFolder(workspaceDir);

            _btnExit = MakeButton("停止本地服务并退出", 232, 172, 198, Color.FromArgb(48, 20, 32), Color.FromArgb(251, 113, 133));
            _btnExit.Click += (s, e) => Program.ExitAll();

            var logLink = new LinkLabel
            {
                Text = "查看启动日志",
                Left = 344,
                Top = 21,
                Width = 88,
                LinkColor = Color.FromArgb(143, 155, 184),
                ActiveLinkColor = Color.FromArgb(34, 211, 238),
                Font = new Font("Microsoft YaHei UI", 8.5f),
            };
            logLink.Click += (s, e) => Program.OpenFile(logPath);

            Controls.AddRange(new Control[] { title, logLink, _statusLabel, _urlLabel, _copyLink, _progress, _btnOpenApp, _btnOpenBrowser, _btnOpenWorkspace, _btnExit });

            FormClosing += (s, e) =>
            {
                if (!Program.IsExiting && e.CloseReason == CloseReason.UserClosing)
                {
                    e.Cancel = true;
                    WindowState = FormWindowState.Minimized;
                }
            };
        }

        private static Button MakeButton(string text, int left, int top, int width, Color bg, Color fg)
        {
            var b = new Button
            {
                Text = text,
                Left = left,
                Top = top,
                Width = width,
                Height = 33,
                FlatStyle = FlatStyle.Flat,
                BackColor = bg,
                ForeColor = fg,
                Cursor = Cursors.Hand,
            };
            b.FlatAppearance.BorderColor = Color.FromArgb(72, 86, 128);
            b.FlatAppearance.BorderSize = 1;
            return b;
        }

        public void SetReady(string url)
        {
            _activeUrl = url;
            _progress.Style = ProgressBarStyle.Blocks;
            _progress.Value = 100;
            _statusLabel.ForeColor = Color.FromArgb(52, 211, 153);
            _statusLabel.Text = "● 本地服务运行中（最小化本窗口即可常驻后台）";
            _urlLabel.Text = "本地地址：" + url;
            _btnOpenApp.Enabled = true;
            _btnOpenBrowser.Enabled = true;
        }

        public void SetFailed(string msg)
        {
            _progress.Style = ProgressBarStyle.Blocks;
            _progress.Value = 0;
            _statusLabel.ForeColor = Color.FromArgb(251, 113, 133);
            _statusLabel.Text = "✕ " + msg;
        }
    }
}