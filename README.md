# Monitor ESP32 — Windows

## Windows EXE release

Download `Monitor-ESP32-1.0.5-Setup-x64.exe` from this private repository's Releases and double-click it. It installs the application and shortcuts, then starts the app. Electron, the Windows hardware engine's .NET runtime and native serial libraries are included; Node.js, npm and .NET do not need to be installed on the destination computer. Windows x64 is required. The package is unsigned.

The board is discovered over USB automatically. Select a port if multiple ESP32 devices are attached. The EXE uses a separate `%APPDATA%/monitor-esp32` profile; sign in and configure your own keys after installation. Optional light protocol identifiers are stored in that profile's `lights-connection.json` file. Installing the EXE does not flash the board; the host and firmware must come from this branch together.

To reproduce the installer from source, run `install-dependencies.bat`, then `npm run dist:win`. The installer is written to `release/`. Hardware sensor access may request UAC when the hardware plugin starts.


Windows host + Waveshare ESP32-S3-Touch-LCD-5B (1024 × 600) touchscreen firmware. This branch includes Coding Plan (Volcengine / opencode Go / Xfyun), system sensors, Tibo Radar and optional BLE light control.

## One-click start

Unzip to a writable folder and double-click `start.bat`. First launch invokes `install-dependencies.bat` to install Node.js and .NET SDK through winget when needed, restore locked dependencies, build the hardware engine and build the interface. You can run the installer separately. Windows App Installer provides winget; Windows x64 is required for this build.

Connect the board USB port and start the app. A unique Espressif USB Serial/JTAG device is selected automatically by its generic USB descriptor, then confirmed by the board's firmware hello packet. Multiple candidates appear in the ESP32 settings selector. No fixed COM number, USB serial number, machine path or personal device address is stored in the source. Opening a serial connection may reset the board depending on the Windows driver.

The source starts with an empty `.device-profile` directory created locally at runtime. The installed EXE stores its own profile in `%APPDATA%/monitor-esp32` instead. Configure accounts and Radar LLM/JEV keys in this app's manager. It never imports another Monitor installation's credentials. `.gitignore` excludes all sessions, cookies, keys, device profiles, screenshots, logs, generated binaries and toolchains.

`start.bat --esp32-no-connect` runs without opening USB. `--esp32-passive` disables live account and sensor collection. `--esp32-port=COMn` overrides automatic USB selection. `npm run bridge` launches this same host runtime.

## Firmware build

The firmware requires ESP-IDF 5.5.1 for ESP32-S3. Use the ESP-IDF PowerShell environment and run `npm run build:esp32`, or set `IDF_PATH`, `IDF_TOOLS_PATH` and `IDF_PYTHON_ENV_PATH` to your installed toolchain. The desktop dependency installer does not install or flash ESP-IDF.

Generated UI fonts are included so an ordinary firmware build does not require font generation. To regenerate them, run `python -m pip install fonttools`, `python scripts/prepare-ui-fonts.py`, then `node scripts/generate-ui-fonts.cjs` to use the OFL-licensed Noto Sans SC source.

Use the host and firmware from this same branch together: the Coding Plan display payload now carries generic channel periods. The dependency installer does not update firmware already installed on a board.

The build script preserves the 4.5 MiB app image limit required for the RGB framebuffers and PSRAM. It only compiles firmware; it does not flash the board. Flash manually using ESP-IDF after selecting your own port. Physical display, touch and BLE behavior require validation on the intended board.

## 触屏预览

“ESP32 屏幕”页内置 1024×600 预览，复用与设备相同的 LVGL 固件源码和字体。鼠标点击模拟轻触，按住拖动模拟滑动；无需 USB 连接即可预览。管理页不再提供 Windows 显示器选择、分辨率或桌面全屏控制，主题在标题栏切换。

源码预览的构建需要 CMake、Ninja 和 MSYS2 UCRT64 GCC，由 `install-dependencies.bat` 准备；EXE 内置预览引擎，无需另装这些开发工具。独立浏览器编辑器已移除，桌面应用不再监听该 HTTP 编辑端口。

## Optional lights

No pairing identifiers are supplied. See `plugins/light-control/README.md` to configure your own local light protocol parameters. USB device discovery is automatic; light pairing tokens cannot be inferred from the USB descriptor.

## 开源协议与致谢

本项目原始代码采用 [ISC 协议](LICENSE)。感谢 **LibreHardwareMonitor**、**lfreist/hwinfo**、**CapFrameX**、**PawnIO / PawnIO.Modules** 提供系统监控实现与参考。

第三方组件保留原有许可证；完整版权、许可证文本、版本和源码取得方式见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。安装包带有许可证目录，Release 同时提供应用源码和第三方源码包。1.0.2 的实验性 PawnIO 驱动仅提供源码，安装包不附该实验驱动；部分新显卡的额外温度读数需要自行构建驱动。

## 独立启动与发布内容

双击 `start-clean.bat` 使用本目录的 `.review-profile`，便于检查首次启动状态；该目录首次运行时创建，不读取其他安装的配置。普通 `start.bat` 使用本目录的 `.device-profile`。两种入口都会保存你随后自行设置的内容，可在这些目录检查。安装版的配置目录保持独立。

Git 仅保存应用源码、构建脚本、依赖版本锁和必要的第三方源码及许可证。`node_modules`、工具链、构建产物、账号配置、Cookie、设备连接信息、硬件缓存和诊断报告不会提交。EXE 内的 Electron、.NET 与串口运行库是运行所需组件；安装包不附开发依赖或预置账号数据。源码 ZIP 从对应分支的 Git 文件生成。

系统监控的 `third-party/hwinfo` 是 Linux 后端构建所需的 MIT 源码；ESP32 的字体 C 文件是固件构建输入。第三方许可证、字体源码和版本锁均保留。

## Star History

Updated daily by GitHub Actions, including in this private repository. No personal token configuration is needed.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/star-history/chart-dark.svg">
  <img alt="Star History" src="docs/star-history/chart.svg" width="900">
</picture>

Generated with [GH Star History for Actions](https://github.com/kernalix7/GH-Star-History-for-Actions).
