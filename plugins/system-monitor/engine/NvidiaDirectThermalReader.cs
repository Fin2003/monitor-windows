using System.Diagnostics;
using System.Reflection;
using LibreHardwareMonitor.PawnIo;

internal sealed class NvidiaDirectThermalReader : IDisposable
{
    private const int CacheLifetimeMilliseconds = 5000;
    private const int MaxConsecutiveFailures = 3;
    private const int ReadTimeoutMilliseconds = 1000;
    private static readonly long CacheLifetimeTicks = ToTicks(CacheLifetimeMilliseconds);
    private static readonly long ReadTimeoutTicks = ToTicks(ReadTimeoutMilliseconds);
    private readonly long[] _input;
    private readonly long[] _output = new long[2];
    private readonly PawnIo _pawnIo;
    private readonly AutoResetEvent _readRequested = new(false);
    private readonly object _sync = new();
    private readonly Thread? _worker;
    private float? _cachedHotspot;
    private float? _cachedHotspot2;
    private long _cacheTimestamp;
    private bool _closeRequested;
    private int _consecutiveFailures;
    private bool _disabled;
    private bool _hasCachedData;
    private bool _readInProgress;
    private bool _readPending;
    private long _readStartedTimestamp;

    public NvidiaDirectThermalReader(uint bus, uint device, uint function)
    {
        _input = [bus, device, function];
        MethodInfo? loader = typeof(PawnIo).GetMethod("LoadModuleFromResource", BindingFlags.Static | BindingFlags.NonPublic);
        _pawnIo = loader?.Invoke(null, [typeof(NvidiaDirectThermalReader).Assembly, "SystemMonitorEngine.Resources.Nvidia.bin"]) as PawnIo
            ?? throw new InvalidOperationException("PawnIO module loader is unavailable.");
        if (_pawnIo.IsLoaded)
        {
            _worker = new Thread(ReadLoop) { IsBackground = true, Name = $"NVIDIA thermal {bus:X2}:{device:X2}.{function}" };
            _worker.Start();
        }
    }

    public bool IsLoaded => _pawnIo.IsLoaded;

    public bool TryRead(out float? hotspot, out float? hotspot2)
    {
        hotspot = null;
        hotspot2 = null;
        bool requestRead = false;
        lock (_sync)
        {
            long now = Stopwatch.GetTimestamp();
            if (!_disabled && _readInProgress && Elapsed(now, _readStartedTimestamp, ReadTimeoutTicks))
            {
                _disabled = true;
                _hasCachedData = false;
            }
            if (!_closeRequested && !_disabled && _worker is not null && !_readInProgress && !_readPending)
            {
                _readPending = true;
                requestRead = true;
            }
            bool hasData = _hasCachedData && !Elapsed(now, _cacheTimestamp, CacheLifetimeTicks);
            if (hasData)
            {
                hotspot = _cachedHotspot;
                hotspot2 = _cachedHotspot2;
            }
            else _hasCachedData = false;
            if (requestRead) _readRequested.Set();
            return hasData;
        }
    }

    private void ReadLoop()
    {
        try
        {
            while (true)
            {
                _readRequested.WaitOne();
                lock (_sync)
                {
                    if (_closeRequested) break;
                    if (_disabled) { _readPending = false; continue; }
                    _readPending = false;
                    _readInProgress = true;
                    _readStartedTimestamp = Stopwatch.GetTimestamp();
                }

                bool success = TryReadHardware(out float? hotspot, out float? hotspot2);
                lock (_sync)
                {
                    _readInProgress = false;
                    _readStartedTimestamp = 0;
                    if (success && !_closeRequested && !_disabled)
                    {
                        _cachedHotspot = hotspot;
                        _cachedHotspot2 = hotspot2;
                        _cacheTimestamp = Stopwatch.GetTimestamp();
                        _consecutiveFailures = 0;
                        _hasCachedData = true;
                    }
                    else if (!success && !_closeRequested && !_disabled)
                    {
                        _consecutiveFailures++;
                        if (_consecutiveFailures >= MaxConsecutiveFailures)
                        {
                            _disabled = true;
                            _hasCachedData = false;
                        }
                    }
                    if (_closeRequested) break;
                }
            }
        }
        finally { _pawnIo.Close(); }
    }

    private bool TryReadHardware(out float? hotspot, out float? hotspot2)
    {
        hotspot = null;
        hotspot2 = null;
        try
        {
            int result = _pawnIo.ExecuteHr("ioctl_read_thermal_registers", _input, 3, _output, 2, out uint returned);
            if (result != 0 || returned < 2) return false;
            hotspot = Decode(_output[0]);
            hotspot2 = Decode(_output[1]);
            return hotspot.HasValue || hotspot2.HasValue;
        }
        catch { return false; }
    }

    private static float? Decode(long raw)
    {
        uint value = (uint)raw;
        uint whole = (value >> 8) & 0xFF;
        return whole is 0 or 0xFF ? null : whole + (value & 0xFF) / 32.0f;
    }

    private static bool Elapsed(long now, long start, long duration) => now - start >= duration;
    private static long ToTicks(int milliseconds) => (long)Math.Ceiling(milliseconds * (double)Stopwatch.Frequency / 1000);

    public void Dispose()
    {
        lock (_sync)
        {
            if (_closeRequested) return;
            _closeRequested = true;
            _disabled = true;
            _hasCachedData = false;
        }
        if (_worker is null) _pawnIo.Close();
        else _readRequested.Set();
    }
}
