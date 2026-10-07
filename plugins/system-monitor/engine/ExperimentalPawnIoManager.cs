using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Win32;

internal sealed class ExperimentalPawnIoManager
{
    private const string ExperimentalHash = "E19F274B9F3C917445BFF19A80BBE2EE34A54995E62BE50073122B20D86AF900";
    private const string ServiceKey = @"SYSTEM\CurrentControlSet\Services\PawnIO";
    private readonly string _driverPath = Path.Combine(AppContext.BaseDirectory, "Resources", "PawnIO-unrestricted.sys");
    private readonly string _statePath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "runtime", "driver-state.json"));

    public bool Configured { get; private set; }
    public bool Active { get; private set; }
    public bool RebootRequired { get; private set; }
    public string Message { get; private set; } = "";

    public void EnsureConfigured(bool required)
    {
        if (!required) return;
        try
        {
            if (!File.Exists(_driverPath) || !string.Equals(FileHash(_driverPath), ExperimentalHash, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("实验 PawnIO 驱动文件缺失或校验失败。");

            using RegistryKey key = Registry.LocalMachine.OpenSubKey(ServiceKey, writable: true)
                ?? throw new InvalidOperationException("未找到 PawnIO 驱动服务。");
            string currentPath = key.GetValue("ImagePath")?.ToString() ?? "";
            string desiredPath = @"\??\" + _driverPath;
            bool changed = !PathMatches(currentPath, _driverPath);
            if (changed)
            {
                if (!File.Exists(_statePath))
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(_statePath)!);
                    File.WriteAllText(_statePath, JsonSerializer.Serialize(new DriverState(currentPath)));
                }
                key.SetValue("ImagePath", desiredPath, RegistryValueKind.ExpandString);
            }
            Configured = true;
            RebootRequired = changed;
            Active = false;
            Message = changed ? "RTX 50 热点直读驱动已配置，需要重启 Windows 一次" : "RTX 50 热点直读驱动正在检测";
        }
        catch (Exception error)
        {
            Message = error.Message;
        }
    }

    public void MarkActive(bool active)
    {
        Active = active;
        if (Configured)
            Message = active ? "RTX 50 热点直读驱动已启用" : RebootRequired ? "RTX 50 热点直读驱动已配置，需要重启 Windows 一次" : "RTX 50 热点直读模块未加载";
    }

    public object Restore()
    {
        if (!File.Exists(_statePath)) return new { restored = false, message = "没有需要恢复的驱动配置。" };
        DriverState? state = JsonSerializer.Deserialize<DriverState>(File.ReadAllText(_statePath));
        if (state is null || string.IsNullOrWhiteSpace(state.OriginalImagePath))
            return new { restored = false, message = "驱动备份配置无效。" };
        using RegistryKey key = Registry.LocalMachine.OpenSubKey(ServiceKey, writable: true)
            ?? throw new InvalidOperationException("未找到 PawnIO 驱动服务。");
        key.SetValue("ImagePath", state.OriginalImagePath, RegistryValueKind.ExpandString);
        File.Delete(_statePath);
        return new { restored = true, rebootRequired = true, message = "标准 PawnIO 驱动已恢复，重启 Windows 后生效。" };
    }

    private static bool PathMatches(string configuredPath, string expectedPath)
    {
        string normalized = configuredPath.Trim().Trim('"').Replace(@"\??\", "", StringComparison.OrdinalIgnoreCase);
        return string.Equals(Path.GetFullPath(normalized), Path.GetFullPath(expectedPath), StringComparison.OrdinalIgnoreCase);
    }

    private static string FileHash(string path)
    {
        using FileStream stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream));
    }

    private sealed record DriverState(string OriginalImagePath);
}
