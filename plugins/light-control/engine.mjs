import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { LEVELS, smartProFrames } from "./protocols.mjs";

export const DEVICE_IDS = ["justgogo", "lamp2", "lamp3"];

const DEFAULTS = {
  justgogo: { power: false, brightness: 50, kelvin: 4700, preset: false, sequence: "0060" },
  lamp2: { power: false, brightness: 50, kelvin: 4700, preset: false, primarySequence: 0x30, auxiliarySequence: 0x80 },
  lamp3: { power: false, brightness: 50, kelvin: 4700, preset: false, primarySequence: 0x30, auxiliarySequence: 0x80 }
};

function clamp(value, low, high, fallback) {
  return Number.isFinite(Number(value)) ? Math.max(low, Math.min(high, Math.round(Number(value)))) : fallback;
}

function normalizeDevice(id, value = {}) {
  const defaults = DEFAULTS[id];
  return {
    ...defaults,
    power: value.power === undefined ? defaults.power : Boolean(value.power),
    brightness: clamp(value.brightness, id === "justgogo" ? 0 : 25, 100, defaults.brightness),
    kelvin: clamp(value.kelvin, 2700, 6500, defaults.kelvin),
    preset: value.preset === true || value.cct_preset === true,
    sequence: /^[0-9a-f]{4}$/i.test(value.sequence || "") ? value.sequence.toUpperCase() : defaults.sequence,
    primarySequence: clamp(value.primarySequence, 0, 255, defaults.primarySequence),
    auxiliarySequence: clamp(value.auxiliarySequence, 0, 255, defaults.auxiliarySequence),
    busy: false,
    status: "待命",
    error: ""
  };
}

export function nextLevel(levels, current) {
  return levels.find((level) => level > current) ?? levels[0];
}

export class LightEngine {
  constructor({ file, ble, esp, onChange = () => {} }) {
    this.file = file;
    this.ble = ble;
    this.esp = esp;
    this.onChange = onChange;
    let loaded = {};
    if (existsSync(file)) {
      try { loaded = JSON.parse(readFileSync(file, "utf8")); } catch { /* Use defaults. */ }
    }
    if (/^COM\d+$/i.test(loaded.bridgePort || "")) this.esp.preferredPort = loaded.bridgePort;
    this.devices = Object.fromEntries(DEVICE_IDS.map((id) => [id, normalizeDevice(id, loaded.devices?.[id])]));
    this.lanes = new Map();
    this.writeQueue = Promise.resolve();
    this.ready = false;
  }

