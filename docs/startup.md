# 启动补充说明

普通使用请直接下载 Release EXE。源码 `start.bat` 使用本目录 `.device-profile`，`start-clean.bat` 使用 `.review-profile`；两者都保存后续设置。安装版另用 `%APPDATA%` 下的独立目录。

ESP32 的 `start.bat --esp32-no-connect` 不打开 USB；`--esp32-passive` 禁用实时账号与传感器采集；`--esp32-port=COMn` 由使用者手动指定端口。桌面依赖安装不会安装或刷写 ESP-IDF 固件。

Windows 开机自启为可选项，仅 Windows 分支提供以下任务入口：

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\monitor-autostart.ps1 -Action install
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\monitor-autostart.ps1 -Action uninstall
```

Git 和安装包不包含个人运行目录。不要提交 Cookie、登录 JSON、配置导出、硬件缓存或本机日志。
