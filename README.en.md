# Monitor ESP32

[中文](README.md) · **English**

**Edition:** [Windows (main)](https://github.com/Fin2003/monitor-windows/blob/main/README.en.md) · [ESP32 (esp32)](https://github.com/Fin2003/monitor-windows/blob/esp32/README.en.md)

Windows host for an ESP32 touchscreen, with AI quotas, hardware metrics and Tibo Radar.

## Install

For **Waveshare ESP32-S3-Touch-LCD-5B / 1024×600** on Windows 10/11 x64.

1. [Download firmware ZIP (1.3.1)](https://github.com/Fin2003/monitor-windows/releases/download/v1.3.1/Monitor-ESP32-1.3.1-firmware-5B.zip), extract it and run `flash-firmware.bat` to flash your screen.
2. [Download ESP32 host EXE (1.3.1)](https://github.com/Fin2003/monitor-windows/releases/download/v1.3.1/Monitor-ESP32-1.3.1-Setup-x64.exe), install it and choose Auto connect.

The EXE includes runtime dependencies. **Flash the board before first use; installing the EXE does not flash it.** [Latest release](https://github.com/Fin2003/monitor-windows/releases/latest) · [Detailed setup](docs/esp32-setup.en.md)

### Let AI install it

Connect the screen with a USB data cable and give this prompt to an AI that can operate your local terminal:

```text
Install Monitor ESP32 directly on my Windows 10/11 x64 computer; execute the setup rather than only giving instructions.
Repository: https://github.com/Fin2003/monitor-windows/tree/esp32
Downloads: https://github.com/Fin2003/monitor-windows/releases/latest
Guide: https://github.com/Fin2003/monitor-windows/blob/esp32/docs/esp32-setup.en.md
Board: Waveshare ESP32-S3-Touch-LCD-5B, 1024x600, 16MB flash / 8MB PSRAM.
Download the ESP32 Setup EXE, firmware-5B.zip and SHA256SUMS.txt from the same release, verify the checksums and extract the firmware.
Install Python 3 and esptool as needed, using the bundled flash-firmware.bat and its isolated dependency environment.
Identify this screen's USB Serial/JTAG port. Ask me to unplug/replug if multiple ports or an uncertain board model prevent identification; do not guess or touch other devices.
Once the board and port are identified, close software using that port, run the flash script and supply FLASH at its prompt; confirm successful write verification.
Install and launch the ESP32 EXE, connect the screen and check online status, physical display, mouse-driven touch preview and dark/light themes.
Do not compile source or erase the entire chip. Ask for my help only when elevation prompts or physical BOOT/RESET actions require it.
I will configure accounts in the app; do not read or upload my existing browser cookies, login files or API keys.
Resolve errors using the actual logs, then report the installed versions, selected port and connection result.
```

For source use, download this branch and run `start.bat`; first launch installs dependencies. [Source setup](docs/startup.md)

## Features

AI quota/balance queries · CPU/GPU/memory monitoring · Tibo Radar · Compact overview. Dark/light themes, image backgrounds and a mouse-driven touch preview. Configure your own accounts and sensors in the app.

## Plugins

Open **Plugin manager → Marketplace** to install plugins. Developers can submit a PR to list their plugins: [Development and submission](docs/plugins.en.md) · [Examples](examples/plugins).

## License and thanks

Original code is [ISC](LICENSE). Third-party licenses and attribution are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [licenses](licenses).

Thanks to [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor), [hwinfo](https://github.com/lfreist/hwinfo), [CapFrameX](https://github.com/DevTechProfile/CapFrameX), [PawnIO](https://github.com/namazso/PawnIO), [CC Switch](https://github.com/farion1231/cc-switch), [QuotaRadar](https://github.com/Asklear/QuotaRadar), [CodexBar](https://github.com/steipete/CodexBar), [Waveshare](https://github.com/waveshareteam), [LVGL](https://github.com/lvgl/lvgl) and [QuickJS](https://github.com/justjake/quickjs-emscripten).

## Star history

Updated by [GH Star History for Actions](https://github.com/kernalix7/GH-Star-History-for-Actions).

![GitHub Stars](https://img.shields.io/github/stars/Fin2003/monitor-windows?style=flat&label=Stars)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Fin2003/monitor-windows/esp32/docs/star-history/chart-dark.svg?v=f06cf47afe359151">
  <img alt="Star history" src="https://raw.githubusercontent.com/Fin2003/monitor-windows/esp32/docs/star-history/chart.svg?v=1de7871d2341f490" width="900">
</picture>
