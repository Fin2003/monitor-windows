# Monitor Windows

**中文** · [English](README.en.md)

**版本：** [Windows（main）](https://github.com/Fin2003/monitor-windows/tree/main) · [ESP32（esp32）](https://github.com/Fin2003/monitor-windows/tree/esp32)

在 Windows 副屏上显示 AI 额度、硬件数据和 Tibo 雷达。

## 启动

- **EXE 安装：**[下载 Windows 安装包（1.3.1）](https://github.com/Fin2003/monitor-windows/releases/download/v1.3.1/Monitor-Windows-1.3.1-Setup-x64.exe)，安装后选择显示器即可。已包含运行依赖，支持 Windows 10/11 x64。
- **源码启动：**下载 `main` 分支后双击 `start.bat`，首次自动安装依赖；也可先运行 `install-dependencies.bat`。[源码启动说明](docs/startup.md)
- **ESP32 屏幕：**使用 [ESP32 版本](https://github.com/Fin2003/monitor-windows/tree/esp32)，该页提供固件下载和 AI 自动安装提示词。

[最新发布](https://github.com/Fin2003/monitor-windows/releases/latest)

## 功能

AI 额度／余额查询 · CPU/GPU/内存监控 · Tibo 雷达 · 缩略总览。支持选择显示器、深浅主题、图片背景和插件组合显示。账号和传感器在应用内自行配置。

## 插件

在“插件管理 → 插件市场”安装插件。开发者可提交 PR 上架自己的插件：[开发与投稿](docs/plugins.md) · [示例插件](examples/plugins)。

## 协议与感谢

原创代码采用 [ISC](LICENSE)。第三方许可与完整来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [licenses](licenses)。

感谢 [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)、[hwinfo](https://github.com/lfreist/hwinfo)、[CapFrameX](https://github.com/DevTechProfile/CapFrameX)、[PawnIO](https://github.com/namazso/PawnIO)、[CC Switch](https://github.com/farion1231/cc-switch)、[QuotaRadar](https://github.com/Asklear/QuotaRadar)、[CodexBar](https://github.com/steipete/CodexBar)、[Waveshare](https://github.com/waveshareteam)、[LVGL](https://github.com/lvgl/lvgl) 与 [QuickJS](https://github.com/justjake/quickjs-emscripten)。

## Star 趋势

由 [GH Star History for Actions](https://github.com/kernalix7/GH-Star-History-for-Actions) 自动更新。

![GitHub Stars](https://img.shields.io/github/stars/Fin2003/monitor-windows?style=flat&label=Stars)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Fin2003/monitor-windows/main/docs/star-history/chart-dark.svg?v=98a78460864371cb">
  <img alt="Star 趋势" src="https://raw.githubusercontent.com/Fin2003/monitor-windows/main/docs/star-history/chart.svg?v=b2d401c2f89fccfe" width="900">
</picture>
