# Monitor Windows

[中文](README.md) · **English**

Windows secondary-display monitor for AI quotas, hardware metrics and Tibo Radar, with community plugins.

[Download installer](https://github.com/Fin2003/monitor-windows/releases/latest) · [Windows](https://github.com/Fin2003/monitor-windows/tree/main) · [ESP32](https://github.com/Fin2003/monitor-windows/tree/esp32) · [Plugin development](docs/plugins.en.md)

## Start

### Option 1: Download the EXE and install

**For normal use, download directly from [Releases](https://github.com/Fin2003/monitor-windows/releases/latest). You do not need the source code or a development environment.**

| Use case | Installer |
| --- | --- |
| Windows monitor / secondary display | `Monitor-Windows-VERSION-Setup-x64.exe` |
| Windows connected to an ESP32 screen | `Monitor-ESP32-VERSION-Setup-x64.exe` |

Double-click the installer. Electron, .NET and the required runtime libraries are included; the ESP32 installer also includes serial libraries and the native preview engine. **Node.js, npm and .NET do not need to be installed separately.** Windows 10/11 x64 is required. Hardware collection may request administrator permission; packages are currently unsigned.

Configure your own accounts, keys and display contents after launch. Plugins that do not use accounts work without signing in.

### Option 2: Source / one-click scripts

Download the matching branch ZIP into a writable directory and double-click **`start.bat`**. First launch installs dependencies and builds the interface and hardware engine. Alternatively, run **`install-dependencies.bat`** first.

Source setup requires internet access and `winget` from Windows App Installer. It installs Node.js and .NET 8 SDK when needed; Node.js 22.12.0 or newer is required. ESP32 preview builds additionally use CMake, Ninja and MSYS2 UCRT64 GCC, prepared by the setup script. Install those tools manually if winget is unavailable.

```bat
install-dependencies.bat
start.bat
```

Source profiles are `.device-profile`; `start-clean.bat` uses a separate `.review-profile` to show a fresh launch. Installed packages use `%APPDATA%\monitor-windows`. Your subsequent settings persist in these local directories and are excluded from Git and release packages.

### Display selection

Choose your own Windows monitor, resolution and position in **Display settings**, then enable the desired plugins. For a physical ESP32 display, use the [esp32 branch](https://github.com/Fin2003/monitor-windows/tree/esp32) and its installer. Connectivity and display output have been verified on **Waveshare ESP32-S3-Touch-LCD-5B**, a 5-inch 1024×600 capacitive touchscreen. See [official documentation](https://www.waveshare.com/wiki/ESP32-S3-Touch-LCD-5); other boards need their own port.

## Plugin development and marketplace

Open **Plugin manager → Marketplace** to search, inspect source, install/update a plugin, or install a local ZIP. Configure your own credentials in Coding Plan management when a quota plugin needs them. Quota plugins feed the ESP32's existing quota pages as well.

| Type | Target | Package |
| --- | --- | --- |
| Display | Windows | `manifest.json`, `index.html`, optional static assets |
| Quota | Windows and ESP32 | `manifest.json`, `quota.json`, CC Switch-compatible `query.js` |
| Native ESP32 page | ESP32 | LVGL firmware and host protocol changes through a code PR |

Both apps read the small [catalog on main](https://github.com/Fin2003/monitor-windows/blob/main/marketplace/index.json) and show compatibility. The marketplace source can be changed to a community HTTPS catalog.

Authors maintain their own public repositories and host ZIP releases there. This repository stores metadata, source/download links and SHA256 values. **Anyone can fork it and submit a PR to list or update a plugin.** After merging, refreshing the catalog makes it available without a new Monitor release. Unlisted packages can be installed from a local ZIP.

See [development and submission instructions](docs/plugins.en.md) and [starter plugins](examples/plugins). Do not package personal credentials, cookies, settings, dependency directories or toolchains. Display plugins use an isolated frame; quota scripts reuse the QuickJS query environment without Node.js file or process APIs.

## Features

### Quotas and balances

21 public provider types plus custom/community queries:

| Category | Providers |
| --- | --- |
| Coding plans | Volcengine ARK, OpenCode Go, Xfyun, Kimi, Zhipu personal/team, MiniMax, ZenMux, Command Code |
| Official subscriptions | Claude, Codex, Gemini, Grok/xAI, GitHub Copilot |
| Account balances | DeepSeek, StepFun, SiliconFlow, OpenRouter, Novita |
| Extensions | New API/One API, custom endpoints, community quota plugins |

Displays actual provider windows, models, balances, units, reset times and update times. Balance-only records do not invent percentages. ESP32 rotates multiple accounts and quota groups every 15 seconds.

Official subscriptions can bind a CLI login file chosen by the user; Copilot supports device-code login. Volcengine supports AK/SK or its saved web session; Xfyun uses its web-session interface. Credentials are encrypted by Windows, and cookies stay in each local account session. Packages include no accounts. Available accounts and real endpoints have been checked; adapter availability does not imply every subscription was individually verified.

### Hardware, Radar and overview

- Hardware: available CPU/GPU/memory and other sensor readings, selectable sensors and aliases. Some readings require elevation or supported hardware drivers.
- Tibo Radar: public updates and reset timing clues; supply your own LLM/JEV credentials and sign into X when a feature requires a session.
- Overview: combine quotas, sensors and Radar. Windows supports page rotation; ESP32 uses native firmware pages and dark/light themes.

### Build installers

After source dependency setup:

```bat
npm run dist:win
```

Outputs go into `release`. Git excludes EXEs, dependencies, build outputs, account/device settings, caches and diagnostic reports. Lockfiles, required firmware fonts, build inputs and licenses are retained. Autostart is opt-in; see [startup details](docs/startup.md).

## License and acknowledgements

Original code is [ISC](LICENSE). Third-party components retain their own licenses; copyright, versions and source information are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [licenses](licenses). Releases include application source and necessary third-party source/license packages.

Thanks to [CC Switch](https://github.com/farion1231/cc-switch), [QuotaRadar](https://github.com/Asklear/QuotaRadar), [CodexBar](https://github.com/steipete/CodexBar), [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor), [hwinfo](https://github.com/lfreist/hwinfo), [CapFrameX](https://github.com/DevTechProfile/CapFrameX), [PawnIO](https://github.com/namazso/PawnIO), [Waveshare](https://github.com/waveshareteam), [LVGL](https://github.com/lvgl/lvgl), [QuickJS](https://github.com/justjake/quickjs-emscripten) for provider adaptations, hardware monitoring and display support. Plugin distribution draws on [Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai) and the [Raycast publishing flow](https://developers.raycast.com/basics/publish-an-extension).

## Star history

Updated by [GH Star History for Actions](https://github.com/kernalix7/GH-Star-History-for-Actions).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/star-history/chart-dark.svg">
  <img alt="Star history" src="docs/star-history/chart.svg" width="900">
</picture>
