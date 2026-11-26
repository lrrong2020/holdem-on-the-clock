using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Threading;
using System.Windows.Forms;

internal sealed class TableWindow : Form
{
    private const string Product = "Hold’em on the Clock";
    private readonly bool chinese = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "zh";
    private readonly bool openBrowser;
    private readonly Label status = new Label();
    private readonly Button open = new Button();
    private readonly System.Windows.Forms.Timer checkOpen = new System.Windows.Forms.Timer();
    private Process service;
    private string address;
    private bool closing;

    private string T(string en, string zh) { return chinese ? zh : en; }

    internal TableWindow(EventWaitHandle reopen, bool openBrowser)
    {
        this.openBrowser = openBrowser;
        Text = Product;
        Font = SystemFonts.MessageBoxFont;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(355, 113);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        status.Text = T("Starting the table…", "正在开桌…");
        status.AutoSize = false;
        status.SetBounds(16, 14, 323, 43);
        open.Text = T("Open table", "打开牌桌");
        open.SetBounds(16, 66, 145, 30);
        open.Enabled = false;
        open.Click += delegate { Browse(); };
        Button quit = new Button();
        quit.Text = T("Quit", "退出");
        quit.SetBounds(252, 66, 86, 30);
        quit.Click += delegate { Close(); };
        Controls.AddRange(new Control[] {status, open, quit});
        AcceptButton = open;
        Shown += delegate { StartTable(); };
        checkOpen.Interval = 250;
        checkOpen.Tick += delegate {
            if (reopen.WaitOne(0)) {
                WindowState = FormWindowState.Normal;
                Activate();
                if (address != null) Browse();
            }
        };
        checkOpen.Start();
    }

    private void Browse()
    {
        try { Process.Start(new ProcessStartInfo(address) {UseShellExecute = true}); }
        catch (Exception) {
            status.Text = T("Open this address in your browser: ", "请在浏览器打开 ") + address;
        }
    }

    private void StartTable()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        try {
            ProcessStartInfo start = new ProcessStartInfo(Path.Combine(root, "node.exe"), "app/desktop.mjs");
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WorkingDirectory = root;
            start.RedirectStandardInput = true;
            start.RedirectStandardOutput = true;
            service = new Process();
            service.StartInfo = start;
            service.SynchronizingObject = this;
            service.EnableRaisingEvents = true;
            service.Exited += delegate {
                if (closing) return;
                address = null;
                open.Enabled = false;
                status.Text = T("The table stopped. Quit and open the app again.", "牌桌已关闭。请退出应用后重新打开。");
            };
            service.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                const string signal = "DESKTOP_READY ";
                if (closing || e.Data == null || !e.Data.StartsWith(signal, StringComparison.Ordinal)) return;
                Uri url;
                if (!Uri.TryCreate(e.Data.Substring(signal.Length), UriKind.Absolute, out url) ||
                    url.Scheme != "http" || url.Host != "127.0.0.1" || !String.IsNullOrEmpty(url.UserInfo)) return;
                address = url.AbsoluteUri;
                status.Text = T("Keep this window open while you play.", "玩牌时请保持此窗口打开。");
                open.Enabled = true;
                if (openBrowser) Browse();
                else Console.WriteLine(signal + address);
            };
            service.Start();
            service.BeginOutputReadLine();
        } catch (Exception) {
            status.Text = T("Could not start the table. Run the installer again.", "无法开桌。请重新运行安装程序。");
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        closing = true;
        checkOpen.Stop();
        if (service != null) {
            try {
                // EOF also reaches the server when Windows terminates the launcher.
                service.StandardInput.Close();
            } catch (InvalidOperationException) { }
            service.Dispose();
        }
        base.OnFormClosing(e);
    }

    [STAThread]
    private static void Main(string[] args)
    {
        bool created;
        bool browse = Array.IndexOf(args, "--no-browser") < 0;
        using (EventWaitHandle reopen = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\HoldemOnTheClock.Open"))
        using (Mutex instance = new Mutex(true, @"Local\HoldemOnTheClock.Desktop", out created)) {
            if (!created) {
                if (browse) reopen.Set();
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new TableWindow(reopen, browse));
        }
    }
}
