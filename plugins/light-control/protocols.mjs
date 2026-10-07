import { randomBytes } from "node:crypto";

let DEVICE_ADDRESS = null;
const XBOXES = Buffer.from(
  "B7FD9326363FF7CC34A5E5F171D83115" +
  "04C723C31896059A071280E2EB27B275" +
  "D0EFAAFB434D338545F9027F503C9FA8" +
  "51A3408F929D38F5BCB6DA2110FFF3D2" +
  "E0323A0A4906245CC2D3AC629195E479" +
  "E7C8376D8DD54EA96C56F4EA657AAE08" +
  "E1F8981169D98E949B1E87E9CE5528DF" +
  "8CA1890DBFE6426841992D0FB054BB16", "hex"
);

export const LEVELS = {
  brightness: [25, 50, 75, 100],
  temperature: [2700, 4000, 5500, 6500]
};

export function crc16(data, offset, length, initial) {
  let crc = initial & 0xffff;
  for (let index = offset; index < offset + length; index++) {
    crc ^= data[index] << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function reverseByte(value) {
  value = ((value & 0xf0) >>> 4) | ((value & 0x0f) << 4);
  value = ((value & 0xcc) >>> 2) | ((value & 0x33) << 2);
  return ((value & 0xaa) >>> 1) | ((value & 0x55) << 1);
}

function radioEncode(raw) {
  let state = 0x53;
  const prefixed = Buffer.concat([Buffer.alloc(13), Buffer.from([...raw].map(reverseByte))]);
  const output = Buffer.alloc(prefixed.length);
  for (let index = 0; index < prefixed.length; index++) {
    const value = prefixed[index];
    let encoded = 0;
    for (let bit = 0; bit < 8; bit++) {
      const whiteningBit = (state & 0x40) >>> 6;
      encoded |= (value ^ (whiteningBit << bit)) & (1 << bit);
      const feedback = (state << 1) >>> 7 & 1;
      state = ((state << 1) & 0xfe) | feedback;
      state = (state & 0xef) | ((state ^ (feedback << 4)) & 0x10);
    }
    output[index] = encoded;
  }
  return output.subarray(13);
}

function checkByte(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError(`${name} must be a byte`);
}

function phonePacket(sequence, command, channels, mode, nonce, secondary) {
  if (!DEVICE_ADDRESS) throw new Error('Configure smartProAddress in .device-profile/lights-connection.json');
  for (const [name, value] of Object.entries({ sequence, command, cool: channels[0], warm: channels[1], mode, nonce })) {
    checkByte(value, name);
  }
  if (mode > 15) throw new RangeError("mode must be 0..15");
  const message = Buffer.alloc(secondary ? 22 : 24);
  message[0] = DEVICE_ADDRESS[0] & 0x80 ? 0xaa : 0;
  DEVICE_ADDRESS.copy(message, 1);
  message[6] = DEVICE_ADDRESS[4];
  message[7] = DEVICE_ADDRESS[4];
  message[8] = command;
  message[9] = 0x61;
  message[10] = 0x50 | mode;
  message[11] = channels[0];
  message[12] = channels[1];
  message[14] = sequence;
  message[16] = 0xfa ^ nonce;
  message[17] = nonce;
  message[19] = nonce;
  message.writeUInt16BE(crc16(message, 8, 12, ~nonce), 20);
  if (secondary) return radioEncode(Buffer.concat([Buffer.from("710F55", "hex"), message, Buffer.from([0xaa])]));
  let crc = crc16(message, 1, 5, 0xffff);
  crc = crc16(message, 8, 14, crc);
  message.writeUInt16BE(crc, 22);
  return radioEncode(Buffer.concat([Buffer.alloc(2), message]));
}

export function smartProPhonePackets(sequence, command, channels, mode, nonces = [randomBytes(1)[0], randomBytes(1)[0]]) {
  return [
    phonePacket(sequence, command, channels, mode, nonces[0], false),
    phonePacket(sequence, command, channels, mode, nonces[1], true)
  ];
}

export function smartProAuxiliary(sequence, mode, channels, command = 0x21) {
  for (const [name, value] of Object.entries({ sequence, mode, cool: channels[0], warm: channels[1], command })) checkByte(value, name);
  if (mode > 2) throw new RangeError("Smart Pro mode must be 0..2");
  const packet = Buffer.alloc(31);
  Buffer.from("0201021B16F0081080", "hex").copy(packet);
  packet[10] = sequence;
  packet[12] = 0x02;
  packet.writeUInt32LE(0x13575a61, 13);
  packet[17] = mode;
  packet[18] = command;
  packet[22] = channels[0];
  packet[23] = channels[1];
  packet.writeUInt16LE(0x4567, 27);
  const randomByte = packet[27];
  const quadrant = packet[8] & 3;
  for (let position = 9; position < 27; position++) {
    packet[position] ^= XBOXES[quadrant * 32 + ((randomByte + position) & 31)] ^ randomByte;
  }
  packet.writeUInt16LE(crc16(packet, 7, 22, ~0x4567), 29);
  return packet;
}

function roundEven(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (Math.abs(fraction - 0.5) < 1e-10) return floor % 2 ? floor + 1 : floor;
  return Math.round(value);
}

export function smartProChannels(brightness, kelvin, preset = true) {
  if (!Number.isInteger(brightness) || brightness < 25 || brightness > 100) throw new RangeError("brightness must be 25..100");
  if (!Number.isInteger(kelvin) || kelvin < 2700 || kelvin > 6500) throw new RangeError("kelvin must be 2700..6500");
  const maximum = brightness <= 50 ? 42 + roundEven((brightness - 25) * 65 / 25)
    : brightness <= 75 ? 107 + roundEven((brightness - 50) * 65 / 25)
      : 172 + roundEven((brightness - 75) * 66 / 25);
  if (preset) {
    const position = { 2700: 0, 4000: 8, 5500: 21, 6500: 33 }[kelvin];
    if (position === undefined) throw new RangeError("unsupported Smart Pro preset");
    return [roundEven(maximum * position / 60), maximum];
  }
  if (kelvin <= 4600) return [roundEven(maximum * (kelvin - 2700) / 1900), maximum];
  return [maximum, roundEven(maximum * (6500 - kelvin) / 1900)];
}

let POWER_PACKETS = {};

const ADV_PREFIX = Buffer.from("0201011B03", "hex");

export function smartProFrames({ action, deviceId, brightness, kelvin, preset = true, primarySequence, auxiliarySequence, nonces }) {
  if (![1, 2].includes(deviceId)) throw new RangeError("Smart Pro device ID must be 1 or 2");
  let payloads;
  if (action === "on" || action === "off") {
    if (!POWER_PACKETS[`${deviceId}:${action === "on"}`]) throw new Error('Configure smartProPowerPackets in .device-profile/lights-connection.json');
    payloads = POWER_PACKETS[`${deviceId}:${action === "on"}`].map((hex) => Buffer.from(hex, "hex"));
  } else if (action === "set") {
    const channels = smartProChannels(brightness, kelvin, preset);
    const [primary, secondary] = smartProPhonePackets(primarySequence, 0x21, channels, deviceId, nonces);
    const auxiliary = smartProAuxiliary(auxiliarySequence, deviceId, channels);
    payloads = [primary, auxiliary.subarray(5), secondary];
  } else {
    throw new RangeError("Smart Pro action must be on, off or set");
  }
  if (payloads.some((payload) => payload.length !== 26)) throw new Error("Smart Pro frame length mismatch");
  return payloads.map((payload) => Buffer.concat([ADV_PREFIX, payload]));
}

let JUSTGOGO_TOKEN = null;

export function justGoGoPacket(payload, sequence) {
  if (!JUSTGOGO_TOKEN) throw new Error('Configure justGoGoToken in .device-profile/lights-connection.json');
  if (sequence.length !== 2 || !payload.length) throw new RangeError("invalid JustGoGo packet");
  const body = Buffer.concat([Buffer.from([0, 0xff, 0]), Buffer.from(sequence), JUSTGOGO_TOKEN, Buffer.from(payload), Buffer.alloc(1)]);
  body[body.length - 1] = (0x40 + [...payload].reduce((sum, byte) => sum + byte, 0)) & 0xff;
  const length = body.length + 3;
  body[0] = length - 3;
  body[2] = length - 2;
  const checksum = ([...body].reduce((sum, byte) => sum + byte, 0) - 3) & 0xff;
  return Buffer.concat([Buffer.from([0x88, 0x99]), body, Buffer.from([checksum])]);
}

export function justGoGoPower(on, sequence) {
  return justGoGoPacket(Buffer.from([0x00, 0x01, Number(Boolean(on))]), sequence);
}

export function justGoGoCctMode(sequence) {
  return justGoGoPacket(Buffer.from([0x26, 0x01, 0x01]), sequence);
}

export function justGoGoCct(brightness, kelvin, sequence) {
  if (!Number.isInteger(brightness) || brightness < 0 || brightness > 100 || !Number.isInteger(kelvin) || kelvin < 2700 || kelvin > 6500) {
    throw new RangeError("invalid JustGoGo CCT values");
  }
  const payload = Buffer.from([0x14, 0x04, brightness, kelvin >>> 8, kelvin & 0xff, 0x64]);
  return justGoGoPacket(payload, sequence);
}

export function nextJustGoGoSequence(sequence) {
  if (sequence.length !== 2 || sequence[1] < 0x60 || sequence[1] > 0x7f) throw new RangeError("invalid JustGoGo sequence");
  return Buffer.from(sequence[1] === 0x7f ? [(sequence[0] + 0x40) & 0xff, 0x60] : [sequence[0], sequence[1] + 1]);
}

export function configureIdentity(config = {}) {
  DEVICE_ADDRESS = config.smartProAddress ? Buffer.from(config.smartProAddress, 'hex') : null;
  JUSTGOGO_TOKEN = config.justGoGoToken ? Buffer.from(config.justGoGoToken, 'hex') : null;
  POWER_PACKETS = config.smartProPowerPackets || {};
}