  save() {
    const data = {
      bridgePort: this.esp.preferredPort,
      devices: Object.fromEntries(DEVICE_IDS.map((id) => {
        const { power, brightness, kelvin, preset, sequence, primarySequence, auxiliarySequence } = this.devices[id];
        return [id, { power, brightness, kelvin, preset, sequence, primarySequence, auxiliarySequence }];
      }))
    };
    const text = JSON.stringify(data, null, 2) + "\n";
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, text);
      try {
        await rename(temporary, this.file);
      } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EEXIST"].includes(error.code) || !existsSync(this.file)) throw error;
        await writeFile(this.file, text);
        await rm(temporary, { force: true });
      }
    });
    return this.writeQueue;
  }

  snapshot() {
    const bridgePort = this.esp.connected ? this.esp.path : "";
    return {
      ok: true,
      app: { ready: this.ready, backend: "studio-node", bridge: bridgePort ? `ESP32：${bridgePort}` : "ESP32：未连接", bridge_port: bridgePort },
      devices: DEVICE_IDS.map((id) => {
        const device = this.devices[id];
        return {
          id,
          name: id === "justgogo" ? "灯1 · JustGoGo" : id === "lamp2" ? "灯2 · Smart Pro" : "灯3 · Smart Pro",
          power: device.power, brightness: device.brightness,
          brightness_min: id === "justgogo" ? 0 : 25,
          kelvin: device.kelvin,
          busy: device.busy, status: device.error || device.status,
          transport: id === "justgogo" ? "computer_bluetooth" : "esp32_usb",
          connection: id === "justgogo" ? (this.ble.connected ? "电脑蓝牙：已连接" : "电脑蓝牙：未连接")
            : (bridgePort ? `ESP32：${bridgePort}` : "ESP32：未连接")
        };
      })
    };
  }

  button(deviceId, kind) {
    const id = deviceId === "smartpro" ? "lamp2" : deviceId;
    const device = this.devices[id];
    if (!device) throw new Error("未选择有效灯具");
    if (kind !== "power" && !device.power) throw new Error("灯已关闭，请先开启");
    if (kind === "power") return this.command({ device: id, action: "power", value: !device.power });
    if (kind === "brightness") return this.command({ device: id, action: "brightness", value: nextLevel(LEVELS.brightness, device.brightness) });
    if (kind === "temperature") return this.command({ device: id, action: id === "justgogo" ? "kelvin" : "preset", value: nextLevel(LEVELS.temperature, device.kelvin) });
    throw new Error("未知灯控动作");
  }

  command({ device: requestedId, action, value, brightness, kelvin }) {
    if (!this.ready) throw new Error("Studio 灯控尚未接管设备");
    const id = requestedId === "smartpro" ? "lamp2" : requestedId;
    const current = this.devices[id];
    if (!current) throw new Error("未知设备");
    const desired = { power: current.power, brightness: current.brightness, kelvin: current.kelvin, preset: current.preset };
    if (action === "power") {
      if (typeof value !== "boolean") throw new Error("电源值无效");
      desired.power = value;
    } else if (action === "brightness") {
      desired.brightness = this.#number(value, id === "justgogo" ? 0 : 25, 100, "亮度");
    } else if (action === "kelvin" || action === "preset") {
      desired.kelvin = this.#number(value, 2700, 6500, "色温");
      desired.preset = action === "preset";
    } else if (action === "apply") {
      desired.brightness = this.#number(brightness, id === "justgogo" ? 0 : 25, 100, "亮度");
      desired.kelvin = this.#number(kelvin, 2700, 6500, "色温");
      desired.preset = false;
    } else {
      throw new Error("不支持的动作");
    }
    if (action !== "power" && !desired.power) throw new Error("灯已关闭，请先开启");
    Object.assign(current, desired, { error: "", status: "等待发送" });
    this.onChange();
    return this.#enqueue(id, { action: action === "power" ? "power" : "set", desired });
  }

  #number(value, low, high, name) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < low || number > high) throw new Error(`${name}值无效`);
    return number;
  }

  #enqueue(id, job) {
    let lane = this.lanes.get(id);
    if (!lane) { lane = { active: false, pending: null }; this.lanes.set(id, lane); }
    const task = new Promise((resolve, reject) => {
      const next = { ...job, resolve, reject };
      if (lane.active) {
        lane.pending?.resolve({ superseded: true });
        lane.pending = next;
      } else {
        void this.#run(id, lane, next);
      }
    });
    return task;
  }

  async #run(id, lane, job) {
    lane.active = true;
    const device = this.devices[id];
    device.busy = true;
    device.status = "正在发送";
    this.onChange();
    try {
      await this.save();
      if (id === "justgogo") {
        try {
          await this.ble.send(job.action, { ...job.desired, sequence: device.sequence }, (sequence) => {
            device.sequence = sequence;
            void this.save();
          });
        } finally {
          await this.writeQueue;
        }
      } else {
        const sequence = { primary: device.primarySequence, auxiliary: device.auxiliarySequence };
        device.primarySequence = (device.primarySequence + 1) & 255;
        device.auxiliarySequence = (device.auxiliarySequence + 1) & 255;
        await this.save();
        const frames = smartProFrames({
          action: job.action === "power" ? (job.desired.power ? "on" : "off") : "set",
          deviceId: id === "lamp2" ? 1 : 2,
          brightness: job.desired.brightness, kelvin: job.desired.kelvin, preset: job.desired.preset,
          primarySequence: sequence.primary, auxiliarySequence: sequence.auxiliary
        });
        await this.esp.send(frames, { device: id });
      }
      device.status = "命令已发送";
      job.resolve({ ok: true });
    } catch (error) {
      device.error = error.message;
      device.status = "发送失败";
      job.reject(error);
    } finally {
      device.busy = false;
      lane.active = false;
      const pending = lane.pending;
      lane.pending = null;
      this.onChange();
      if (pending) void this.#run(id, lane, pending);
    }
  }
}
