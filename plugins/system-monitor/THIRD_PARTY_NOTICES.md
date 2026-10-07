# Third-party notices

This plugin combines several independent open-source projects. Each project remains under its original license.

## LibreHardwareMonitor

- Project: https://github.com/LibreHardwareMonitor/LibreHardwareMonitor
- Pinned repository revision: `9837983c1d5d05b1222f3f12af3967f723ea65f4`.
- License: Mozilla Public License 2.0 (MPL-2.0)
- Used for: Windows hardware enumeration, sensors, min/max tracking, and supported controls.
- Package: `LibreHardwareMonitorLib` 0.9.7-pre705.

## hwinfo

- Project: https://github.com/lfreist/hwinfo
- Pinned source revision: `f71ee147222e9b6d31cac7c079a8a390035cb7b2`.
- License: MIT.
- Used for: Linux CPU, RAM, GPU information, and disk free-space monitoring.
- Vendored source: `engine/third-party/hwinfo`.

## CapFrameX NvidiaThermal

- Project: https://github.com/CXWorld/CapFrameX
- Reference implementation: https://github.com/CXWorld/CapFrameX/commit/f2bd8948697d272440ba4e7aa7e725d9fb464a2c
- License: MIT.
- Used for: the Windows NVIDIA thermal channel mapping and RTX 50 hotspot adaptation.

## PawnIO

- Project: https://github.com/namazso/PawnIO
- License: GPL-2.0-or-later with the project’s special linking exception.
- Used for: the optional Windows direct thermal module path only.
- The experimental unrestricted driver is source-only in version 1.0.2; its earlier binary is not included.

## PawnIO.Modules

- Project: https://github.com/namazso/PawnIO.Modules
- NVIDIA GB20x module source: https://github.com/namazso/PawnIO.Modules/pull/77 (`0a65f31fb914914b96d175d3e461eb4824ec277a`).
- License: LGPL-2.1-or-later.
- Used for: the embedded NVIDIA direct-read module represented by `Resources/Nvidia.bin`.
- Built with Pawn 4.1.7152 using the upstream CI flags: `-iinclude -C64 -;+ -(+ -p`.
- The AMX payload is stored in PawnIO's unsigned-module container format for reproducible testing; production loading still requires an upstream-signed module.
- `Resources/Nvidia.bin` SHA-256: `BA6D7BA030A5C1E9CBF859CE2E006953164400F6C86C5FFD2E042FAA0174C440`.

The unrestricted PawnIO driver is never enabled by the normal startup path. To enable this optional path in a custom build, first compile the supplied PawnIO source with WDK, place the resulting driver in `engine/Resources/PawnIO-unrestricted.sys`, and update `ExperimentalHash` in `ExperimentalPawnIoManager.cs` to its SHA-256. The management page can then launch the script after an explicit user action and UAC confirmation; the change may require a reboot. The Linux backend does not install or use PawnIO.

## LibreHardwareMonitor package dependencies

The Windows `LibreHardwareMonitorLib` package also carries these upstream packages:

- `DiskInfoToolkit` 2.1.1 · MPL-2.0 · https://github.com/Blacktempel/DiskInfoToolkit
- `RAMSPDToolkit-NDD` 1.5.0 · MPL-2.0 · https://github.com/Blacktempel/RAMSPDToolkit
- `HidSharp` 2.6.4 · Apache-2.0 · https://software.seekye.com/hidsharp
- `Mono.Posix.NETStandard` 1.0.0 · package/project information: https://www.nuget.org/packages/Mono.Posix.NETStandard

Full license texts and matching source distribution details: [project notices](../../THIRD_PARTY_NOTICES.md).
