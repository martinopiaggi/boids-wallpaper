using System.Text.Json;

namespace Boids.Desktop;

internal sealed record Options(bool Preview, bool Quit, string? SmokeDirectory)
{
    public static Options Parse(string[] args)
    {
        bool preview = false, quit = false;
        string? smoke = null;
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--preview": preview = true; break;
                case "--exit": quit = true; break;
                case "--smoke-test" when i + 1 < args.Length:
                    smoke = Path.GetFullPath(args[++i]);
                    break;
                default: throw new ArgumentException($"Unknown or incomplete argument: {args[i]}");
            }
        }
        return new(preview, quit, smoke);
    }
}

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            var options = Options.Parse(args);
            string scope = options.Preview ? "Preview" : "Desktop";
            string eventName = $@"Local\BoidsWallpaper.{scope}.Exit";
            if (options.Quit)
            {
                if (EventWaitHandle.TryOpenExisting(eventName, out var existing))
                {
                    using (existing) existing.Set();
                }
                return;
            }
            using var mutex = new Mutex(true, $@"Local\BoidsWallpaper.{scope}.Instance", out bool owns);
            if (!owns)
            {
                MessageBox.Show("Boids is already running. Use its triangle icon in the system tray.", "Boids");
                return;
            }
            using var exit = new EventWaitHandle(false, EventResetMode.AutoReset, eventName);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += (_, e) =>
            {
                AppFiles.Log(e.Exception.ToString());
                MessageBox.Show(e.Exception.Message, "Boids stopped", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Application.Exit();
            };
            using var app = new DesktopApp(options, exit);
            Application.Run(app);
        }
        catch (Exception error)
        {
            AppFiles.Log(error.ToString());
            Environment.ExitCode = 1;
            MessageBox.Show(error.Message, "Boids could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}

internal static class AppFiles
{
    public static string Root => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BoidsWallpaper");
    public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };

    public static void Log(string text)
    {
        try
        {
            Directory.CreateDirectory(Root);
            string file = Path.Combine(Root, "host.log");
            if (File.Exists(file) && new FileInfo(file).Length > 2_000_000) File.Move(file, file + ".previous", true);
            File.AppendAllText(file, $"{DateTimeOffset.Now:O} {text}{Environment.NewLine}");
        }
        catch (IOException) { System.Diagnostics.Debug.WriteLine(text); }
        catch (UnauthorizedAccessException) { System.Diagnostics.Debug.WriteLine(text); }
    }
}

internal sealed record Settings
{
    public int Count { get; init; } = 512;
    public double Speed { get; init; } = 4;
    public int Fps { get; init; } = 120;
    public string Interaction { get; init; } = "orbit";
    public bool PauseFullscreen { get; init; } = true;
    public bool PauseBattery { get; init; } = true;

    public Settings Validated() => this with
    {
        Count = Math.Clamp(Count, 20, 1024),
        Speed = double.IsFinite(Speed) ? Math.Clamp(Speed, 0.25, 6) : 4,
        Fps = Fps is 30 or 60 or 120 ? Fps : 120,
        Interaction = Interaction is "orbit" or "follow" or "avoid" or "ignore" ? Interaction : "orbit"
    };

    public static Settings Load()
    {
        try
        {
            string file = Path.Combine(AppFiles.Root, "settings.json");
            return File.Exists(file) ? (JsonSerializer.Deserialize<Settings>(File.ReadAllText(file), AppFiles.Json) ?? new()).Validated() : new();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            AppFiles.Log($"Using default settings: {error.Message}");
            return new();
        }
    }

    public void Save()
    {
        Directory.CreateDirectory(AppFiles.Root);
        string file = Path.Combine(AppFiles.Root, "settings.json");
        File.WriteAllText(file + ".tmp", JsonSerializer.Serialize(Validated(), AppFiles.Json));
        File.Move(file + ".tmp", file, true);
    }
}
