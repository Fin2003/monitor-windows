# ESP32 从首次刷机到连接 Monitor

[English](esp32-setup.en.md)

ESP32 是运行屏幕程序的设备，Windows 是发送数据的主机。**先给板卡刷 Monitor 固件，再安装 Monitor ESP32 EXE。** 只安装 EXE 不会更换板卡内的程序；出厂演示固件不能接收 Monitor 的数据。已经运行当前固件的板卡不用每次启动都刷机。

## 1. 确认设备与下载

本次固件适配 **Waveshare ESP32-S3-Touch-LCD-5B，1024×600，16MB Flash / 8MB PSRAM**。800×480 的 5 型号、其他尺寸和接线不同的板卡需要重新适配，不能直接刷这个包。型号与接口位置见 [Waveshare 官方说明](https://docs.waveshare.com/ESP32-S3-Touch-LCD-5)。

到 [Release](https://github.com/Fin2003/monitor-windows/releases/latest) 下载同一次发布的：

1. `Monitor-ESP32-版本号-firmware-5B.zip`：板卡固件与刷机脚本。
2. `Monitor-ESP32-版本号-Setup-x64.exe`：Windows 控制端，内置运行依赖。

把固件 ZIP 解压到可写目录。安装 [Python 3 Windows 版](https://www.python.org/downloads/windows/)，安装时勾选加入 PATH。刷机脚本会在解压目录的 `.flash-tools` 中安装 esptool，不需要 ESP-IDF、Node.js 或编译工具。

## 2. 连接与刷写

1. 关闭 Monitor、串口调试器等占用串口的软件。
2. 用 USB **数据线**连接屏幕。打开 Windows 设备管理器 → 端口，拔插屏幕确认属于它的 COM 端口。不要选择其他设备的端口。
3. 双击解压目录内 `flash-firmware.bat`。输入自己的 COM 端口；脚本列出端口名称供辨认。
4. 确认屏幕型号和端口后输入 `FLASH`。等待写入完成及 `Hash of data verified`，不要中途断电。
5. 如果设备没有自动重新启动，按 RESET。Monitor 使用 ESP32-S3 自带的 **USB Serial/JTAG** 数据通道，运行时需接能枚举该通道的 USB 接口；UART 下载口与运行数据口需按自己板卡的标识区分。

脚本写入 `bootloader.bin @ 0x0`、`partition-table.bin @ 0x8000`、`monitor_5b.bin @ 0x10000`，不会执行整片擦除。刷写会替换原来的启动和显示程序；已有其他固件需要保留时，先用厂商工具自行备份。这个包没有设备 NVS 备份、账号、图片或用户配置。

同布局的 Monitor 固件升级可以运行 `flash-firmware.bat -AppOnly`，只更新应用分区。首次安装使用默认完整刷写。需要手动操作时，参数对应 [Espressif esptool 官方说明](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/esptool/basic-commands.html)。

## 3. 安装 Windows 端并显示数据

1. 双击 `Monitor-ESP32-版本号-Setup-x64.exe` 完成安装并启动。
2. 在“ESP32 屏幕”页选择自动连接；多个设备时选择自己的端口。连接成功后能看到设备在线和实时屏幕预览。
3. 在 Coding Plan 管理中配置自己的账号；在系统监控中选择传感器。固件无需保存账户密钥，主机发送展示数据。
4. 在预览标题旁切换深色／亮色，或选择图片背景。鼠标点击／拖动预览可模拟触屏；实体屏也可以直接操作。
5. 图片由 Windows 本地保存并在每次连接后发送到板卡 RAM；断开主机或板卡重启后需要重新连接才能恢复图片。图片以 512×300 RGB565 传输，再放大至 1024×600。

本次 `monitor-native-0.16.0-background` 固件与 1.3.0 主机同时修复了主题状态回报覆盖新设置的问题。设置写入 Flash 改由内部内存任务执行，避免板卡重启；背景采用逐块确认传输。管理界面主题与屏幕主题分别设置。

## 连接失败时

- 没有 COM 端口：换数据线、检查 USB 接口；按厂商说明，按住 BOOT 连接电脑后松开，再查看端口。
- 写入时一直 Connecting：关闭占用串口的软件，进入 BOOT 模式后重试，写完按 RESET。接口位置和驱动使用厂商对应板卡指南。
- 刷完不显示或尺寸不对：核对是否 **5B / 1024×600**，不要把 800×480 固件混用。
- Windows 端未在线：检查接入的是 USB Serial/JTAG 通道，关闭其他 Monitor 实例和串口工具，再手动选择端口。

## 可复制给 AI 的安装提示词

```text
请手把手协助我在 Windows 10/11 x64 安装 Fin2003/monitor-windows 的 ESP32 版本。
仓库：https://github.com/Fin2003/monitor-windows/tree/esp32
指南：https://github.com/Fin2003/monitor-windows/blob/esp32/docs/esp32-setup.md
设备是 Waveshare ESP32-S3-Touch-LCD-5B，1024×600，16MB Flash / 8MB PSRAM。
先帮助我下载同一 Release 的 firmware-5B.zip 与 ESP32 Setup EXE。
确认设备型号和我拔插后识别出的 COM 端口，再使用固件包的 flash-firmware.bat。
不要默认端口、不要整片擦除、不要修改其他串口设备。
刷写成功后安装 EXE，连接 USB Serial/JTAG，检查实际屏幕和预览、深浅主题以及图片背景。
账号和图片由我在本机自行配置，不要要求我在对话里提供 API Key 或 Cookie。
每一步等我反馈实际现象，报错时根据原始报错继续处理。
```
