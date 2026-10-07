const TYPE_NAMES = Object.freeze({
  Voltage: '电压', Current: '电流', Power: '功耗', Clock: '频率', Temperature: '温度',
  Load: '负载', Frequency: '频率', Fan: '风扇', Flow: '流量', Control: '控制', Level: '液位',
  Factor: '系数', Data: '数据量', SmallData: '数据量', Throughput: '吞吐速度', TimeSpan: '时长',
  Timing: '时序', Energy: '能量', Noise: '噪声', Conductivity: '电导率', Humidity: '湿度',
});

const SENSOR_PHRASES = [
  ['CPU Package', 'CPU 封装'], ['CPU Total', 'CPU 总负载'], ['CPU Core', 'CPU 核心'],
  ['CPU Fan', 'CPU 风扇'],
  ['Core Average', '核心平均值'], ['Core Max', '核心最高值'], ['Core Effective Clock', '核心有效频率'],
  ['Core Utility', '核心利用率'], ['Core Power Limit', '核心功耗限制'], ['Core Voltage', '核心电压'],
  ['Distance to TjMax', '距温度上限'], ['TjMax', '温度上限'], ['P-Core', '性能核心'], ['E-Core', '能效核心'],
  ['GPU Hot Spot', 'GPU 热点'], ['GPU Core', 'GPU 核心'], ['GPU Memory Junction', 'GPU 显存结温'],
  ['GPU Memory', 'GPU 显存'], ['GPU Video Engine', 'GPU 视频引擎'], ['GPU Memory Controller', 'GPU 显存控制器'],
  ['GPU Power', 'GPU 功耗'], ['GPU Fan', 'GPU 风扇'], ['GPU Board', 'GPU 整板'], ['GPU Chip', 'GPU 芯片'],
  ['Memory Load', '内存负载'], ['Memory Used', '已用内存'], ['Memory Available', '可用内存'],
  ['Virtual Memory Load', '虚拟内存负载'], ['Virtual Memory Used', '已用虚拟内存'], ['Virtual Memory Available', '可用虚拟内存'],
  ['Used Space', '已用空间'], ['Available Space', '可用空间'], ['Read Activity', '读取活动'],
  ['Write Activity', '写入活动'], ['Total Activity', '总活动'], ['Read Rate', '读取速度'], ['Write Rate', '写入速度'],
  ['Data Read', '已读取数据'], ['Data Written', '已写入数据'], ['Remaining Life', '剩余寿命'],
  ['Upload Speed', '上传速度'], ['Download Speed', '下载速度'], ['Data Uploaded', '已上传数据'], ['Data Downloaded', '已下载数据'],
  ['Battery Charge', '电池电量'], ['Battery Health', '电池健康度'], ['Charge Level', '充电水平'],
  ['Charge Rate', '充电速度'], ['Discharge Rate', '放电速度'], ['Remaining Time', '剩余时间'],
  ['Bus Speed', '总线频率'], ['Memory Clock', '显存频率'], ['Shader Clock', '着色器频率'],
  ['Fan Control', '风扇控制'], ['Power Limit', '功耗限制'], ['Temperature Limit', '温度限制'],
  ['D3D 3D', '3D 图形'], ['D3D Copy', '图形复制'], ['D3D Video Decode', '视频解码'], ['D3D Video Encode', '视频编码'],
  ['Receive Rate', '接收速度'], ['Transmit Rate', '发送速度'], ['Link Speed', '连接速度'],
  ['Package', '封装'], ['Hot Spot', '热点'], ['Junction', '结温'], ['Average', '平均值'], ['Maximum', '最高值'],
  ['Temperature', '温度'], ['Power', '功耗'], ['Voltage', '电压'], ['Current', '电流'], ['Clock', '频率'],
  ['Frequency', '频率'], ['Load', '负载'], ['Usage', '使用率'], ['Utilization', '利用率'], ['Activity', '活动率'],
  ['Control', '控制'], ['Fan', '风扇'], ['Pump', '水泵'], ['Flow', '流量'], ['Noise', '噪声'], ['Humidity', '湿度'],
  ['Memory', '内存'], ['Core', '核心'], ['Thread', '线程'], ['Total', '总计'], ['Used', '已用'], ['Available', '可用'],
  ['Read', '读取'], ['Write', '写入'], ['Receive', '接收'], ['Transmit', '发送'], ['Download', '下载'], ['Upload', '上传'],
  ['Input', '输入'], ['Output', '输出'], ['Battery', '电池'], ['Charge', '充电'], ['Discharge', '放电'],
  ['Remaining', '剩余'], ['Health', '健康度'], ['Space', '空间'], ['Rate', '速度'], ['Time', '时间'], ['Level', '水平'],
];

const HARDWARE_PHRASES = [
  ['Generic Memory', '系统内存'], ['Physical Memory', '物理内存'], ['Virtual Memory', '虚拟内存'],
  ['Network Adapter', '网络适配器'], ['Storage', '存储设备'], ['Motherboard', '主板'], ['Mainboard', '主板'],
  ['Battery', '电池'], ['Power Supply', '电源'], ['Controller', '控制器'], ['Processor', '处理器'],
];

function replacePhrases(value, phrases) {
  let translated = String(value || '');
  for (const [english, chinese] of phrases) {
    translated = translated.replace(new RegExp(escapeRegExp(english), 'gi'), chinese);
  }
  return translated.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function translateType(type) {
  return TYPE_NAMES[type] || '传感器';
}

function translateSensorName(name, type) {
  const translated = replacePhrases(name, SENSOR_PHRASES);
  return /[\u3400-\u9fff]/.test(translated) ? translated : `${translateType(type)} · ${translated || '未命名'}`;
}

function translateHardware(name, identifier = '') {
  const translated = replacePhrases(name, HARDWARE_PHRASES);
  if (/[\u3400-\u9fff]/.test(translated)) return translated;
  const prefixes = [
    ['/cpu', '处理器'], ['/gpu', '显卡'], ['/memory', '内存'], ['/hdd', '存储'], ['/storage', '存储'],
    ['/nic', '网络'], ['/battery', '电池'], ['/psu', '电源'], ['/mainboard', '主板'], ['/motherboard', '主板'], ['/lpc', '主板芯片'],
  ];
  const prefix = prefixes.find(([path]) => String(identifier).toLowerCase().startsWith(path))?.[1] || '硬件';
  return `${prefix} · ${translated || '未知设备'}`;
}

module.exports = { TYPE_NAMES, translateType, translateSensorName, translateHardware };
