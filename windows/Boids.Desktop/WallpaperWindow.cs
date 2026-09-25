using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Boids.Desktop;

internal sealed class WallpaperWindow : Form
{
    private readonly WebView2 browser = new();
    private readonly bool preview;
    private bool lastPaused;
    private (double X, double Y, bool Active)? lastPointer;
    public bool Ready { get; private set; }
    public JsonElement? Status { get; private set; }
    public Rectangle DisplayBounds { get; }
    public event Action<WallpaperWindow>? Started;
    public event Action<string>? Failed;

    public WallpaperWindow(Rectangle bounds, bool isPreview)
    {
        preview = isPreview;
        DisplayBounds = bounds;
        Text = "Boids Wallpaper";
        BackColor = Color.Black;
        ShowInTaskbar = preview;
        FormBorderStyle = preview ? FormBorderStyle.Sizable : FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Bounds = preview ? new Rectangle(bounds.Left + 80, bounds.Top + 80, 1100, 700) : bounds;
        browser.Dock = DockStyle.Fill;
        browser.DefaultBackgroundColor = Color.Black;
        browser.TabStop = false;
        browser.AllowExternalDrop = false;
        Controls.Add(browser);
    }

    protected override bool ShowWithoutActivation => !preview;
    protected override CreateParams CreateParams
    {
        get
        {
            var parameters = base.CreateParams;
            if (!preview) parameters.ExStyle |= 0x08000000 | 0x80;
            return parameters;
        }
    }

    public async Task InitializeAsync(CoreWebView2Environment environment)
    {
        await browser.EnsureCoreWebView2Async(environment);
        if (IsDisposed) return;
        var core = browser.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.AreDefaultScriptDialogsEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.SetVirtualHostNameToFolderMapping("boids.local", Path.Combine(AppContext.BaseDirectory, "wallpaper"), CoreWebView2HostResourceAccessKind.DenyCors);
        core.NavigationStarting += (_, e) =>
        {
            if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.Host != "boids.local") e.Cancel = true;
        };
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.DownloadStarting += (_, e) => e.Cancel = true;
        core.ProcessFailed += (_, e) => Failed?.Invoke($"Browser process failed: {e.ProcessFailedKind}");
        core.NavigationCompleted += (_, e) =>
        {
            if (!e.IsSuccess) Failed?.Invoke($"Wallpaper navigation failed: {e.WebErrorStatus}");
        };
        core.WebMessageReceived += OnMessage;
        core.Navigate("https://boids.local/index.html?desktop=1");
    }

    private void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!e.Source.StartsWith("https://boids.local/", StringComparison.Ordinal)) return;
        try
        {
            using var payload = JsonDocument.Parse(e.WebMessageAsJson);
            var message = payload.RootElement;
            if (!message.TryGetProperty("type", out var type)) return;
            switch (type.GetString())
            {
                case "ready":
                    Ready = true;
                    Status = message.Clone();
                    AppFiles.Log($"Renderer ready: {e.WebMessageAsJson}");
                    Started?.Invoke(this);
                    break;
                case "status":
                case "configured":
                    Status = message.Clone();
                    break;
                case "error":
                    Failed?.Invoke(message.TryGetProperty("error", out var detail) ? detail.GetString() ?? "Rendering error" : "Rendering error");
                    break;
            }
        }
        catch (JsonException error) { AppFiles.Log($"Ignored malformed browser message: {error.Message}"); }
    }

    public void Configure(Settings settings, bool paused)
    {
        lastPaused = paused;
        Post(new { type = "configure", count = settings.Count, speed = settings.Speed,
            fps = settings.Fps, interaction = settings.Interaction, paused });
    }

    public void UpdateInput(double x, double y, bool active, bool paused)
    {
        if (!Ready) return;
        if (paused != lastPaused)
        {
            lastPaused = paused;
            Post(new { type = "pause", paused });
        }
        var next = (x, y, active);
        if (lastPointer == next) return;
        lastPointer = next;
        Post(new { type = "pointer", x, y, active });
    }

    public void RequestStatus() => Post(new { type = "status" });

    private void Post(object payload)
    {
        if (!Ready || IsDisposed || browser.CoreWebView2 is null) return;
        browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(payload, AppFiles.Json));
    }

    public async Task CaptureAsync(string filename)
    {
        if (!Ready) throw new InvalidOperationException("The wallpaper renderer is not ready.");
        await using var stream = File.Create(filename);
        await browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
    }
}
