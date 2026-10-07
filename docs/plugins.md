# 插件开发与上架

[English](plugins.en.md) · [返回项目说明](../README.md)

市场使用公开索引，不需要注册市场账号。插件源代码和 ZIP 由作者自己的公开仓库维护，Monitor 仓库只保存小体积索引。作者可自由选择自己的开源协议，并在包中提供 LICENSE。

## 两种现成扩展

| 类型 | 兼容范围 | 必需文件 |
| --- | --- | --- |
| `display` | `windows` | `manifest.json`、`index.html` |
| `quota` | `windows`、`esp32` | `manifest.json`、`quota.json`、`query.js` |

显示插件是 HTML／CSS／JavaScript 静态页面。应用以隔离 iframe 展示它，不注入宿主账号或 Node.js 接口；公共数据可由插件自行请求允许跨域的接口。开发时把完成的网页和静态资源打包，用户不需要安装 npm 依赖。

额度插件使用 Monitor 现有的自定义渠道，结果进入额度管理、Windows 页面和 ESP32 额度卡片。脚本使用兼容 CC Switch 的 `request/extractor` 约定，在 QuickJS 中执行；网络请求由主机发送。自己的凭据由用户在 Coding Plan 中填写并加密保存，插件包只用占位符。

ESP32 使用 LVGL 原生显示，并不运行 HTML 插件。新增原生页面需要同时修改固件和主机协议，通过 ESP32 分支代码 PR 提交。`display` 插件不能声明兼容 ESP32。

## 清单

```json
{
  "id": "my-quota",
  "name": "我的额度插件",
  "description": "查询并显示平台额度",
  "version": "1.0.0",
  "minAppVersion": "1.2.0",
  "kind": "quota",
  "targets": ["windows", "esp32"],
  "author": "作者公开名称",
  "repository": "https://github.com/OWNER/my-quota",
  "license": "MIT",
  "icon": "coding",
  "defaultEnabled": false
}
```

ID 为 2–64 个小写字母、数字或连字符，以字母开头；使用自己的名称，不能覆盖内置插件。版本使用 `x.y.z`。`repository` 是公开源码 HTTPS 地址；ZIP 根目录或唯一子目录放置清单。

## 额度配置与脚本

`quota.json`：

```json
{"baseUrl":"https://api.example.com","requiresAuth":true}
```

`query.js` 是一个表达式，示意如下（按真实平台响应修改）：

```js
({
  request: {
    url: "{{baseUrl}}/user/balance",
    method: "GET",
    headers: { Authorization: "Bearer {{apiKey}}" }
  },
  extractor: function(response) {
    return {planName: "账户余额", remaining: response.balance, unit: "USD"};
  }
})
```

可用占位符：`{{baseUrl}}`、`{{apiKey}}`、`{{accessToken}}`、`{{userId}}`。返回一个对象或对象数组，字段为 `planName`、`remaining`、`used`、`total`、`unit`、`resetsAt`（ISO 时间或 Unix 秒／毫秒）、`unlimited`、`isValid`。提供 `used` 和 `total` 才计算已用百分比；纯余额只返回 `remaining` 即可。

`requiresAuth:false` 的插件安装后会尝试连接公共接口；其他插件由用户填写凭据后“保存并验证”。额度查询插件在“已安装”中管理，在 Coding Plan 页选择是否显示；它不作为独立轮换页出现。

## 打包与本地安装

从 [示例目录](../examples/plugins) 复制一个完整插件并修改清单。打包时不要带入 `node_modules`、个人配置、Cookie、Key、工具链和运行缓存。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-plugin.ps1 -Path ./my-plugin -Output ./my-plugin-1.0.0.zip
```

脚本输出 ZIP 和 SHA256。应用 → 插件管理 → 插件市场 → 安装本地 ZIP，完成实际运行检查。运行数据留在使用者自己的配置目录，不能写回插件源码或提交到 Git。

## 自由投稿

1. 把源码推送到自己的公开仓库，并在该仓库发布固定版本 ZIP；README 写明功能、支持版本、网络接口和自己的许可证。
2. 派生 `Fin2003/monitor-windows`，编辑 **main 分支** `marketplace/index.json`。复制条目并填清单字段、`downloadUrl`、`sha256`，以及是否需要用户凭据的 `requiresAuth`。
3. 运行 `node scripts/validate-plugin-catalog.cjs` 检查索引格式，提交 PR。只提交索引改动，不把整个插件和依赖复制进主仓库。也可使用“插件投稿”问题模板先提交资料。
4. 维护者核对兼容声明、源码、许可证和发布包后合并；所有用户刷新市场即可看到。后续升级发布新的 ZIP、更新版本和校验值，再提交 PR。

市场索引仍由仓库维护者合并，贡献者无需主仓库写入权限。尚未收录的包可以本地安装，社区也可托管自己的兼容索引，在应用“市场来源”填写 HTTPS 索引地址。

## 索引结构

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "id": "my-quota",
      "name": "我的额度插件",
      "description": "查询并显示平台额度",
      "version": "1.0.0",
      "minAppVersion": "1.2.0",
      "kind": "quota",
      "targets": ["windows", "esp32"],
      "author": "作者公开名称",
      "repository": "https://github.com/OWNER/my-quota",
      "license": "MIT",
      "downloadUrl": "https://github.com/OWNER/my-quota/releases/download/v1.0.0/my-quota.zip",
      "sha256": "替换为实际的64位小写SHA256",
      "requiresAuth": true
    }
  ]
}
```

下载后校验 ZIP SHA256，再核对包内的 ID、版本、类型、源码地址及许可证；修改包时需要同时更新索引校验值。ZIP 只解压到当前安装的本地插件目录，不执行安装脚本。

分发结构参考 [Miao-Yunzai 的独立插件仓库](https://github.com/yoimiya-kokomi/Miao-Yunzai)，收录流程参考 [Raycast 的 PR 发布方式](https://developers.raycast.com/basics/publish-an-extension)。
