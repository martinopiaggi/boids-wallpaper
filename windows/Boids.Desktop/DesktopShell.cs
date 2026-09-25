using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Boids.Desktop;

internal static class DesktopShell
{
    private const int StyleIndex = -16;
    private const long ChildStyle = 0x40000000;
    private const long PopupStyle = 0x80000000;
    private static readonly nint Bottom = new(1);
    internal delegate bool WindowCallback(nint window, nint parameter);

    [StructLayout(LayoutKind.Sequential)]
    internal struct NativePoint { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    internal struct NativeRect { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern nint FindWindow(string className, string? name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern nint FindWindowEx(nint parent, nint after, string className, string? name);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(WindowCallback callback, nint parameter);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern nint SendMessageTimeout(nint window, uint message, nuint wParam, nint lParam, uint flags, uint timeout, out nuint result);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern nint SetParent(nint child, nint parent);
    [DllImport("user32.dll")]
    internal static extern nint GetParent(nint window);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    private static extern nint GetWindowLongPtr(nint window, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern nint SetWindowLongPtr(nint window, int index, nint value);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(nint window, nint after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")]
    private static extern int MapWindowPoints(nint from, nint to, ref NativePoint point, uint count);
    [DllImport("user32.dll")]
    internal static extern bool IsWindow(nint window);
    [DllImport("user32.dll")]
    internal static extern bool GetCursorPos(out NativePoint point);
    [DllImport("user32.dll")]
    internal static extern nint GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(nint window, out NativeRect rectangle);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(nint window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(nint window, StringBuilder value, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern uint RegisterWindowMessage(string name);
    [DllImport("wtsapi32.dll", SetLastError = true)]
    internal static extern bool WTSRegisterSessionNotification(nint window, int flags);
    [DllImport("wtsapi32.dll")]
    internal static extern bool WTSUnRegisterSessionNotification(nint window);

    public static string ClassName(nint window)
    {
        var text = new StringBuilder(128);
        GetClassName(window, text, text.Capacity);
        return text.ToString();
    }

    public static bool IsDesktopForeground(nint foreground) => foreground == 0 ||
        ClassName(foreground) is "Progman" or "WorkerW" or "SHELLDLL_DefView";

    public static bool IsFullscreen(nint foreground, Rectangle screen)
    {
        if (foreground == 0 || IsDesktopForeground(foreground) || IsIconic(foreground)) return false;
        return GetWindowRect(foreground, out var rect) &&
            rect.Left <= screen.Left && rect.Top <= screen.Top &&
            rect.Right >= screen.Right && rect.Bottom >= screen.Bottom;
    }

    public static nint FindWallpaperParent()
    {
        nint programManager = FindWindow("Progman", null);
        if (programManager == 0) throw new InvalidOperationException("Windows Explorer's desktop is not available. Start Explorer and try again.");

        // Explorer's wallpaper layer is undocumented; keep the request bounded and verify the resulting window.
        SendMessageTimeout(programManager, 0x052C, 0xD, 0, 2, 1000, out _);
        SendMessageTimeout(programManager, 0x052C, 0xD, 1, 2, 1000, out _);
        nint result = 0;
        nint iconParent = 0;
        EnumWindows((window, _) =>
        {
            if (FindWindowEx(window, 0, "SHELLDLL_DefView", null) == 0) return true;
            iconParent = window;
            nint nestedWorker = FindWindowEx(window, 0, "WorkerW", null);
            if (nestedWorker != 0) result = nestedWorker;
            else result = FindWindowEx(0, window, "WorkerW", null);
            return result == 0;
        }, 0);
        if (result != 0 && IsWindow(result)) return result;
        if (iconParent != 0 && IsWindow(iconParent)) return iconParent;
        throw new InvalidOperationException("This Windows shell does not expose a desktop wallpaper layer. Nothing was replaced; use --preview instead.");
    }

    public static void Attach(nint window, nint parent, Rectangle bounds)
    {
        long style = GetWindowLongPtr(window, StyleIndex).ToInt64();
        Marshal.SetLastPInvokeError(0);
        SetWindowLongPtr(window, StyleIndex, new nint((style & ~PopupStyle) | ChildStyle));
        if (Marshal.GetLastPInvokeError() != 0) throw new Win32Exception(Marshal.GetLastPInvokeError());
        Marshal.SetLastPInvokeError(0);
        nint previous = SetParent(window, parent);
        int error = Marshal.GetLastPInvokeError();
        if (previous == 0 && error != 0) throw new Win32Exception(error, "Could not attach the wallpaper window");
        if (GetParent(window) != parent) throw new InvalidOperationException("Desktop attachment could not be verified.");
        var origin = new NativePoint { X = bounds.Left, Y = bounds.Top };
        MapWindowPoints(0, parent, ref origin, 1);
        if (!SetWindowPos(window, Bottom, origin.X, origin.Y, bounds.Width, bounds.Height, 0x0010 | 0x0020 | 0x0040))
            throw new Win32Exception(Marshal.GetLastPInvokeError(), "Could not place the wallpaper behind the icons");
    }
}

internal sealed class ShellMessages : NativeWindow, IDisposable
{
    private readonly uint taskbarCreated = DesktopShell.RegisterWindowMessage("TaskbarCreated");
    public event Action? ExplorerRestarted;
    public event Action<bool>? SessionLocked;

    public ShellMessages()
    {
        CreateHandle(new CreateParams { Caption = "BoidsWallpaper shell notifications", ExStyle = 0x80 });
        if (!DesktopShell.WTSRegisterSessionNotification(Handle, 0))
            AppFiles.Log("Session lock notifications unavailable; fullscreen/battery rules remain active.");
    }

    protected override void WndProc(ref Message message)
    {
        if ((uint)message.Msg == taskbarCreated) ExplorerRestarted?.Invoke();
        if (message.Msg == 0x02B1)
        {
            if (message.WParam == 7) SessionLocked?.Invoke(true);
            if (message.WParam == 8) SessionLocked?.Invoke(false);
        }
        base.WndProc(ref message);
    }

    public void Dispose()
    {
        DesktopShell.WTSUnRegisterSessionNotification(Handle);
        DestroyHandle();
    }
}
