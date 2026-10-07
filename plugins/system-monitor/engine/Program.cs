using System.Globalization;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LibreHardwareMonitor.Hardware;
using System.Diagnostics;
using System.Security.Principal;
using System.Collections.Concurrent;
using PawnIoDriver = LibreHardwareMonitor.PawnIo.PawnIo;

if (args.Contains("--probe-nvidia", StringComparer.OrdinalIgnoreCase))
{
    Console.WriteLine(JsonSerializer.Serialize(NvidiaThermalProbe.Read()));
    return 0;
}

if (args.Contains("--list-resources", StringComparer.OrdinalIgnoreCase))
{
    Console.WriteLine(JsonSerializer.Serialize(Assembly.GetExecutingAssembly().GetManifestResourceNames()));
    return 0;
}

if (args.Contains("--pawnio-diagnostic", StringComparer.OrdinalIgnoreCase))
{
    Console.WriteLine(JsonSerializer.Serialize(PawnIoModuleDiagnostics.Read()));
    return 0;
}

if (args.Contains("--probe-direct-nvidia", StringComparer.OrdinalIgnoreCase))
{
    List<object> results = [];
    foreach (NvidiaThermalSnapshot gpu in NvidiaThermalProbe.Read())
    {
        using NvidiaDirectThermalReader reader = new(gpu.Bus, gpu.Device, gpu.Function);
        float? hotspot = null;
        float? hotspot2 = null;
        for (int attempt = 0; attempt < 8 && !reader.TryRead(out hotspot, out hotspot2); attempt++)
            Thread.Sleep(250);
        results.Add(new { gpu.GpuIndex, gpu.Name, gpu.Bus, gpu.Device, gpu.Function, reader.IsLoaded, hotspot, hotspot2 });
    }
    Console.WriteLine(JsonSerializer.Serialize(results));
    return 0;
}

if (args.Contains("--restore-driver", StringComparer.OrdinalIgnoreCase))
{
    try
    {
        Console.WriteLine(JsonSerializer.Serialize(new ExperimentalPawnIoManager().Restore()));
        return 0;
    }
    catch (Exception error)
    {
        Console.Error.WriteLine(error.Message);
        return 1;
    }
}

if (args.Contains("--configure-driver", StringComparer.OrdinalIgnoreCase))
{
    ExperimentalPawnIoManager manager = new();
    manager.EnsureConfigured(NvidiaThermalProbe.Read().Any(gpu => gpu.Name.Contains("RTX 50", StringComparison.OrdinalIgnoreCase)));
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        manager.Configured, manager.Active, manager.RebootRequired, manager.Message
    }));
    return manager.Configured ? 0 : 1;
}

int port = 0;
int parentPid = 0;
for (int index = 0; index < args.Length - 1; index++)
{
    if (args[index] == "--port") int.TryParse(args[index + 1], out port);
    if (args[index] == "--parent-pid") int.TryParse(args[index + 1], out parentPid);
}

if (port is < 1024 or > 65535)
{
    Console.Error.WriteLine("A valid --port is required.");
    return 2;
}

using HardwareService service = new(port);
if (parentPid > 0) service.WatchParent(parentPid);
await service.RunAsync();
return 0;

