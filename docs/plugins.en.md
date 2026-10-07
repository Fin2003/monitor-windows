# Plugin development and publishing

[中文](plugins.md) · [Project README](../README.en.md)

Monitor uses a public catalog. Authors own their public source repository and versioned ZIP releases; this project stores only metadata. Include your own open-source LICENSE.

## Supported packages

| Type | Targets | Required files |
| --- | --- | --- |
| `display` | `windows` | `manifest.json`, `index.html` |
| `quota` | `windows`, `esp32` | `manifest.json`, `quota.json`, `query.js` |

Display plugins are static HTML/CSS/JavaScript in an isolated iframe, without host credentials or Node.js APIs. Bundle web assets so users do not need npm. A plugin may access public endpoints that permit browser cross-origin requests.

Quota plugins use the existing custom-provider path and feed Windows and native ESP32 quota cards. `query.js` is a CC Switch `request/extractor` expression evaluated in QuickJS. The host performs its network request. Users configure their own encrypted credentials; packages contain placeholders only.

ESP32 does not run HTML. A new LVGL page requires firmware/host protocol changes and an ESP32 branch code PR. Display packages must not list ESP32 as a target.

## Manifest

Start with a complete [example](../examples/plugins). Required metadata: `id`, `name`, `description`, `version`, `minAppVersion`, `kind`, `targets`, `author`, `repository`, `license`. IDs have 2–64 lowercase letters/digits/hyphens, starting with a letter, and must not replace a built-in. Versions are `x.y.z`; repository URLs use HTTPS. Put the manifest at ZIP root or in one enclosing directory.

For quota packages, `quota.json` contains `baseUrl` and `requiresAuth`. A query expression:

```js
({request: {url: "{{baseUrl}}/user/balance", method: "GET",
  headers: {Authorization: "Bearer {{apiKey}}"}},
  extractor: function(response) {
    return {planName: "Balance", remaining: response.balance, unit: "USD"};
  }})
```

Variables: `{{baseUrl}}`, `{{apiKey}}`, `{{accessToken}}`, `{{userId}}`. Return an object or array with `planName`, `remaining`, `used`, `total`, `unit`, `resetsAt` (ISO or Unix seconds/milliseconds), `unlimited`, `isValid`. Percentages require used/total; a balance alone only needs remaining. Adapt field access to your endpoint's actual response.

Public plugins with `requiresAuth:false` try connecting after installation. Others are configured in Coding Plan management. Quota plugins are managed in Installed plugins and use the Coding Plan page rather than creating a separate rotating page.

## Package and install locally

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-plugin.ps1 -Path ./my-plugin -Output ./my-plugin-1.0.0.zip
```

The script creates a ZIP and prints SHA256. Install it in Plugin manager → Marketplace → Install local ZIP. Check actual operation before submission. Do not include dependencies, toolchains, accounts, keys, cookies, user configuration or caches.

## Submit or update

1. Publish source and a fixed-version ZIP release in your public repository. Document compatibility, network endpoints and license.
2. Fork `Fin2003/monitor-windows`; edit **main** `marketplace/index.json`. Add manifest metadata, `downloadUrl`, a 64-character lowercase `sha256`, and `requiresAuth`.
3. Run `node scripts/validate-plugin-catalog.cjs` and open a PR containing metadata only. The Plugin submission issue form is an alternative for submitting links first.
4. Maintainers check source, compatibility, license and release package before merging. Users refresh the catalog; Monitor itself does not need a new release. Publish a new ZIP and update the catalog through another PR for upgrades.

Everyone can submit; direct write permission is unnecessary. Unlisted ZIPs can be installed locally. Communities may host compatible HTTPS catalogs, selectable through Marketplace source. The JSON format is `{"schemaVersion":1,"plugins":[...]}`; see the current catalog for complete entries.

Download hashes and manifest ID/version/type/repository/license are checked before installation. ZIPs are installed locally without executing install scripts. Distribution draws on [Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai) and the [Raycast PR publishing flow](https://developers.raycast.com/basics/publish-an-extension).
