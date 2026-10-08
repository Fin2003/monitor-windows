# Monitor ESP32

**中文** · [English](README.en.md)

**版本：** [Windows（main）](https://github.com/Fin2003/monitor-windows/tree/main) · [ESP32（esp32）](https://github.com/Fin2003/monitor-windows/tree/esp32)

Windows 连接 ESP32 触摸屏，显示 AI 额度、硬件数据和 Tibo 雷达。

## 安装

适配 **Waveshare ESP32-S3-Touch-LCD-5B / 1024×600**，电脑需 Windows 10/11 x64。

1. [下载屏幕固件 ZIP（1.3.1）](https://github.com/Fin2003/monitor-windows/releases/download/v1.3.1/Monitor-ESP32-1.3.1-firmware-5B.zip)，解压后运行 `flash-firmware.bat`，刷入自己的屏幕。
2. [下载 Windows ESP32 安装包（1.3.1）](https://github.com/Fin2003/monitor-windows/releases/download/v1.3.1/Monitor-ESP32-1.3.1-Setup-x64.exe)，安装后选择自动连接。

EXE 已包含运行依赖。**首次使用先刷固件；安装 EXE 不会自动刷屏幕。** [最新发布](https://github.com/Fin2003/monitor-windows/releases/latest) · [详细安装说明](docs/esp32-setup.md)

### 交给 AI 自动安装

用 USB 数据线连接屏幕，把下面这段发给能操作本机终端的 AI：

```text
请直接在我的 Windows 10/11 x64 电脑上安装 Monitor ESP32，不要只给教程或命令。
仓库：https://github.com/Fin2003/monitor-windows/tree/esp32
下载：https://github.com/Fin2003/monitor-windows/releases/latest
指南：https://github.com/Fin2003/monitor-windows/blob/esp32/docs/esp32-setup.md
设备：Waveshare ESP32-S3-Touch-LCD-5B，1024×600，16MB Flash / 8MB PSRAM。
下载同一次发布的 ESP32 Setup EXE、firmware-5B.zip 和 SHA256SUMS.txt，核对校验值并解压。
自动安装刷机需要的 Python 3 和 esptool；使用包内 flash-firmware.bat，沿用它的独立依赖环境。
识别这块屏幕的 USB Serial/JTAG 串口。多个候选或型号不明确时请我拔插确认，不要猜端口或操作其他设备。
型号和端口确认后，关闭占用该端口的程序，执行刷写并为脚本输入 FLASH；确认写入校验成功。
安装并启动 ESP32 EXE，自动连接屏幕，检查设备在线、实体显示、鼠标触屏预览与深浅主题。
无需编译源码或整片擦除。权限窗口、BOOT/RESET 等物理操作需要我配合时再提示我。
账号由我在应用中自行配置，不读取或上传我已有的浏览器 Cookie、登录文件和 API Key。
遇到错误请根据实际日志继续处理，最后报告安装版本、所用端口和连接结果。
```

使用源码：下载本分支后双击 `start.bat`，首次自动安装依赖。[源码启动说明](docs/startup.md)

## 功能

AI 额度／余额查询 · CPU/GPU/内存监控 · Tibo 雷达 · 缩略总览。支持深浅主题、图片背景和鼠标模拟触屏预览。账号和传感器在应用内自行配置。

## 插件

在“插件管理 → 插件市场”安装插件。开发者可提交 PR 上架自己的插件：[开发与投稿](docs/plugins.md) · [示例插件](examples/plugins)。

## 协议与感谢

原创代码采用 [ISC](LICENSE)。第三方许可与完整来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [licenses](licenses)。

感谢 [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)、[hwinfo](https://github.com/lfreist/hwinfo)、[CapFrameX](https://github.com/DevTechProfile/CapFrameX)、[PawnIO](https://github.com/namazso/PawnIO)、[CC Switch](https://github.com/farion1231/cc-switch)、[QuotaRadar](https://github.com/Asklear/QuotaRadar)、[CodexBar](https://github.com/steipete/CodexBar)、[Waveshare](https://github.com/waveshareteam)、[LVGL](https://github.com/lvgl/lvgl) 与 [QuickJS](https://github.com/justjake/quickjs-emscripten)。

## Star 趋势

由 [GH Star History for Actions](https://github.com/kernalix7/GH-Star-History-for-Actions) 自动更新。

![GitHub Stars](https://img.shields.io/github/stars/Fin2003/monitor-windows?style=flat&label=Stars)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Fin2003/monitor-windows/esp32/docs/star-history/chart-dark.svg?v=c27481b0ddb053a1">
  <img alt="Star 趋势" src="https://raw.githubusercontent.com/Fin2003/monitor-windows/esp32/docs/star-history/chart.svg?v=32b2d5b91fb33a49" width="900">
</picture>
