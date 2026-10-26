// This Source Code Form is subject to the Mozilla Public License, v. 2.0.
// https://mozilla.org/MPL/2.0/
// Copyright (C) LibreHardwareMonitor and Contributors.
// Adapted for Monitor from LibreHardwareMonitor revision
// feb0e0ee33cbc32aba6606aea7d1e9bf5ab8d5fd (PawnIo/Nvidia.cs).
internal static class NvidiaThermalDecoder
{
    public const int ChannelCount = 6;

    public static float? Decode(long raw)
    {
        uint value = unchecked((uint)raw);
        return (value & (1u << 30)) == 0 ? null : (value & 0xFFFF) / 256.0f;
    }

    public static float? Maximum(long[] channels)
    {
        float? maximum = null;
        foreach (long raw in channels)
        {
            float? value = Decode(raw);
            if (value.HasValue && (!maximum.HasValue || value.Value > maximum.Value)) maximum = value;
        }
        return maximum;
    }
}
