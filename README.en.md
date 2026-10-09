# Monitor Windows

[中文](README.md) · **English**

**Edition:** [Windows (main)](https://github.com/Fin2003/monitor-windows/blob/main/README.en.md) · [ESP32 (esp32)](https://github.com/Fin2003/monitor-windows/blob/esp32/README.en.md)

AI quotas, hardware metrics and Tibo Radar on your Windows secondary display.

## Start

- **EXE:** [Download Windows installer (1.3.1)](https://github.com/Fin2003/monitor-windows/releases/download/v1.3.1/Monitor-Windows-1.3.1-Setup-x64.exe), install it and choose your display. Runtime dependencies are included; Windows 10/11 x64 is required.
- **Source:** download the `main` branch and run `start.bat`; first launch installs dependencies. You can also run `install-dependencies.bat` first. [Source setup](docs/startup.md)
- **ESP32 screen:** use the [ESP32 edition](https://github.com/Fin2003/monitor-windows/tree/esp32) for firmware downloads and an automated AI installation prompt.

[Latest release](https://github.com/Fin2003/monitor-windows/releases/latest)

## Features

AI quota/balance queries · CPU/GPU/memory monitoring · Tibo Radar · Compact overview. Choose your display, switch dark/light themes, set an image background and combine plugins in the overview. Configure your own accounts and sensors in the app.

## Plugins

Open **Plugin manager → Marketplace** to install plugins. Developers can submit a PR to list their plugins: [Development and submission](docs/plugins.en.md) · [Examples](examples/plugins).

## License and thanks

Original code is [ISC](LICENSE). Third-party licenses and attribution are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [licenses](licenses).

Thanks to [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor), [hwinfo](https://github.com/lfreist/hwinfo), [CapFrameX](https://github.com/DevTechProfile/CapFrameX), [PawnIO](https://github.com/namazso/PawnIO), [CC Switch](https://github.com/farion1231/cc-switch), [QuotaRadar](https://github.com/Asklear/QuotaRadar), [CodexBar](https://github.com/steipete/CodexBar), [Waveshare](https://github.com/waveshareteam), [LVGL](https://github.com/lvgl/lvgl) and [QuickJS](https://github.com/justjake/quickjs-emscripten).

## Star history

Updated by [GH Star History for Actions](https://github.com/kernalix7/GH-Star-History-for-Actions).

![GitHub Stars](https://img.shields.io/github/stars/Fin2003/monitor-windows?style=flat&label=Stars)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Fin2003/monitor-windows/main/docs/star-history/chart-dark.svg?v=f06cf47afe359151">
  <img alt="Star history" src="https://raw.githubusercontent.com/Fin2003/monitor-windows/main/docs/star-history/chart.svg?v=1de7871d2341f490" width="900">
</picture>
