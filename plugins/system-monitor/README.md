# 系统监控插件

系统监控插件使用同一套 HTTP 采集协议承载不同平台后端：

- Windows：`LibreHardwareMonitorLib`，提供完整温度、风扇、电压、功耗、负载、频率和可用控制项。
- Linux：`lfreist/hwinfo`，提供 CPU、RAM、GPU 基础信息和磁盘空间监控；该后端是只读的，不安装驱动。
- RTX 50 热点：Windows 专用适配，先自动尝试已安装的 PawnIO 模块；公开 NVAPI 没有独立热点通道时，管理页提供一次确认的 UAC 配置按钮。不会在普通启动时静默替换系统 PawnIO 服务。
- 风扇显示：管理页可在每个风扇/水泵传感器条目上单独选择实际转速（RPM）或对应 Control 百分比；没有对应百分比传感器时保留 RPM。
- 传感器管理：支持逐项重命名、硬件多选筛选；硬件筛选只有在用户勾选硬件后才启用，历史配置不会误隐藏新硬件；筛选和传感器选择会写入五个配置预设，运行页只展示选中硬件与传感器。
- 传感器视图：每项可收藏，管理页可快速切换“收藏”和“当前选中”；当前选中视图使用进入时快照，取消勾选后切换视图再返回才会刷新列表。
- CPU 传感器：CPU 硬件按核心拆分为核心标题行和传感器按钮行，每个核心传感器可直接点击加入监控与当前选中列表。

运行时会根据 Electron 的平台和架构自动选择：

- `engine/win-x64/SystemMonitorEngine.current.exe`（旧包回退到 `SystemMonitorEngine.exe`）
- `engine/linux-x64/SystemMonitorEngine`

Linux 引擎可以在 Linux 或 WSL 中使用 `npm run build:engine:linux` 构建。发布包必须把对应平台的引擎放在上述插件目录内，用户不需要额外调整配置。

Windows 开发目录使用 `start.bat` 安装依赖并启动此应用。读取需要管理员权限的硬件传感器时，后端会按现有采集逻辑请求 UAC 提权。发布包声明了 `requireAdministrator`。

所有第三方项目、版本和许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [manifest.json](manifest.json)。
