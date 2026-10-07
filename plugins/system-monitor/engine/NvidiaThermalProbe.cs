// NVIDIA thermal mapping adapted with reference to CapFrameX NvidiaThermal (MIT).
// Original copyright and permission notice: licenses/CapFrameX-MIT.txt.
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text;

internal static class NvidiaThermalProbe
{
    private const int MaxPhysicalGpus = 64;
    private const int TemperatureCount = 32;
    private const int ReservedCount = 8;
    private static readonly ConcurrentDictionary<int, uint> SupportedMasks = new();

    public static IReadOnlyList<NvidiaThermalSnapshot> Read()
    {
        try
        {
            IntPtr initializePointer = QueryInterface(0x0150E828);
            IntPtr enumeratePointer = QueryInterface(0xE5AC921F);
            IntPtr namePointer = QueryInterface(0xCEEE8E9F);
            IntPtr thermalPointer = QueryInterface(0x65FE3AAD);
            IntPtr busPointer = QueryInterface(0x1BE0B8E5);
            IntPtr slotPointer = QueryInterface(0x2A0A350F);
            if (initializePointer == IntPtr.Zero || enumeratePointer == IntPtr.Zero || thermalPointer == IntPtr.Zero) return [];

            InitializeDelegate initialize = Marshal.GetDelegateForFunctionPointer<InitializeDelegate>(initializePointer);
            if (initialize() != 0) return [];

            EnumPhysicalGpusDelegate enumerate = Marshal.GetDelegateForFunctionPointer<EnumPhysicalGpusDelegate>(enumeratePointer);
            IntPtr[] handles = new IntPtr[MaxPhysicalGpus];
            if (enumerate(handles, out int count) != 0) return [];

            GetFullNameDelegate? getName = namePointer == IntPtr.Zero ? null : Marshal.GetDelegateForFunctionPointer<GetFullNameDelegate>(namePointer);
            GetThermalSensorsDelegate getThermals = Marshal.GetDelegateForFunctionPointer<GetThermalSensorsDelegate>(thermalPointer);
            GetUintDelegate? getBus = busPointer == IntPtr.Zero ? null : Marshal.GetDelegateForFunctionPointer<GetUintDelegate>(busPointer);
            GetUintDelegate? getSlot = slotPointer == IntPtr.Zero ? null : Marshal.GetDelegateForFunctionPointer<GetUintDelegate>(slotPointer);
            List<NvidiaThermalSnapshot> snapshots = [];
            for (int index = 0; index < count; index++)
            {
                uint supportedMask = SupportedMasks.GetOrAdd(index, _ => DiscoverSupportedMask(handles[index], getThermals));
                if (supportedMask == 0) continue;

                ThermalSensors sensors = CreateSensors(supportedMask);
                if (getThermals(handles[index], ref sensors) != 0) continue;

                StringBuilder name = new(64);
                getName?.Invoke(handles[index], name);
                uint bus = 0;
                uint device = 0;
                getBus?.Invoke(handles[index], out bus);
                getSlot?.Invoke(handles[index], out device);
                List<NvidiaThermalChannel> channels = [];
                for (int channel = 0; channel < sensors.Temperatures.Length; channel++)
                {
                    int raw = sensors.Temperatures[channel];
                    double value = raw / 256.0;
                    if (raw != 0 && value is > -100 and < 200)
                        channels.Add(new NvidiaThermalChannel(channel, raw, value));
                }
                snapshots.Add(new NvidiaThermalSnapshot(index, name.ToString(), bus, device, 0, sensors.Mask, channels));
            }
            return snapshots;
        }
        catch (Exception error) when (error is DllNotFoundException or EntryPointNotFoundException or BadImageFormatException)
        {
            return [];
        }
    }

    private static uint DiscoverSupportedMask(IntPtr handle, GetThermalSensorsDelegate getThermals)
    {
        uint supportedMask = 0;
        for (int bit = 0; bit < 32; bit++)
        {
            ThermalSensors test = CreateSensors(1u << bit);
            if (getThermals(handle, ref test) != 0) break;
            supportedMask = bit == 31 ? uint.MaxValue : (1u << (bit + 1)) - 1;
        }
        return supportedMask;
    }

    public static NvidiaHotspotReading? FindHotspot(NvidiaThermalSnapshot snapshot)
    {
        if (!IsRtx50Series(snapshot.Name)) return null;
        double? core = snapshot.Channels.FirstOrDefault(channel => channel.Index == 1)?.Celsius;

        IEnumerable<NvidiaThermalChannel> candidates = snapshot.Channels
            .Where(channel => channel.Index != 1 && channel.Index != 2)
            .Where(channel => channel.Celsius is > 0 and < 130);
        if (core.HasValue) candidates = candidates.Where(channel => channel.Celsius >= core.Value - 1);
        NvidiaThermalChannel? candidate = candidates.MaxBy(channel => channel.Celsius);
        return candidate is null ? null : new NvidiaHotspotReading(candidate.Index, candidate.Celsius);
    }

    public static bool IsRtx50Series(string name)
    {
        Span<char> normalized = stackalloc char[name.Length];
        int length = 0;
        foreach (char character in name)
        {
            if (char.IsLetterOrDigit(character)) normalized[length++] = char.ToUpperInvariant(character);
        }
        return normalized[..length].ToString().Contains("RTX50", StringComparison.Ordinal);
    }

    private static ThermalSensors CreateSensors(uint mask) => new()
    {
        Version = (uint)(Marshal.SizeOf<ThermalSensors>() | (2 << 16)),
        Mask = mask,
        Reserved = new int[ReservedCount],
        Temperatures = new int[TemperatureCount]
    };

    private static IntPtr QueryInterface(uint interfaceId)
        => Environment.Is64BitProcess ? NvApi64QueryInterface(interfaceId) : NvApi32QueryInterface(interfaceId);

    [DllImport("nvapi64.dll", EntryPoint = "nvapi_QueryInterface", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr NvApi64QueryInterface(uint interfaceId);

    [DllImport("nvapi.dll", EntryPoint = "nvapi_QueryInterface", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr NvApi32QueryInterface(uint interfaceId);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int InitializeDelegate();

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int EnumPhysicalGpusDelegate([Out] IntPtr[] handles, out int count);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int GetFullNameDelegate(IntPtr handle, StringBuilder name);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int GetThermalSensorsDelegate(IntPtr handle, ref ThermalSensors sensors);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int GetUintDelegate(IntPtr handle, out uint value);

    [StructLayout(LayoutKind.Sequential, Pack = 8)]
    private struct ThermalSensors
    {
        public uint Version;
        public uint Mask;

        [MarshalAs(UnmanagedType.ByValArray, SizeConst = ReservedCount)]
        public int[] Reserved;

        [MarshalAs(UnmanagedType.ByValArray, SizeConst = TemperatureCount)]
        public int[] Temperatures;
    }
}

internal sealed record NvidiaThermalSnapshot(int GpuIndex, string Name, uint Bus, uint Device, uint Function, uint Mask, IReadOnlyList<NvidiaThermalChannel> Channels);
internal sealed record NvidiaThermalChannel(int Index, int RawValue, double Celsius);
internal sealed record NvidiaHotspotReading(int ChannelIndex, double Celsius);
