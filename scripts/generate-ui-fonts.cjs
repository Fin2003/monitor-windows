// Generates the device UI type scale from one family (Noto Sans SC, prepared by scripts/prepare-ui-fonts.py).
// Text fonts cover GB2312 level 1 plus every CJK character used by the firmware and host;
// display fonts cover only ASCII, symbols and that vocabulary and fall back to 20 px text.
// There is deliberately no full-range CJK font: the app's read-only data is copied into PSRAM,
// which must also hold three 1.2 MB RGB framebuffers (see README.md).
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fontDir = process.env.UI_FONT_DIR || path.join(root, '.tools/fonts');
const outputDir = path.join(root, 'firmware/monitor-5b/main/fonts');
const converter = path.join(root, 'node_modules/lv_font_conv/lv_font_conv.js');

const vocabularySources = [
  'firmware/monitor-5b/main/monitor_ui.c',
  'firmware/monitor-5b/main/monitor_pages.c',
  'firmware/monitor-5b/main/monitor_dashboard.c',
  'firmware/monitor-5b/main/main.c',
  'plugins/tibo-radar/presentation.cjs',
  'plugins/system-monitor/runtime/sensor-translator.js',
  'plugins/system-monitor/runtime/fan-display.js',
  'plugins/system-monitor/runtime/memory-display.js',
  'plugins/system-monitor/runtime/vram-display.js',
  'plugins/system-monitor/runtime/hardware-display.js',
  ...fs.readdirSync(path.join(root, 'electron/esp32')).filter(name => name.endsWith('.cjs')).map(name => 'electron/esp32/' + name),
];

const isCjk = value => (value >= 0x3000 && value <= 0x9fff) || (value >= 0xff00 && value <= 0xffef);
const vocabulary = new Set();
for (const file of vocabularySources) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  for (const char of fs.readFileSync(full, 'utf8')) if (isCjk(char.codePointAt(0))) vocabulary.add(char);
}

const gb2312 = new Set();
const decoder = new TextDecoder('gbk');
for (let high = 0xb0; high <= 0xd7; high++) {
  for (let low = 0xa1; low <= 0xfe; low++) {
    if (high === 0xd7 && low > 0xf9) continue;
    const char = decoder.decode(new Uint8Array([high, low]));
    if ([...char].length === 1 && char !== '\ufffd') gb2312.add(char);
  }
}

const symbols = '0x20-0x7E,0xA9,0xAE,0xB0,0xB7,0xD7,0x2013,0x2014,0x2018-0x201F,0x2022,0x2026,0x2032,0x2033,0x20AC,0x2122,0x2190-0x2193,0x2248,0x2264,0x2265,0x3001,0x3002,0x300C-0x300F,0xFF08,0xFF09,0xFF0C,0xFF1A,0xFF1F';
const ranges = chars => [...chars].map(char => '0x' + char.codePointAt(0).toString(16)).join(',');
const textSet = new Set([...gb2312, ...vocabulary]);

const fonts = [
  { name: 'ui_font_14r', weight: 'Regular', size: 14, chars: textSet },
  { name: 'ui_font_16r', weight: 'Regular', size: 16, chars: textSet },
  { name: 'ui_font_16m', weight: 'Medium', size: 16, chars: vocabulary, kerning: true, fallback: 'ui_font_16r' },
  { name: 'ui_font_20r', weight: 'Regular', size: 20, chars: textSet },
  { name: 'ui_font_20m', weight: 'Medium', size: 20, chars: vocabulary, kerning: true, fallback: 'ui_font_20r' },
  { name: 'ui_font_26b', weight: 'Bold', size: 26, chars: vocabulary, fallback: 'ui_font_20r' },
  { name: 'ui_font_32b', weight: 'Bold', size: 32, chars: vocabulary, kerning: true, fallback: 'ui_font_20r' },
  { name: 'ui_font_44b', weight: 'Bold', size: 44, chars: vocabulary, kerning: true, fallback: 'ui_font_20r' },
  { name: 'ui_font_64b', weight: 'Bold', size: 64, chars: vocabulary, kerning: true, fallback: 'ui_font_20r' },
];

fs.mkdirSync(outputDir, { recursive: true });
console.log(`vocabulary ${vocabulary.size}, text set ${textSet.size}`);
for (const font of fonts) {
  const output = path.join(outputDir, font.name + '.c');
  const args = [
    converter,
    '--font', path.join(fontDir, `NotoSansSC_${font.weight}.ttf`),
    '--size', String(font.size), '--bpp', '4', '--format', 'lvgl', '--no-compress',
    '--range', symbols + ',' + ranges(font.chars),
    '--lv-font-name', font.name,
    '--output', output,
  ];
  if (font.fallback) args.push('--lv-fallback', font.fallback);
  if (!font.kerning) args.push('--no-kerning');
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
  fs.writeFileSync(output, fs.readFileSync(output, 'utf8').replace(/^ \* Opts:.*$/m, ' * Generated from Noto Sans SC; see firmware/fonts/LICENSE.'));
  console.log(`${font.name}: ${(fs.statSync(output).size / 1048576).toFixed(1)} MiB source`);
}
