using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Boids.Desktop;

internal sealed class DesktopApp : ApplicationContext
{
    private readonly Options options;
    private readonly EventWaitHandle exit;
    private readonly NotifyIcon tray;
    private readonly Icon icon;
    private readonly ShellMessages shell = new();
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 33 };
    private readonly List<WallpaperWindow> windows = [];
    private readonly Stopwatch age = Stopwatch.StartNew();
    private Settings settings;
    private CoreWebView2Environment? environment;
    private nint parent;
    private string topology = "";
    private bool paused, locked, busy, exiting, rebuilding, captureStarted;
    private string pauseSignature = "";
    private int recoveries;
    private long nextCheck, readyAt;

    public DesktopApp(Options options, EventWaitHandle exit)
    {
        this.options = options;
        this.exit = exit;
        settings = Settings.Load();
        icon = CreateIcon();
        var menu = new ContextMenuStrip();
        var pause = new ToolStripMenuItem("Pause") { CheckOnClick = true };
        pause.CheckedChanged += (_, _) => paused = pause.Checked;
        menu.Items.Add(pause);
        menu.Items.Add("Settings…", null, (_, _) => EditSettings());
        menu.Items.Add("Reattach to desktop", null, (_, _) => { recoveries = 0; topology = ""; });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitThread());
        tray = new NotifyIcon { Icon = icon, Text = "Boids Wallpaper", ContextMenuStrip = menu, Visible = options.SmokeDirectory is null };
        tray.DoubleClick += (_, _) => EditSettings();
        shell.ExplorerRestarted += () => { recoveries = 0; topology = ""; };
        shell.SessionLocked += value => locked = value;
        timer.Tick += Tick;
        timer.Start();
        AppFiles.Log($"Starting {(options.Preview ? "preview" : "desktop")} from {AppContext.BaseDirectory}");
    }

    private async void Tick(object? sender, EventArgs args)
    {
        if (exiting) return;
        if (exit.WaitOne(0)) { ExitThread(); return; }
        if (busy) return;
        try
        {
            if (environment is null)
            {
                busy = true;
                string profile = options.SmokeDirectory is null
                    ? Path.Combine(AppFiles.Root, "BrowserData")
                    : Path.Combine(options.SmokeDirectory, "BrowserData");
                CoreWebView2Environment.GetAvailableBrowserVersionString();
                environment = await CoreWebView2Environment.CreateAsync(null, profile);
                if (exiting) return;
                AppFiles.Log($"WebView2 {environment.BrowserVersionString}");
                await RebuildAsync();
                busy = false;
            }
            if (age.ElapsedMilliseconds >= nextCheck)
            {
                nextCheck = age.ElapsedMilliseconds + 1000;
                string currentTopology = GetTopology();
                if (currentTopology != topology || (!options.Preview && !DesktopShell.IsWindow(parent)))
                {
                    if (recoveries >= 10) throw new InvalidOperationException("Explorer's wallpaper layer remained unavailable after ten attempts.");
                    busy = true;
                    try
                    {
                        await RebuildAsync();
                        recoveries = 0;
                    }
                    catch (Exception error) when (recoveries++ < 9)
                    {
                        AppFiles.Log($"Desktop recovery {recoveries}/10: {error.Message}");
                        nextCheck = age.ElapsedMilliseconds + 2000;
                    }
                    finally { busy = false; }
                }
                foreach (var window in windows) window.RequestStatus();
            }
            PumpInput();
            if (options.SmokeDirectory is not null)
            {
                if (age.Elapsed > TimeSpan.FromSeconds(35) && readyAt == 0)
                    throw new TimeoutException("The renderer did not become ready within 35 seconds.");
                if (windows.Count > 0 && windows.All(w => w.Ready) && readyAt == 0) readyAt = age.ElapsedMilliseconds;
                if (readyAt != 0 && age.ElapsedMilliseconds - readyAt >= 6000 && !captureStarted)
                {
                    captureStarted = true;
                    await WriteSmokeResultAsync();
                    ExitThread();
                }
            }
        }
        catch (Exception error) { Fail(error); }
    }

    private async Task RebuildAsync()
    {
        if (environment is null || exiting) return;
        rebuilding = true;
        try
        {
            foreach (var window in windows) window.Dispose();
            windows.Clear();
            parent = options.Preview ? 0 : DesktopShell.FindWallpaperParent();
            var screens = options.Preview
                ? new[] { Screen.PrimaryScreen ?? Screen.AllScreens[0] }
                : Screen.AllScreens;
            foreach (var screen in screens)
            {
                var window = new WallpaperWindow(screen.Bounds, options.Preview);
                windows.Add(window);
                window.Started += started => started.Configure(settings, paused || locked);
                window.Failed += error => Fail(new InvalidOperationException(error));
                window.FormClosed += (_, _) =>
                {
                    if (!exiting && !rebuilding)
                    {
                        if (options.Preview) ExitThread();
                        else topology = "";
                    }
                };
                if (!options.Preview) DesktopShell.Attach(window.Handle, parent, screen.Bounds);
                window.Show();
                await window.InitializeAsync(environment);
                if (exiting) return;
            }
            topology = GetTopology();
            AppFiles.Log($"Attached {windows.Count} view(s), parent=0x{parent:X}, topology={topology}");
        }
        finally { rebuilding = false; }
    }

    private string GetTopology() => string.Join(";", Screen.AllScreens.Select(s => $"{s.DeviceName}:{s.Bounds}"));

    private void PumpInput()
    {
        bool applyPowerRules = options.SmokeDirectory is null;
        bool battery = applyPowerRules && settings.PauseBattery && SystemInformation.PowerStatus.PowerLineStatus == PowerLineStatus.Offline;
        nint foreground = DesktopShell.GetForegroundWindow();
        bool desktopActive = DesktopShell.IsDesktopForeground(foreground);
        bool gotPointer = DesktopShell.GetCursorPos(out var point);
        // The desktop and our own wallpaper window both span the display; neither is a fullscreen app.
        bool fullscreenCandidate = applyPowerRules && !options.Preview && settings.PauseFullscreen && !desktopActive &&
            !windows.Any(window => !window.IsDisposed && window.Handle == foreground);
        foreach (var window in windows.ToArray())
        {
            if (window.IsDisposed) continue;
            Rectangle bounds = options.Preview ? window.RectangleToScreen(window.ClientRectangle) : window.DisplayBounds;
            bool fullscreen = fullscreenCandidate && DesktopShell.IsFullscreen(foreground, bounds);
            bool pause = paused || locked || battery || fullscreen;
            string reason = paused ? "tray" : locked ? "locked" : battery ? "battery" : fullscreen ? "fullscreen" : "running";
            if (!string.Equals(reason, pauseSignature, StringComparison.Ordinal))
            {
                pauseSignature = reason;
                AppFiles.Log($"Playback {reason}; foreground={DesktopShell.ClassName(foreground)}");
            }
            bool active = gotPointer && bounds.Contains(point.X, point.Y) && (desktopActive || options.Preview) && !pause;
            double x = Math.Clamp((point.X - bounds.Left) / (double)Math.Max(1, bounds.Width), 0, 1);
            double y = Math.Clamp((point.Y - bounds.Top) / (double)Math.Max(1, bounds.Height), 0, 1);
            window.UpdateInput(x, y, active, pause);
        }
    }

    private void EditSettings()
    {
        using var dialog = new SettingsDialog(settings);
        if (dialog.ShowDialog() != DialogResult.OK) return;
        try
        {
            settings = dialog.Value.Validated();
            settings.Save();
            foreach (var window in windows) window.Configure(settings, paused || locked);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            AppFiles.Log(error.ToString());
            MessageBox.Show(error.Message, "Settings could not be saved", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private async Task WriteSmokeResultAsync()
    {
        string directory = options.SmokeDirectory!;
        Directory.CreateDirectory(directory);
        var results = new List<object>();
        for (int i = 0; i < windows.Count; i++)
        {
            var window = windows[i];
            await window.CaptureAsync(Path.Combine(directory, $"monitor-{i + 1}.png"));
            var status = window.Status ?? throw new InvalidOperationException("No renderer status received");
            bool attached = options.Preview || DesktopShell.GetParent(window.Handle) == parent;
            if (!attached || !status.TryGetProperty("frames", out var frames) || frames.GetInt64() < 120)
                throw new InvalidOperationException("Desktop attachment or at least two seconds of animation evidence is missing");
            results.Add(new { attached, screen = window.DisplayBounds.ToString(), status });
        }
        File.WriteAllText(Path.Combine(directory, "result.json"), JsonSerializer.Serialize(new
        {
            success = true,
            mode = options.Preview ? "preview" : "desktop",
            browserVersion = environment?.BrowserVersionString,
            pauseRules = new { fullscreen = settings.PauseFullscreen, battery = settings.PauseBattery },
            monitors = results
        }, AppFiles.Json));
    }

    private void Fail(Exception error)
    {
        if (exiting) return;
        Environment.ExitCode = 1;
        AppFiles.Log(error.ToString());
        if (options.SmokeDirectory is not null)
        {
            Directory.CreateDirectory(options.SmokeDirectory);
            File.WriteAllText(Path.Combine(options.SmokeDirectory, "result.json"), JsonSerializer.Serialize(new { success = false, error = error.ToString() }, AppFiles.Json));
        }
        else MessageBox.Show(error.Message + "\n\nNo wallpaper settings were changed. See %LOCALAPPDATA%\\BoidsWallpaper\\host.log.",
            "Boids stopped", MessageBoxButtons.OK, MessageBoxIcon.Error);
        ExitThread();
    }

    protected override void ExitThreadCore()
    {
        if (exiting) return;
        exiting = true;
        timer.Stop();
        tray.Visible = false;
        foreach (var window in windows.ToArray()) window.Dispose();
        windows.Clear();
        base.ExitThreadCore();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            timer.Dispose();
            tray.Dispose();
            icon.Dispose();
            shell.Dispose();
            foreach (var window in windows) window.Dispose();
        }
        base.Dispose(disposing);
    }

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(nint icon);
    private static Icon CreateIcon()
    {
        using var bitmap = new Bitmap(32, 32);
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.Clear(Color.Black);
            graphics.FillPolygon(Brushes.White, new Point[] { new(27, 5), new(6, 12), new(19, 27) });
        }
        nint handle = bitmap.GetHicon();
        try { return (Icon)Icon.FromHandle(handle).Clone(); }
        finally { DestroyIcon(handle); }
    }
}

