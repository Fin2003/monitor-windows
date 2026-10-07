# Third-party notices and acknowledgements

Monitor's original application code is licensed under [ISC](LICENSE). This does not
replace any third-party license or copyright. Full texts are in [licenses](licenses).
Installed Windows packages include these texts in `resources/licenses` and retain
Electron's `LICENSE.electron.txt` and `LICENSES.chromium.html` alongside the executable.

## System monitor references

Thank you to LibreHardwareMonitor and its contributors for hardware enumeration,
temperature, voltage, fan, power and load sensors; lfreist/hwinfo for the Linux
backend; and CapFrameX for the NVIDIA thermal implementation used as a reference.
Thanks also to namazso for PawnIO and PawnIO.Modules.

| Component | Version / revision | License and source |
| --- | --- | --- |
| LibreHardwareMonitorLib | 0.9.7-pre705 / 9837983c1d5d05b1222f3f12af3967f723ea65f4 | MPL-2.0 · https://github.com/LibreHardwareMonitor/LibreHardwareMonitor |
| hwinfo | f71ee147222e9b6d31cac7c079a8a390035cb7b2 | MIT · vendored in plugins/system-monitor/engine/third-party/hwinfo |
| CapFrameX NvidiaThermal | f2bd8948697d272440ba4e7aa7e725d9fb464a2c | MIT · https://github.com/CXWorld/CapFrameX |
| PawnIO | 2.2.0 source / 9d52965895588b0ffa3703b72eec75ba19f4ccc0 | GPL-2.0-or-later with upstream IOCTL linking exception · https://github.com/namazso/PawnIO |
| PawnIO.Modules NVIDIA | 0a65f31fb914914b96d175d3e461eb4824ec277a | LGPL-2.1-or-later · https://github.com/namazso/PawnIO.Modules |
| BlackSharp.Core | 1.1.0 | MPL-2.0 · https://github.com/Blacktempel/BlackSharp |
| DiskInfoToolkit | 2.1.1 | MPL-2.0 · https://github.com/Blacktempel/DiskInfoToolkit |
| RAMSPDToolkit-NDD | 1.5.0 | MPL-2.0 · https://github.com/Blacktempel/RAMSPDToolkit |
| HidSharp | 2.6.4 | Apache-2.0 · https://software.seekye.com/hidsharp |
| Mono.Posix.NETStandard | 1.0.0 | Mono's component notices · https://github.com/mono/mono |
| .NET runtime | 8.0.20; System.* packages 10.0.9 | MIT and bundled third-party notices · https://github.com/dotnet/runtime |

The MPL libraries are consumed without changes. Their source and the GPL/LGPL
driver/module source, including build information and the PawnPP source, are
provided as `Monitor-1.0.5-third-party-sources.zip` in the same GitHub Release as
the executable installers. Monitor application source is also supplied there
for both variants. Source links and package revisions are recorded in
`licenses/SOURCE-MANIFEST.json`. Recipients can use the source under each
upstream license independently of Monitor's ISC license.

The experimental unrestricted driver is supplied as source only in 1.0.2.
Its previously used binary could not be matched to an exact source revision,
so this release does not redistribute that binary. The unsigned NVIDIA module
remains opt-in; normal startup does not replace or install an experimental driver. To modify/rebuild the
hardware adapter, use the application C# source and the accompanying third-party
source archive. Third-party files are not relicensed as ISC.

## Interface and transport

- Electron 43.0.0: MIT; Chromium and bundled dependencies retain Electron's
  complete license list. https://github.com/electron/electron
- Svelte 5.56.4: MIT. https://github.com/sveltejs/svelte
- serialport 13.0.0 and its bindings, node-gyp-build, node-addon-api, debug and ms:
  upstream license texts are included in licenses. https://github.com/serialport/node-serialport
- GH Star History for Actions and the Star History renderer: MIT; D3: BSD-3-Clause;
  Patrick Hand font subset: OFL-1.1. The upstream notice and texts are retained.
- Tibo's avatar is used for source identification; it is not covered by the
  application's software license and retains its creator's rights.

## ESP32 firmware

Thanks to Waveshare for the RGB LCD/GT911 reference port and to Espressif for
ESP-IDF and the LVGL adapter. The hardware initialization originates from their
CC0 example; the retained reference README identifies that example. ESP-IDF and
Espressif components use Apache-2.0; LVGL uses MIT. Each managed component remains
under its own bundled license (including FreeType, libpng and zlib where used).
These components are restored from the ESP-IDF component registry by the build.

The generated device UI fonts in version 1.0.2 use Noto Sans SC from Google Fonts
revision a85815a42757630ce188fdad368c2dfc444d4773 under SIL OFL-1.1. The bitmap/static
derivatives use the internal name Monitor Sans SC. Original font copyrights and
the OFL text are preserved in firmware/fonts/LICENSE and licenses. Rebuild with
scripts/prepare-ui-fonts.py and scripts/generate-ui-fonts.cjs; the generated C
glyph data is shipped in the firmware source. https://github.com/google/fonts/tree/main/ofl/notosanssc

## Native touchscreen preview

The Windows preview uses LVGL 8.4.0 (revision 4495f428630cc1741bd8bfd977f080e8460e8e8d)
under MIT and cJSON 1.7.19 (revision c859b25da02955fef659d658b8f324b5cde87be3)
under MIT. Their unchanged sources are included in the third-party source archive.
The desktop adapter and build scripts are included in the ESP32 application source.

MonitorEsp32Preview is compiled with MSYS2 UCRT64 GCC 15.1.0 and statically links
the MinGW-w64 CRT (13.0.0.r21.gf5469ff36) and GCC support runtime. MinGW-w64 copyright
and component notices, GPL texts, and GCC Runtime Library Exception 3.1 are retained
in licenses. The exception permits this compiled combination to be distributed
under the licenses of its independent modules. No libstdc++, libquadmath or
compiler toolchain is bundled. Rebuild using scripts/build-esp32-preview.ps1.

## Coding Plan query sources

The API-key and AK/SK query logic in electron/providers/coding-plan-api.js is adapted
from CC Switch coding_plan.rs at d35726e28695844deaf0098450b34911f5be7b78.
Copyright (c) 2025 Jason Young; MIT. https://github.com/farion1231/cc-switch
The web-session endpoints and OpenCode serialized usage parsing are adapted from
QuotaRadar at d8d020b0dd4055c5c3defc8dc7b404fc9a132fbc (MIT). https://github.com/Asklear/QuotaRadar
Both full license texts are retained in licenses and packaged with the application.
This is an independent JavaScript adaptation; CC Switch is not a runtime dependency.
XFYun uses QuotaRadar's web-session endpoint, since CC Switch has no XFYun adapter.

## Extended quota queries

Official subscriptions (Claude, Codex, Gemini, Grok), Copilot, balance queries,
Zhipu Team and the request/extractor script contract are adapted from CC Switch
revision f9db9f7056cbe7f972cdc02644722002316866b9 (MIT).
https://github.com/farion1231/cc-switch
The Grok billing parser in that upstream is based on CodexBar (MIT).
Copyright (c) 2026 Peter Steinberger. https://github.com/steipete/CodexBar
QuickJS-emscripten 0.32.0 and QuickJS / QuickJS-NG are MIT; the corresponding
license texts accompany the installation. https://github.com/justjake/quickjs-emscripten
The Gemini installed-app OAuth client identifiers are public values from
Gemini CLI through CC Switch. They are not an account token or user secret.
Account OAuth tokens, API keys, imported-file paths, scripts and cookies are
created and stored on the user's machine only.
