# Monitor ESP32

**中文** · [English](README.en.md)

Windows 主机连接 ESP32 触摸显示屏，展示 AI 额度、硬件数据和 Tibo 雷达，并提供鼠标触屏预览。

[下载安装](https://github.com/Fin2003/monitor-windows/releases/latest) · [Windows 版本](https://github.com/Fin2003/monitor-windows/tree/main) · [ESP32 版本](https://github.com/Fin2003/monitor-windows/tree/esp32) · [插件开发](docs/plugins.md)

## 启动

### 方式一：下载 EXE，直接安装使用

**普通用户直接去 [发布页](https://github.com/Fin2003/monitor-windows/releases/latest) 下载安装包，不需要先下载源码或安装开发环境。**

| 使用场景 | 下载文件 |
| --- | --- |
| Windows 显示器／副屏 | `Monitor-Windows-版本号-Setup-x64.exe` |
| Windows 连接 ESP32 屏幕 | `Monitor-ESP32-版本号-Setup-x64.exe` |

双击安装包即可安装并创建快捷方式。安装包内置 Electron、.NET 和必要运行依赖；ESP32 版还包含串口库与触屏预览引擎。**无需另装 Node.js、npm 或 .NET。** 支持 Windows 10／11 x64；首次使用硬件监控时可能需要确认管理员权限。当前安装包尚未进行代码签名。

首次启动后，在管理页配置自己的账号、密钥和显示内容。账号登录不是使用其他无登录插件的前提。

### 方式二：源码／脚本一键启动

下载对应分支的源码 ZIP 并解压到可写目录，双击 **`start.bat`**。首次运行会自动调用依赖安装脚本并构建界面与硬件引擎。也可先运行 **`install-dependencies.bat`**，再启动。

源码安装需要联网及 Windows 应用安装程序提供的 `winget`。脚本会按需安装 Node.js 和 .NET 8 SDK；Node.js 最低版本为 22.12.0。ESP32 源码预览还需要 CMake、Ninja 与 MSYS2 UCRT64 GCC，依赖脚本会准备这些工具。缺少 `winget` 时，可先自行安装相应开发工具。

```bat
install-dependencies.bat
start.bat
```

`start-clean.bat` 使用独立的空白配置目录，适合查看首次启动状态。普通源码配置位于本目录 `.device-profile`，空白启动位于 `.review-profile`；安装版使用 `%APPDATA%\monitor-esp32`。这些目录保存你随后设置的内容，均不进入 Git 或发布包。

### 已实测连接的 ESP32 显示屏

| 项目 | 当前适配 |
| --- | --- |
| 板卡型号 | **Waveshare ESP32-S3-Touch-LCD-5B** |
| 屏幕 | 5 英寸电容触摸，**1024×600** |
| 控制器 | ESP32-S3，RGB 显示接口，GT911 触摸控制器 |
| 主机连接 | USB 数据线，Espressif USB Serial/JTAG |
| 主机系统 | Windows 10／11 x64 |
| 固件开发 | ESP-IDF 5.5.1、LVGL |

已有设备验证了 USB 连接和显示。型号中的 **5B** 对应本项目的 1024×600 配置；同系列 800×480 型号需要调整固件，不能直接视为已验证兼容。规格、接口位置与接线请参阅 [Waveshare 官方文档](https://www.waveshare.com/wiki/ESP32-S3-Touch-LCD-5)。

连接带数据传输能力的 USB 线后启动程序。唯一符合条件的设备自动识别；多设备时在“ESP32 屏幕”页选择端口。没有预设个人串口号或设备序列号。深色／亮色模式在标题栏切换，屏幕预览支持鼠标点击与按住拖动。

安装主机 EXE **不会给板卡刷写固件**。板卡需运行同一版本的 Monitor 固件；如需编译，在 ESP-IDF 环境运行 `npm run build:esp32`，再按官方工具流程自行刷写。源码预览使用 `npm run build:preview`；普通 EXE 已内置预览引擎。

## 插件开发与插件市场

管理页 → **插件管理 → 插件市场**，可搜索、查看作者源码、安装／更新插件，或安装本地 ZIP。插件需要账号时，安装后在 Coding Plan 管理中填写自己的凭据。额度插件也会用于 ESP32 的现有额度页面。

| 类型 | 适用版本 | 开发方式 |
| --- | --- | --- |
| 显示插件 | Windows | `manifest.json` 与 `index.html`，可带静态资源 |
| 额度查询插件 | Windows、ESP32 | `manifest.json`、`quota.json` 与兼容 CC Switch 的 `query.js` |
| ESP32 原生页面 | ESP32 | 修改 LVGL 固件和主机协议，提交代码 PR |

市场索引在 `main` 分支的 [marketplace/index.json](https://github.com/Fin2003/monitor-windows/blob/main/marketplace/index.json)。两种主机读取同一索引并显示兼容范围；“市场来源”可切换到社区维护的 HTTPS 索引。

作者把插件维护在自己的公开仓库，ZIP 放在自己的发布页；本仓库仅收录名称、版本、兼容范围、源码链接、下载链接和 SHA256。**任何人都可以派生仓库并提交 PR 上架／更新自己的插件**；合并后应用刷新市场即可看到，新增插件不需要重新发布 Monitor。未收录的插件也可以通过本地 ZIP 安装。

查看 [中文开发与投稿文档](docs/plugins.md) 和 [示例插件](examples/plugins)。投稿不携带个人 Key、Cookie、配置、依赖目录或编译工具链。显示插件在隔离的页面中运行；额度脚本复用现有 QuickJS 查询环境，不能直接调用 Node.js 文件或进程接口。

## 功能说明

### 额度与余额

支持 21 类公开渠道，以及社区／自定义额度接口：

| 类别 | 支持渠道 |
| --- | --- |
| 编程套餐 | 火山方舟、OpenCode Go、讯飞星火、Kimi、智谱个人／团队、MiniMax、ZenMux、Command Code |
| 官方订阅 | Claude、Codex、Gemini、Grok／xAI、GitHub Copilot |
| 账户余额 | DeepSeek、阶跃星辰、硅基流动、OpenRouter、Novita |
| 通用扩展 | New API／One API、自定义接口、社区额度查询插件 |

按接口实际返回显示周期、模型额度、账户余额、单位、重置时间及更新时间。没有总额的余额显示数值，不生成虚假百分比；ESP32 的多账号／多组额度每 15 秒轮换。

官方订阅可主动选择本机 CLI 登录文件，Copilot 支持设备码登录。火山可使用 AK／SK 或已有网页登录会话；讯飞使用登录会话接口。密钥通过 Windows 系统加密保存，Cookie 留在各账号本地会话中，安装包不预置账号。已进行已有账号与真实接口调试；未宣称所有渠道都用真实订阅账号逐一验证。

### 系统监控、雷达与总览

- 系统监控：CPU、GPU、内存及其他可用硬件传感器，可选择传感器与别名；部分数据需要管理员权限或硬件驱动支持。
- Tibo 雷达：查看相关公开动态、额度重置线索和时间信息；在设置中填自己的 LLM／JEV 凭据，需要 X 会话的功能由用户自行登录。
- 缩略总览：组合额度、硬件数据和雷达。Windows 支持页面轮换；ESP32 使用固定固件页面与深浅主题。

### 构建安装包

```bat
npm run dist:win
```

在完成源码依赖安装后执行，输出位于 `release`。EXE、依赖目录、编译产物、账号配置、设备连接信息、缓存和诊断报告均不提交到 Git；版本锁、必要固件字体、构建输入和许可证保留。默认不开启开机自启，相关说明见 [启动文档](docs/startup.md)。

## 开源协议与感谢

项目原创代码采用 [ISC 协议](LICENSE)，第三方组件遵循各自的许可证。完整版权、版本、源码取得方式和许可证文本见 [第三方声明](THIRD_PARTY_NOTICES.md) 及 [许可证目录](licenses)。发布页提供应用源码及必要的第三方源码／许可证附件。

感谢 [CC Switch](https://github.com/farion1231/cc-switch)、[QuotaRadar](https://github.com/Asklear/QuotaRadar)、[CodexBar](https://github.com/steipete/CodexBar)、[LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)、[hwinfo](https://github.com/lfreist/hwinfo)、[CapFrameX](https://github.com/DevTechProfile/CapFrameX)、[PawnIO](https://github.com/namazso/PawnIO)、[Waveshare](https://github.com/waveshareteam)、[LVGL](https://github.com/lvgl/lvgl)、[QuickJS](https://github.com/justjake/quickjs-emscripten) 等项目提供实现、接口适配、硬件驱动与显示支持。插件分发流程参考 [Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai) 和 [Raycast](https://developers.raycast.com/basics/publish-an-extension)。

## Star 趋势

由 [GH Star History for Actions](https://github.com/kernalix7/GH-Star-History-for-Actions) 自动更新。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/star-history/chart-dark.svg">
  <img alt="Star 趋势" src="docs/star-history/chart.svg" width="900">
</picture>
