using System.Buffers.Binary;
using System.Runtime.InteropServices;
using System.Text;

// Independently implemented reader; interface references and supported ABI
// are documented in ../THIRD_PARTY_NOTICES.md.
internal sealed class NvidiaConnectorVoltageReader
{
    private IntPtr _gpu;
    private QueryBuffer? _read;
    private int _channel;
    private uint _bus;
    private uint _slot;
    private string? _failure;

    public void Initialize()
    {
        Check(Bind<NoArgs>(0x0150E828)(), "initialize");
        IntPtr[] handles = new IntPtr[64];
        Check(Bind<Enumerate>(0xE5AC921F)(handles, out int count), "enumerate");
        if (count != 1) throw new NotSupportedException("Connector voltage requires one NVIDIA GPU.");
        _gpu = handles[0];
        Check(Bind<PciIdentity>(0x2DDFB66E)(_gpu, out uint pci, out uint subsystem, out _, out _), "PCI identity");
        Check(Bind<DriverVersion>(0x2926AAAD)(out uint driver, new StringBuilder(64)), "driver version");
        // Restrict undocumented calls to the validated board/driver ABI.
        if (pci != 0x2B8510DE || subsystem != 0x205710DE || driver != 61088)
            throw new NotSupportedException($"Unvalidated connector voltage ABI: {pci:X8}/{subsystem:X8}, driver {driver}.");
        Check(Bind<ReadUint>(0x1BE0B8E5)(_gpu, out _bus), "bus");
        Check(Bind<ReadUint>(0x2A0A350F)(_gpu, out _slot), "slot");
        byte[] table = Query(Bind<QueryBuffer>(0xC12EB19E), 0x00030CA8, 0);
        _channel = FindConnector(table);
        _read = Bind<QueryBuffer>(0xF40238EF);
    }

    public NvidiaConnectorVoltage Sample()
    {
        if (_failure is not null) throw new InvalidOperationException(_failure);
        try
        {
            byte[] data = Query(_read ?? throw new InvalidOperationException("Not initialized"),
                0x0001059C, 1u << _channel);
            return new(_bus, _slot, _channel, DecodeVoltage(data, _channel));
        }
        catch (Exception error)
        {
            _failure = error.Message;
            throw;
        }
    }

    internal static int FindConnector(ReadOnlySpan<byte> table)
    {
        if (table.Length != 0xCA8 || Word(table, 0) != 0x00030CA8 || Word(table, 4) != 1)
            throw new InvalidDataException("Unsupported power channel metadata.");
        uint mask = Word(table, 0x10);
        int result = -1;
        for (int index = 0; index < 32; index++)
        {
            int record = 0x18 + index * 0x3C;
            if ((mask & (1u << index)) == 0 || Word(table, record + 0x1C) != 8 ||
                Word(table, record + 0x20) != 218) continue;
            if (result >= 0) throw new InvalidDataException("Ambiguous external input channel.");
            result = index;
        }
        return result >= 0 ? result : throw new InvalidDataException("No external input voltage channel.");
    }

    internal static float DecodeVoltage(ReadOnlySpan<byte> data, int channel)
    {
        if (channel is < 0 or >= 32 || data.Length != 0x59C || Word(data, 0) != 0x0001059C ||
            (Word(data, 4) & (1u << channel)) == 0)
            throw new InvalidDataException("Missing requested power channel.");
        // The driver may also return aggregate channels; only decode the identified input.
        uint microvolts = Word(data, 8 + channel * 0x2C + 0x24);
        if (microvolts is < 6_000_000 or > 16_000_000)
            throw new InvalidDataException("Invalid input voltage sample.");
        return microvolts / 1_000_000f;
    }

    private byte[] Query(QueryBuffer call, uint version, uint mask)
    {
        int length = (int)(version & 0xFFFF);
        byte[] buffer = new byte[length + 32];
        Array.Fill(buffer, (byte)0xCB, length, 32);
        BinaryPrimitives.WriteUInt32LittleEndian(buffer, version);
        BinaryPrimitives.WriteUInt32LittleEndian(buffer.AsSpan(4), mask);
        IntPtr memory = Marshal.AllocHGlobal(buffer.Length);
        try
        {
            Marshal.Copy(buffer, 0, memory, buffer.Length);
            int status = call(_gpu, memory);
            Marshal.Copy(memory, buffer, 0, buffer.Length);
            for (int i = length; i < buffer.Length; i++)
                if (buffer[i] != 0xCB) throw new InvalidDataException("Power query buffer overrun.");
            Check(status, "power query");
            return buffer[..length];
        }
        finally { Marshal.FreeHGlobal(memory); }
    }

    private static uint Word(ReadOnlySpan<byte> data, int offset) => BinaryPrimitives.ReadUInt32LittleEndian(data.Slice(offset, 4));
    private static void Check(int status, string operation)
    {
        if (status != 0) throw new InvalidOperationException($"NVAPI {operation} returned {status}.");
    }
    private static T Bind<T>(uint id) where T : Delegate
    {
        IntPtr pointer = QueryInterface(id);
        return pointer != IntPtr.Zero ? Marshal.GetDelegateForFunctionPointer<T>(pointer)
            : throw new NotSupportedException($"Missing NVAPI interface {id:X8}.");
    }
    [DllImport("nvapi64.dll", EntryPoint = "nvapi_QueryInterface", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr QueryInterface(uint id);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int NoArgs();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int Enumerate([Out] IntPtr[] handles, out int count);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int PciIdentity(IntPtr gpu, out uint pci, out uint subsystem, out uint revision, out uint extended);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int DriverVersion(out uint version, StringBuilder branch);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int ReadUint(IntPtr gpu, out uint value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int QueryBuffer(IntPtr gpu, IntPtr buffer);
}

internal sealed record NvidiaConnectorVoltage(uint Bus, uint Slot, int Channel, float Volts);
