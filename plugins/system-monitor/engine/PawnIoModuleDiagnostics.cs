using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

internal static class PawnIoModuleDiagnostics
{
    private const uint DeviceType = 41394u << 16;
    private const uint LoadBinaryIoctl = DeviceType | (0x821u << 2);

    public static object Read()
    {
        using SafeFileHandle handle = CreateFile(
            @"\\?\GLOBALROOT\Device\PawnIO",
            FileAccess.ReadWrite,
            FileShare.Read | FileShare.Write,
            IntPtr.Zero,
            FileMode.Open,
            0,
            IntPtr.Zero);
        if (handle.IsInvalid)
            return new { opened = false, openError = Marshal.GetLastWin32Error(), loaded = false, loadError = 0 };

        using Stream? stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("SystemMonitorEngine.Resources.Nvidia.bin");
        if (stream is null) return new { opened = true, openError = 0, loaded = false, loadError = -1 };
        using MemoryStream memory = new();
        stream.CopyTo(memory);
        byte[] module = memory.ToArray();
        IntPtr input = Marshal.AllocHGlobal(module.Length);
        try
        {
            Marshal.Copy(module, 0, input, module.Length);
            bool loaded = DeviceIoControl(handle, LoadBinaryIoctl, input, (uint)module.Length, IntPtr.Zero, 0, out _, IntPtr.Zero);
            return new { opened = true, openError = 0, loaded, loadError = loaded ? 0 : Marshal.GetLastWin32Error() };
        }
        finally { Marshal.FreeHGlobal(input); }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string fileName, FileAccess desiredAccess, FileShare shareMode,
        IntPtr securityAttributes, FileMode creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DeviceIoControl(SafeFileHandle device, uint controlCode, IntPtr input, uint inputSize,
        IntPtr output, uint outputSize, out uint returned, IntPtr overlapped);
}