internal sealed class SettingsDialog : Form
{
    private readonly NumericUpDown count = new() { Minimum = 20, Maximum = 4096, Increment = 256, Dock = DockStyle.Fill };
    private readonly NumericUpDown speed = new() { Minimum = 0.25m, Maximum = 9, Increment = 0.25m, DecimalPlaces = 2, Dock = DockStyle.Fill };
    private readonly ComboBox fps = new() { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
    private readonly ComboBox mode = new() { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
    private readonly CheckBox fullscreen = new() { Text = "Pause under fullscreen apps", AutoSize = true };
    private readonly CheckBox battery = new() { Text = "Pause on battery", AutoSize = true };

    public SettingsDialog(Settings settings)
    {
        Text = "Boids settings";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MinimizeBox = MaximizeBox = false;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Padding = new Padding(18);
        fps.Items.AddRange([30, 60, 120]);
        mode.Items.AddRange(["orbit", "follow", "avoid", "ignore"]);
        count.Value = settings.Count;
        speed.Value = (decimal)settings.Speed;
        fps.SelectedItem = settings.Fps;
        mode.SelectedItem = settings.Interaction;
        fullscreen.Checked = settings.PauseFullscreen;
        battery.Checked = settings.PauseBattery;
        var table = new TableLayoutPanel { ColumnCount = 2, AutoSize = true, Dock = DockStyle.Fill };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 110));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 200));
        void Row(string label, Control control)
        {
            int row = table.RowCount++;
            table.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(3, 7, 3, 7) }, 0, row);
            table.Controls.Add(control, 1, row);
        }
        Row("Boids", count);
        Row("Speed", speed);
        Row("FPS target", fps);
        Row("Mouse", mode);
        Row("Power", fullscreen);
        Row("", battery);
        var buttons = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft };
        var save = new Button { Text = "Save", DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel };
        buttons.Controls.Add(save);
        buttons.Controls.Add(cancel);
        Row("", buttons);
        AcceptButton = save;
        CancelButton = cancel;
        Controls.Add(table);
    }

    public Settings Value => new()
    {
        Count = (int)count.Value,
        Speed = (double)speed.Value,
        Fps = (int)(fps.SelectedItem ?? 120),
        Interaction = mode.SelectedItem?.ToString() ?? "orbit",
        PauseFullscreen = fullscreen.Checked,
        PauseBattery = battery.Checked
    };
}