internal sealed class HardwareService : IDisposable
{
    private Computer? _coreComputer;
    private Computer? _extendedComputer;
    private Computer? _storageComputer;
    private SnapshotPoller<StorageSnapshot>? _storagePoller;
    private volatile string[] _storageHardwareIds = [];
    private readonly HttpListener _listener = new();
    private readonly SemaphoreSlim _hardwareLock = new(1, 1);
    private readonly CancellationTokenSource _shutdown = new();
    private readonly Dictionary<string, SyntheticSensorState> _syntheticSensors = [];
    private readonly Dictionary<int, NvidiaDirectThermalReader> _nvidiaDirectReaders = [];
    private readonly Dictionary<int, string> _nvidiaHotspotStates = [];
    private readonly ExperimentalPawnIoManager _experimentalDriver = new();
    private readonly object _initializationSync = new();
    private bool _experimentalThermalEnabled;
    private bool _directThermalEnabled;
    private readonly ConcurrentDictionary<string, DateTime> _nextHardwarePoll = new();
    private readonly ConcurrentDictionary<string, object> _hardwareTimings = new();
    private readonly ConcurrentDictionary<string, long> _activeHardware = new();
    private long _snapshotAt;
    private Task? _initializationTask;
    private Task? _extendedInitializationTask;
    private Task? _pollTask;
    private Task? _nvidiaPollTask;
    private Exception? _initializationError;
    private Exception? _extendedInitializationError;
    private bool _initialized;
    private volatile bool _extendedInitialized;
    private volatile IReadOnlyList<object> _cachedHardware = [];
    private IReadOnlyList<NvidiaThermalSnapshot> _nvidiaThermals = [];
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = null,
        NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals
    };

    public HardwareService(int port)
    {
        _listener.Prefixes.Add($"http://127.0.0.1:{port}/");
    }

    public async Task RunAsync()
    {
        _listener.Start();
        Console.WriteLine("READY");
        Console.Out.Flush();
        _initializationTask = Task.Run(InitializeHardware);

        while (!_shutdown.IsCancellationRequested)
        {
            try
            {
                HttpListenerContext context = await _listener.GetContextAsync();
                _ = Task.Run(() => HandleAsync(context));
            }
            catch (HttpListenerException) when (_shutdown.IsCancellationRequested) { }
            catch (ObjectDisposedException) when (_shutdown.IsCancellationRequested) { }
        }
    }

    private async Task HandleAsync(HttpListenerContext context)
    {
        HttpListenerResponse response = context.Response;
        response.Headers["Cache-Control"] = "no-cache";
        response.Headers["Access-Control-Allow-Origin"] = "*";

        try
        {
            string path = context.Request.Url?.AbsolutePath ?? "/";
            switch (path.ToLowerInvariant())
            {
                case "/health":
                    if (!_initialized)
                    {
                        response.StatusCode = 503;
                        await SendJsonAsync(response, Diagnostics());
                        break;
                    }
                    await SendJsonAsync(response, Diagnostics());
                    break;
                case "/data.json":
                    if (!_initialized)
                    {
                        if (_initializationError is not null) throw _initializationError;
                        response.StatusCode = 202;
                        await SendJsonAsync(response, CreateTree([]));
                        break;
                    }
                    await SendJsonAsync(response, CreateTree(CurrentHardware()));
                    break;
                case "/nvidia-thermal":
                    await SendJsonAsync(response, NvidiaThermalProbe.Read());
                    break;
                case "/pawnio-diagnostic":
                    await SendJsonAsync(response, PawnIoModuleDiagnostics.Read());
                    break;
                case "/sensor":
                    await HandleSensorAsync(context.Request, response);
                    break;
                case "/resetallminmax":
                    await ResetAllAsync();
                    await SendJsonAsync(response, await CreateTreeAsync());
                    break;
                case "/metrics":
                    await SendTextAsync(response, await CreateMetricsAsync(), "text/plain; version=0.0.4");
                    break;
                case "/shutdown" when context.Request.HttpMethod == "POST":
                    await SendJsonAsync(response, new { result = "ok" });
                    _shutdown.Cancel();
                    _listener.Stop();
                    break;
                default:
                    response.StatusCode = 404;
                    await SendJsonAsync(response, new { error = "Not found" });
                    break;
            }
        }
        catch (Exception error)
        {
            response.StatusCode = 500;
            await SendJsonAsync(response, new { result = "fail", message = error.Message });
        }
        finally
        {
            try { response.Close(); } catch { }
        }
    }

    private async Task<object> CreateTreeAsync()
    {
        EnsureInitialized();
        return await Task.FromResult(CreateTree(CurrentHardware()));
    }

    private IReadOnlyList<object> CurrentHardware() => _cachedHardware
        .Concat(_storagePoller?.Snapshot?.Hardware ?? []).ToArray();

    private object CreateTree(IReadOnlyList<object> hardware)
    {
        Version? version = typeof(Computer).Assembly.GetName().Version;
        return new Dictionary<string, object?>
        {
            ["id"] = 0,
            ["Version"] = version is null ? "0.9.7" : $"{version.Major}.{version.Minor}.{version.Build}",
            ["Text"] = "Sensor",
            ["Min"] = "Min",
            ["Value"] = "Value",
            ["Max"] = "Max",
            ["ImageURL"] = "",
            ["Diagnostics"] = Diagnostics(),
            ["Children"] = new List<object>
            {
                new Dictionary<string, object?>
                {
                    ["id"] = 1, ["Text"] = Environment.MachineName, ["Min"] = "", ["Value"] = "", ["Max"] = "", ["Children"] = hardware
                }
            }
        };
    }

    public void WatchParent(int parentPid)
    {
        _ = Task.Run(async () =>
        {
            while (!_shutdown.IsCancellationRequested)
            {
                try
                {
                    using Process parent = Process.GetProcessById(parentPid);
                    if (parent.HasExited) break;
                }
                catch { break; }
                await Task.Delay(2000);
            }
            if (!_shutdown.IsCancellationRequested)
            {
                _shutdown.Cancel();
                try { _listener.Stop(); } catch { }
            }
        });
    }

    private object Diagnostics() => new
    {
        status = _initialized ? "ok" : _initializationError is null ? "starting" : "error",
        error = _initializationError?.Message ?? "",
        scanStage = !_initialized ? "core" : _extendedInitializationError is not null || !string.IsNullOrEmpty(_storagePoller?.Error) ? "partial"
            : _extendedInitialized && _storagePoller?.Snapshot is not null ? "complete" : "extended",
        extendedError = _extendedInitializationError?.Message ?? _storagePoller?.Error ?? "",
        backend = "librehardwaremonitor",
        polling = new
        {
            snapshotAt = Interlocked.Read(ref _snapshotAt),
            activeHardware = _activeHardware.ToArray().Select(item => new { id = item.Key, activeForMs = Environment.TickCount64 - item.Value }).ToArray(),
            storageSnapshotAt = _storagePoller?.SampledAt ?? 0,
            storageDurationMs = _storagePoller?.DurationMs ?? 0,
            hardware = _hardwareTimings.ToArray().ToDictionary(item => item.Key, item => item.Value)
        },
        platform = OperatingSystem.IsWindows() ? "windows" : "unknown",
        isAdministrator = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator),
        requiresAdministrator = true,
        readOnly = false,
        pawnIoInstalled = PawnIoDriver.IsInstalled,
        pawnIoVersion = PawnIoDriver.Version?.ToString() ?? "",
        experimentalDriverConfigured = _experimentalDriver.Configured,
        experimentalDriverActive = _experimentalDriver.Active,
        experimentalDriverRebootRequired = _experimentalDriver.RebootRequired,
        experimentalDriverMessage = _experimentalDriver.Message,
        nvidiaHotspot = CreateNvidiaHotspotDiagnostics(),
        capabilities = new
        {
            temperature = true,
            fan = true,
            power = true,
            gpuHotspot = true,
            control = true
        },
        source = new
        {
            name = "LibreHardwareMonitor/LibreHardwareMonitor",
            url = "https://github.com/LibreHardwareMonitor/LibreHardwareMonitor",
            license = "MPL-2.0"
        }
    };

    private object CreateNvidiaHotspotDiagnostics()
    {
        NvidiaThermalSnapshot[] gpus = _nvidiaThermals.ToArray();
        string state = _nvidiaHotspotStates.Values.FirstOrDefault(value => value == "direct")
            ?? _nvidiaHotspotStates.Values.FirstOrDefault(value => value == "nvapi-channel")
            ?? _nvidiaHotspotStates.Values.FirstOrDefault(value => value == "direct-waiting")
            ?? _nvidiaHotspotStates.Values.FirstOrDefault(value => value == "pawnio-module-awaiting-signature")
            ?? _nvidiaHotspotStates.Values.FirstOrDefault(value => value == "pawnio-module-unavailable")
            ?? (gpus.Any(gpu => NvidiaThermalProbe.IsRtx50Series(gpu.Name)) ? "nvapi-no-hotspot-channel" : "not-applicable");
        return new
        {
            state,
            directThermalEnabled = _directThermalEnabled,
            gpus = gpus.Select(gpu => new
            {
                gpu.GpuIndex,
                gpu.Name,
                gpu.Mask,
                channels = gpu.Channels.Select(channel => new { channel.Index, channel.Celsius }).ToArray(),
                hotspotChannel = NvidiaThermalProbe.FindHotspot(gpu)?.ChannelIndex
            }).ToArray()
        };
    }

    private object CreateHardwareNode(IHardware hardware, IReadOnlyList<NvidiaThermalSnapshot> nvidiaThermals, ref int nodeId)
    {
        List<object> children = [];
        foreach (IGrouping<SensorType, ISensor> group in hardware.Sensors.GroupBy(sensor => sensor.SensorType))
        {
            List<object> sensors = [];
            foreach (ISensor sensor in group) sensors.Add(CreateSensorNode(sensor, ref nodeId));
            if (group.Key == SensorType.Temperature)
                AddNvidiaHotspotNode(hardware, group, nvidiaThermals, sensors, ref nodeId);
            children.Add(new Dictionary<string, object?>
            {
                ["id"] = nodeId++, ["Text"] = group.Key.ToString(), ["Min"] = "", ["Value"] = "", ["Max"] = "", ["Children"] = sensors
            });
        }
        foreach (IHardware subHardware in hardware.SubHardware) children.Add(CreateHardwareNode(subHardware, nvidiaThermals, ref nodeId));
        return new Dictionary<string, object?>
        {
            ["id"] = nodeId++, ["Text"] = hardware.Name, ["HardwareId"] = hardware.Identifier.ToString(),
            ["Min"] = "", ["Value"] = "", ["Max"] = "", ["Children"] = children
        };
    }

    private void AddNvidiaHotspotNode(IHardware hardware, IEnumerable<ISensor> existingSensors,
        IReadOnlyList<NvidiaThermalSnapshot> snapshots, List<object> sensors, ref int nodeId)
    {
        string hardwareId = hardware.Identifier.ToString();
        if (!hardwareId.StartsWith("/gpu-nvidia/", StringComparison.OrdinalIgnoreCase) ||
            existingSensors.Any(sensor => sensor.Name.Contains("Hot Spot", StringComparison.OrdinalIgnoreCase) && sensor.Value.HasValue)) return;
        if (!int.TryParse(hardwareId.Split('/').Last(), out int gpuIndex)) return;

        NvidiaThermalSnapshot? snapshot = snapshots.FirstOrDefault(item => item.GpuIndex == gpuIndex);
        if (snapshot is null) return;
        NvidiaDirectThermalReader? reader = null;
        if (_directThermalEnabled && !_nvidiaDirectReaders.TryGetValue(gpuIndex, out reader))
        {
            try
            {
                reader = new NvidiaDirectThermalReader(snapshot.Bus, snapshot.Device, snapshot.Function);
                _nvidiaDirectReaders[gpuIndex] = reader;
            }
            catch
            {
                _nvidiaHotspotStates[gpuIndex] = "direct-reader-error";
            }
        }
        if (reader is not null)
        {
            _experimentalDriver.MarkActive(reader.IsLoaded);
            if (!reader.IsLoaded)
                _nvidiaHotspotStates[gpuIndex] = _experimentalDriver.Configured
                    ? "pawnio-module-awaiting-signature"
                    : "pawnio-module-unavailable";
            if (reader.TryRead(out float? directHotspot, out float? directHotspot2))
            {
                _nvidiaHotspotStates[gpuIndex] = "direct";
                if (directHotspot.HasValue)
                    AddSyntheticTemperature(sensors, $"{hardwareId}/temperature/direct-hotspot", "GPU Hot Spot", directHotspot.Value, 0, ref nodeId);
                if (directHotspot2.HasValue)
                    AddSyntheticTemperature(sensors, $"{hardwareId}/temperature/direct-hotspot-2", "GPU Hot Spot 2", directHotspot2.Value, 1, ref nodeId);
                return;
            }
            if (reader.IsLoaded) _nvidiaHotspotStates[gpuIndex] = "direct-waiting";
        }
        NvidiaHotspotReading? hotspot = NvidiaThermalProbe.FindHotspot(snapshot);
        if (hotspot is null)
        {
            if (NvidiaThermalProbe.IsRtx50Series(snapshot.Name) && _nvidiaHotspotStates.TryGetValue(gpuIndex, out string? currentState) &&
                currentState is "direct-waiting" or "pawnio-module-awaiting-signature" or "pawnio-module-unavailable" or "direct-reader-error")
                return;
            if (NvidiaThermalProbe.IsRtx50Series(snapshot.Name)) _nvidiaHotspotStates[gpuIndex] = "nvapi-no-hotspot-channel";
            return;
        }

        _nvidiaHotspotStates[gpuIndex] = "nvapi-channel";
        string sensorId = $"{hardwareId}/temperature/nvapi-hotspot";
        AddSyntheticTemperature(sensors, sensorId, "GPU Hot Spot", (float)hotspot.Celsius, hotspot.ChannelIndex, ref nodeId);
    }

    private void AddSyntheticTemperature(List<object> sensors, string sensorId, string name, float value, int channelIndex, ref int nodeId)
    {
        if (!_syntheticSensors.TryGetValue(sensorId, out SyntheticSensorState? state))
        {
            state = new SyntheticSensorState(sensorId, name, "Temperature");
            _syntheticSensors[sensorId] = state;
        }
        state.Update(value, channelIndex);
        sensors.Add(state.CreateNode(nodeId++));
    }

    private object CreateSensorNode(ISensor sensor, ref int nodeId)
    {
        return new Dictionary<string, object?>
        {
            ["id"] = nodeId++, ["Text"] = sensor.Name, ["SensorId"] = sensor.Identifier.ToString(), ["Type"] = sensor.SensorType.ToString(),
            ["Min"] = FormatValue(sensor.SensorType, sensor.Min), ["Value"] = FormatValue(sensor.SensorType, sensor.Value), ["Max"] = FormatValue(sensor.SensorType, sensor.Max),
            ["RawMin"] = sensor.Min, ["RawValue"] = sensor.Value, ["RawMax"] = sensor.Max, ["Children"] = Array.Empty<object>()
        };
    }

    private async Task HandleSensorAsync(HttpListenerRequest request, HttpListenerResponse response)
    {
        EnsureInitialized();
        string action = request.QueryString["action"] ?? "";
        string id = request.QueryString["id"] ?? "";
        if (_storagePoller is not null && _storageHardwareIds.Any(root => id.StartsWith(root + "/", StringComparison.Ordinal)))
        {
            object result = await _storagePoller.ExecuteAsync(() =>
            {
                ISensor storageSensor = StorageSensors().FirstOrDefault(item => item.Identifier.ToString() == id)
                    ?? throw new ArgumentException($"Unknown sensor id: {id}");
                return ApplySensorAction(storageSensor, action, request.QueryString["value"]);
            }, TimeSpan.FromSeconds(2), action == "Get" ? null : CaptureStorageSnapshot);
            await SendJsonAsync(response, result);
            return;
        }
        await _hardwareLock.WaitAsync();
        try
        {
            if (_syntheticSensors.TryGetValue(id, out SyntheticSensorState? synthetic))
            {
                switch (action)
                {
                    case "Get":
                        await SendJsonAsync(response, synthetic.CreateResult());
                        return;
                    case "ResetMinMax":
                        synthetic.Reset();
                        await SendJsonAsync(response, synthetic.CreateResult());
                        return;
                    case "Set":
                        throw new InvalidOperationException("This sensor cannot be controlled.");
                }
            }
            ISensor sensor = FindSensors().FirstOrDefault(item => item.Identifier.ToString() == id)
                ?? throw new ArgumentException($"Unknown sensor id: {id}");
            await SendJsonAsync(response, ApplySensorAction(sensor, action, request.QueryString["value"]));
        }
        finally { _hardwareLock.Release(); }
    }

    private static object SensorResult(ISensor sensor) => new
    {
        result = "ok", value = sensor.Value, min = sensor.Min, max = sensor.Max,
        format = $"{{0:F1}} {Unit(sensor.SensorType)}"
    };

    private static object ApplySensorAction(ISensor sensor, string action, string? value)
    {
        switch (action)
        {
            case "Get": return SensorResult(sensor);
            case "Set":
                if (sensor.Control is null) throw new InvalidOperationException("This sensor cannot be controlled.");
                if (value is null) throw new ArgumentException("No value provided.");
                if (value == "null") sensor.Control.SetDefault();
                else sensor.Control.SetSoftware(float.Parse(value, CultureInfo.InvariantCulture));
                return new { result = "ok" };
            case "ResetMinMax":
                sensor.ResetMin(); sensor.ResetMax();
                return SensorResult(sensor);
            default: throw new ArgumentException($"Unknown action: {action}");
        }
    }

    private async Task ResetAllAsync()
    {
        EnsureInitialized();
        if (_storagePoller is not null)
            await _storagePoller.ExecuteAsync(() =>
            {
                foreach (ISensor sensor in StorageSensors()) { sensor.ResetMin(); sensor.ResetMax(); }
                return true;
            }, TimeSpan.FromSeconds(2), CaptureStorageSnapshot);
        await _hardwareLock.WaitAsync();
        try
        {
            foreach (ISensor sensor in FindSensors()) { sensor.ResetMin(); sensor.ResetMax(); }
            foreach (SyntheticSensorState sensor in _syntheticSensors.Values) sensor.Reset();
            RefreshCacheLocked();
        }
        finally { _hardwareLock.Release(); }
    }

    private async Task<string> CreateMetricsAsync()
    {
        EnsureInitialized();
        StringBuilder output = new();
        await _hardwareLock.WaitAsync();
        try
        {
            AppendMetrics(output, FindSensors());
        }
        finally { _hardwareLock.Release(); }
        output.Append(_storagePoller?.Snapshot?.Metrics);
        return output.ToString();
    }

    private static void AppendMetrics(StringBuilder output, IEnumerable<ISensor> sensors)
    {
        foreach (ISensor sensor in sensors.Where(item => item.Value.HasValue))
        {
            string name = Regex.Replace($"lhm_{sensor.SensorType}_{sensor.Hardware.Name}_{sensor.Name}".ToLowerInvariant(), "[^a-z0-9_]", "_");
            output.Append(name).Append("{sensor_id=\"").Append(sensor.Identifier).Append("\"} ")
                .Append(sensor.Value!.Value.ToString(CultureInfo.InvariantCulture)).AppendLine();
        }
    }

    private void InitializeHardware()
    {
        try
        {
            _hardwareLock.Wait();
            try
            {
                if (_shutdown.IsCancellationRequested) return;
                _coreComputer = new Computer
                {
                    IsCpuEnabled = true,
                    IsGpuEnabled = true,
                    IsMemoryEnabled = true,
                };
                _coreComputer.Open();
                UpdateComputer(_coreComputer, DateTime.UtcNow, true);
                RefreshCacheLocked();
                lock (_initializationSync)
                {
                    if (_shutdown.IsCancellationRequested) return;
                    _initialized = true;
                    _pollTask = Task.Run(PollHardwareAsync);
                    _nvidiaPollTask = Task.Run(PollNvidiaThermalsAsync);
                    _extendedInitializationTask = Task.Run(InitializeExtendedHardware);
                    StartStoragePolling();
                }
            }
            finally { _hardwareLock.Release(); }
        }
        catch (Exception error)
        {
            lock (_initializationSync) _initializationError = error;
        }
    }

    private void InitializeExtendedHardware()
    {
        try
        {
            if (_shutdown.IsCancellationRequested) return;
            _extendedComputer = new Computer
            {
                IsBatteryEnabled = true,
                IsControllerEnabled = true,
                IsMotherboardEnabled = true,
                IsNetworkEnabled = true,
                IsPowerMonitorEnabled = true,
                IsPsuEnabled = true
            };
            _extendedComputer.Open();
            UpdateComputer(_extendedComputer, DateTime.UtcNow, true);
            _hardwareLock.Wait();
            try
            {
                _extendedInitialized = true;
                RefreshCacheLocked();
            }
            finally { _hardwareLock.Release(); }
        }
        catch (Exception error)
        {
            _extendedInitializationError = error;
        }
    }

    private void EnsureInitialized()
    {
        lock (_initializationSync)
        {
            if (_initialized) return;
            throw new InvalidOperationException(_initializationError?.Message ?? "硬件采集器正在初始化，请稍候。");
        }
    }

    private void StartStoragePolling()
    {
        _storagePoller = new SnapshotPoller<StorageSnapshot>("Storage sensors", TimeSpan.FromSeconds(15), () =>
        {
            _storageComputer = new Computer { IsStorageEnabled = true };
            _storageComputer.Open();
            _storageHardwareIds = _storageComputer.Hardware.Select(item => item.Identifier.ToString()).ToArray();
        }, () =>
        {
            UpdateComputer(_storageComputer!, DateTime.UtcNow, true);
            return CaptureStorageSnapshot();
        }, () => _storageComputer?.Close());
        _storagePoller.Start();
    }

    private IEnumerable<ISensor> StorageSensors() => _storageComputer?.Hardware.SelectMany(FindSensors) ?? [];

    private StorageSnapshot CaptureStorageSnapshot()
    {
        int nodeId = 1000000;
        object[] hardware = _storageComputer!.Hardware.Select(item => CreateHardwareNode(item, [], ref nodeId)).ToArray();
        StringBuilder metrics = new();
        AppendMetrics(metrics, StorageSensors());
        return new StorageSnapshot(hardware, metrics.ToString());
    }

    private async Task PollHardwareAsync()
    {
        while (!_shutdown.IsCancellationRequested)
        {
            await _hardwareLock.WaitAsync();
            try
            {
                if (_initialized)
                {
                    UpdateHardware(DateTime.UtcNow, false);
                    RefreshCacheLocked();
                }
            }
            catch (Exception error)
            {
                lock (_initializationSync) _initializationError ??= error;
            }
            finally { _hardwareLock.Release(); }

            try { await Task.Delay(TimeSpan.FromSeconds(1), _shutdown.Token); }
            catch (OperationCanceledException) { break; }
        }
    }

    private void UpdateHardware(DateTime now, bool force)
    {
        if (_coreComputer is not null) UpdateComputer(_coreComputer, now, force);
        if (_extendedInitialized && _extendedComputer is not null) UpdateComputer(_extendedComputer, now, force);
    }

    private void UpdateComputer(Computer computer, DateTime now, bool force)
    {
        foreach (IHardware hardware in computer.Hardware) UpdateHardwareRecursive(hardware, now, force);
    }

    private void RefreshCacheLocked()
    {
        int nodeId = 2;
        List<object> hardware = [];
        if (_coreComputer is not null)
            foreach (IHardware item in _coreComputer.Hardware) hardware.Add(CreateHardwareNode(item, _nvidiaThermals, ref nodeId));
        if (_extendedInitialized && _extendedComputer is not null)
            foreach (IHardware item in _extendedComputer.Hardware) hardware.Add(CreateHardwareNode(item, _nvidiaThermals, ref nodeId));
        _cachedHardware = hardware;
        Interlocked.Exchange(ref _snapshotAt, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    private async Task PollNvidiaThermalsAsync()
    {
        bool configured = false;
        while (!_shutdown.IsCancellationRequested)
        {
            try
            {
                IReadOnlyList<NvidiaThermalSnapshot> snapshots = NvidiaThermalProbe.Read();
                _nvidiaThermals = snapshots;
                if (!configured)
                {
                    bool experimentalOptIn = File.Exists(Path.Combine(AppContext.BaseDirectory, "enable-experimental-pawnio.flag"));
                    bool hasRtx50 = snapshots.Any(gpu => NvidiaThermalProbe.IsRtx50Series(gpu.Name));
                    _experimentalThermalEnabled = experimentalOptIn && hasRtx50;
                    _directThermalEnabled = hasRtx50 && (experimentalOptIn || PawnIoDriver.IsInstalled);
                    _experimentalDriver.EnsureConfigured(_experimentalThermalEnabled);
                    configured = true;
                }
            }
            catch { }

            try { await Task.Delay(TimeSpan.FromSeconds(2), _shutdown.Token); }
            catch (OperationCanceledException) { break; }
        }
    }

    private void UpdateHardwareRecursive(IHardware hardware, DateTime now, bool force)
    {
        string id = hardware.Identifier.ToString();
        if (force || !_nextHardwarePoll.TryGetValue(id, out DateTime next) || now >= next)
        {
            _activeHardware[id] = Environment.TickCount64;
            Stopwatch elapsed = Stopwatch.StartNew();
            try { hardware.Update(); }
            finally
            {
                _hardwareTimings[id] = new { name = hardware.Name, durationMs = elapsed.ElapsedMilliseconds, completedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
                _activeHardware.TryRemove(id, out _);
            }
            _nextHardwarePoll[id] = now + PollInterval(hardware.HardwareType);
        }
        foreach (IHardware subHardware in hardware.SubHardware) UpdateHardwareRecursive(subHardware, now, force);
    }

    private static TimeSpan PollInterval(HardwareType type) => type switch
    {
        HardwareType.Cpu or HardwareType.GpuAmd or HardwareType.GpuNvidia or HardwareType.GpuIntel => TimeSpan.FromSeconds(1),
        HardwareType.Storage => TimeSpan.FromSeconds(15),
        HardwareType.Motherboard or HardwareType.Memory or HardwareType.Network or HardwareType.PowerMonitor => TimeSpan.FromSeconds(5),
        _ => TimeSpan.FromSeconds(5)
    };

    private IEnumerable<ISensor> FindSensors()
    {
        if (_coreComputer is not null)
            foreach (IHardware hardware in _coreComputer.Hardware)
                foreach (ISensor sensor in FindSensors(hardware)) yield return sensor;
        if (_extendedInitialized && _extendedComputer is not null)
            foreach (IHardware hardware in _extendedComputer.Hardware)
                foreach (ISensor sensor in FindSensors(hardware)) yield return sensor;
    }

    private static IEnumerable<ISensor> FindSensors(IHardware hardware)
    {
        foreach (ISensor sensor in hardware.Sensors) yield return sensor;
        foreach (IHardware subHardware in hardware.SubHardware)
            foreach (ISensor sensor in FindSensors(subHardware)) yield return sensor;
    }

    private async Task SendJsonAsync(HttpListenerResponse response, object value)
    {
        response.ContentType = "application/json; charset=utf-8";
        byte[] payload = JsonSerializer.SerializeToUtf8Bytes(value, _jsonOptions);
        response.ContentLength64 = payload.Length;
        await response.OutputStream.WriteAsync(payload);
    }

    private static async Task SendTextAsync(HttpListenerResponse response, string value, string contentType)
    {
        response.ContentType = contentType;
        byte[] payload = Encoding.UTF8.GetBytes(value);
        response.ContentLength64 = payload.Length;
        await response.OutputStream.WriteAsync(payload);
    }

    private static string FormatValue(SensorType type, float? value)
        => value.HasValue ? $"{value.Value.ToString(ValueFormat(type), CultureInfo.InvariantCulture)} {Unit(type)}".Trim() : "";

    private static string ValueFormat(SensorType type) => type switch
    {
        SensorType.Clock or SensorType.Frequency or SensorType.Fan or SensorType.Data or SensorType.SmallData or SensorType.Throughput => "F0",
        _ => "F1"
    };

    private static string Unit(SensorType type) => type switch
    {
        SensorType.Voltage => "V", SensorType.Current => "A", SensorType.Power => "W", SensorType.Clock => "MHz",
        SensorType.Temperature => "°C", SensorType.Load or SensorType.Control or SensorType.Level or SensorType.Humidity => "%",
        SensorType.Frequency => "Hz", SensorType.Fan => "RPM", SensorType.Flow => "L/h", SensorType.Data => "GB",
        SensorType.SmallData => "MB", SensorType.Throughput => "B/s", SensorType.TimeSpan => "s", SensorType.Timing => "ns",
        SensorType.Energy => "mWh", SensorType.Noise => "dBA", SensorType.Conductivity => "µS/cm", _ => ""
    };

    public void Dispose()
    {
        _shutdown.Cancel();
        lock (_initializationSync) { }
        if (_listener.IsListening) _listener.Stop();
        _listener.Close();
        try { _initializationTask?.Wait(TimeSpan.FromSeconds(5)); } catch { }
        try { _extendedInitializationTask?.Wait(TimeSpan.FromSeconds(2)); } catch { }
        try { _pollTask?.Wait(TimeSpan.FromSeconds(3)); } catch { }
        try { _nvidiaPollTask?.Wait(TimeSpan.FromSeconds(2)); } catch { }
        bool storageStopped = _storagePoller?.Stop(TimeSpan.FromSeconds(2)) ?? true;
        bool coreStopped = (_initializationTask?.IsCompleted ?? true) && (_pollTask?.IsCompleted ?? true);
        bool extendedStopped = _extendedInitializationTask?.IsCompleted ?? true;
        // Native calls cannot be cancelled. Do not close their handles or locks
        // underneath them; process exit reclaims any still-blocked worker.
        if (coreStopped)
        {
            try { _coreComputer?.Close(); } catch { }
            foreach (NvidiaDirectThermalReader reader in _nvidiaDirectReaders.Values) reader.Dispose();
        }
        if (coreStopped && extendedStopped)
        {
            try { _extendedComputer?.Close(); } catch { }
            if (storageStopped && (_nvidiaPollTask?.IsCompleted ?? true))
            {
                _hardwareLock.Dispose();
                _shutdown.Dispose();
            }
        }
    }
}

internal sealed record StorageSnapshot(IReadOnlyList<object> Hardware, string Metrics);

internal sealed class SyntheticSensorState(string id, string name, string type)
{
    private float _value;
    private float _min;
    private float _max;
    private bool _initialized;
    private int _channelIndex;

    public void Update(float value, int channelIndex)
    {
        _value = value;
        _channelIndex = channelIndex;
        if (!_initialized) { _min = value; _max = value; _initialized = true; }
        else { _min = Math.Min(_min, value); _max = Math.Max(_max, value); }
    }

    public void Reset()
    {
        if (!_initialized) return;
        _min = _value;
        _max = _value;
    }

    public object CreateNode(int nodeId) => new Dictionary<string, object?>
    {
        ["id"] = nodeId, ["Text"] = name, ["SensorId"] = id, ["Type"] = type,
        ["Min"] = $"{_min:F1} °C", ["Value"] = $"{_value:F1} °C", ["Max"] = $"{_max:F1} °C",
        ["RawMin"] = _min, ["RawValue"] = _value, ["RawMax"] = _max,
        ["Source"] = "NVAPI", ["ChannelIndex"] = _channelIndex, ["Children"] = Array.Empty<object>()
    };

    public object CreateResult() => new { result = "ok", value = _value, min = _min, max = _max, format = "{0:F1} °C" };
}
