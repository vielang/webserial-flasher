// Minimal in-process transport for unit and integration tests.
// Simulates a device that generates the expected response for each command.

import type { ISTKTransport, SerialSignals } from '../../src/transport/ITransport.js';

export type ResponseGenerator = (cmd: Uint8Array) => Uint8Array | null;

export class MockTransport implements ISTKTransport {
  private readonly listeners = new Set<(data: Uint8Array) => void>();
  public readonly writtenBytes: Uint8Array[] = [];
  public signalHistory: SerialSignals[] = [];
  public breakCount = 0;
  private responseQueue: Uint8Array[] = [];
  private responseGen: ResponseGenerator | null = null;

  /**
   * Enable half-duplex echo simulation for UPDI tests.
   * When true, every write() emits the same bytes back as echo before the response.
   */
  public echoEnabled = false;

  /** Queue a fixed response that will be emitted after the next write */
  queueResponse(response: Uint8Array): void {
    this.responseQueue.push(response);
  }

  /** Set a generator function that produces a response for each command */
  setResponseGenerator(gen: ResponseGenerator): void {
    this.responseGen = gen;
  }

  async write(data: Uint8Array): Promise<void> {
    this.writtenBytes.push(new Uint8Array(data));

    let response: Uint8Array | null = null;
    if (this.responseQueue.length > 0) {
      response = this.responseQueue.shift()!;
    } else if (this.responseGen) {
      response = this.responseGen(data);
    }

    if (this.echoEnabled) {
      // Emit echo first, then response in a nested setTimeout to preserve ordering
      const echoBytes    = new Uint8Array(data);
      const responseBytes = response ? new Uint8Array(response) : null;
      setTimeout(() => {
        this.listeners.forEach((fn) => fn(echoBytes));
        if (responseBytes) {
          // Response arrives after echo
          setTimeout(() => {
            this.listeners.forEach((fn) => fn(responseBytes));
          }, 0);
        }
      }, 0);
    } else if (response) {
      // Non-echo mode: emit response directly
      setTimeout(() => {
        this.listeners.forEach((fn) => fn(response!));
      }, 0);
    }
  }

  async sendBreak(): Promise<void> {
    this.breakCount++;
  }

  on(_event: 'data', handler: (chunk: Uint8Array) => void): void {
    this.listeners.add(handler);
  }

  off(_event: 'data', handler: (chunk: Uint8Array) => void): void {
    this.listeners.delete(handler);
  }

  async setSignals(opts: SerialSignals): Promise<void> {
    this.signalHistory.push({ ...opts });
  }

  async close(): Promise<void> {
    this.listeners.clear();
    this.responseQueue.length = 0;
  }

  /** Manually push data (simulates unsolicited device output) */
  push(data: Uint8Array): void {
    this.listeners.forEach((fn) => fn(data));
  }

  /** Reset all state between test cases */
  reset(): void {
    this.writtenBytes.length = 0;
    this.signalHistory.length = 0;
    this.responseQueue.length = 0;
    this.breakCount = 0;
    this.echoEnabled = false;
    this.responseGen = null;
    this.listeners.clear();
  }
}

// ── STK500v1 convenience responses ─────────────────────────────────────────

/** Standard OK_RESPONSE: [INSYNC(0x14), OK(0x10)] */
export const OK = new Uint8Array([0x14, 0x10]);

/** Signature response for ATmega328P: [INSYNC, 0x1e, 0x95, 0x0f, OK] */
export const ATMEGA328P_SIG_RESPONSE = new Uint8Array([0x14, 0x1e, 0x95, 0x0f, 0x10]);

/** Build a read-page response: [INSYNC, ...data..., OK] */
export function buildPageResponse(data: Uint8Array): Uint8Array {
  const response = new Uint8Array(data.length + 2);
  response[0] = 0x14; // INSYNC
  response.set(data, 1);
  response[data.length + 1] = 0x10; // OK
  return response;
}

// ── STK500v2 convenience helpers ────────────────────────────────────────────
//
// All STK500v2 responses must be properly framed with:
//   [MSG_START(0x1B)] [seq] [sizeH] [sizeL] [TOKEN(0x0E)] [body...] [checksum]
//
// The seq byte in the response MUST match the seq from the request.

const V2_MSG_START = 0x1B;
const V2_TOKEN     = 0x0E;

/**
 * Build a properly-framed STK500v2 response frame.
 * @param seq   Sequence number (copy from the request frame at offset 1)
 * @param body  Response body bytes
 */
export function buildV2Frame(seq: number, body: number[]): Uint8Array {
  const size  = body.length;
  const frame = new Uint8Array(6 + size);
  frame[0] = V2_MSG_START;
  frame[1] = seq & 0xFF;
  frame[2] = (size >> 8) & 0xFF;
  frame[3] = size & 0xFF;
  frame[4] = V2_TOKEN;
  for (let i = 0; i < size; i++) frame[5 + i] = body[i];
  let checksum = 0;
  for (let i = 0; i < 5 + size; i++) checksum ^= frame[i];
  frame[5 + size] = checksum;
  return frame;
}

/** Extract the sequence number from an incoming STK500v2 request frame */
export function v2RequestSeq(frame: Uint8Array): number {
  return frame[1] ?? 0;
}

/** Extract the command byte from an incoming STK500v2 request frame */
export function v2RequestCmd(frame: Uint8Array): number {
  return frame[5] ?? 0; // body starts at offset 5
}

/** Build a standard 2-byte OK response for a given command */
export function buildV2OkResponse(seq: number, cmd: number): Uint8Array {
  return buildV2Frame(seq, [cmd, 0x00]); // STATUS_CMD_OK = 0x00
}

/** Build a SIGN_ON response with a given programmer name */
export function buildV2SignOnResponse(seq: number, name = 'AVRISP_MK2'): Uint8Array {
  const nameBytes = Array.from(name).map((c) => c.charCodeAt(0));
  return buildV2Frame(seq, [0x01, 0x00, nameBytes.length, ...nameBytes]);
}

/**
 * Build a READ_SIGNATURE_ISP response.
 * The byte index is at frame offset 10 (body[5] = cmd3 = byte index).
 */
export function buildV2SignatureResponse(
  seq: number,
  sig: [number, number, number],
  byteIdx: number
): Uint8Array {
  return buildV2Frame(seq, [0x1B, 0x00, 0x00, sig[byteIdx] ?? 0, 0x00]);
}

/** Build a READ_FLASH_ISP response with given data bytes */
export function buildV2FlashReadResponse(seq: number, data: Uint8Array): Uint8Array {
  return buildV2Frame(seq, [0x14, 0x00, ...data, 0x00]);
}

// ── ATmega2560 signature ────────────────────────────────────────────────────

export const ATMEGA2560_SIG: [number, number, number] = [0x1e, 0x98, 0x01];

/**
 * Build a complete response generator for a successful STK500v2 bootload
 * against the Arduino Mega 2560.
 * @param verifyData  Data to return for READ_FLASH_ISP (for verify phase)
 */
export function makeV2SuccessGenerator(
  verifyData: Uint8Array
): ResponseGenerator {
  return (frame: Uint8Array): Uint8Array | null => {
    // All STK500v2 requests start with 0x1B
    if (frame[0] !== V2_MSG_START || frame[4] !== V2_TOKEN) return null;

    const seq = v2RequestSeq(frame);
    const cmd = v2RequestCmd(frame);

    switch (cmd) {
      case 0x01: // CMD_SIGN_ON
        return buildV2SignOnResponse(seq);

      case 0x04: // CMD_SET_DEVICE_DESCRIPTOR
      case 0x06: // CMD_LOAD_ADDRESS
      case 0x10: // CMD_ENTER_PROGMODE_ISP
      case 0x11: // CMD_LEAVE_PROGMODE_ISP
      case 0x12: // CMD_CHIP_ERASE_ISP
      case 0x13: // CMD_PROGRAM_FLASH_ISP
        return buildV2OkResponse(seq, cmd);

      case 0x1B: { // CMD_READ_SIGNATURE_ISP — byte index at body[5] = frame[10]
        const byteIdx = frame[10] ?? 0;
        return buildV2SignatureResponse(seq, ATMEGA2560_SIG, byteIdx);
      }

      case 0x14: { // CMD_READ_FLASH_ISP — return verifyData
        // Decode requested size from body[1..2] = frame[6..7]
        const size = ((frame[6] ?? 0) << 8) | (frame[7] ?? 0);
        const data = verifyData.subarray(0, size);
        // Pad with 0xFF if verifyData is shorter than requested
        if (data.length < size) {
          const padded = new Uint8Array(size).fill(0xFF);
          padded.set(data);
          return buildV2FlashReadResponse(seq, padded);
        }
        return buildV2FlashReadResponse(seq, data);
      }

      default:
        return null;
    }
  };
}

// ── AVR109 convenience helpers ──────────────────────────────────────────────
//
// AVR109 responses are simple: CR (0x0D) for most commands, raw bytes for data.

/** CR byte = standard acknowledge in AVR109 protocol */
export const AVR109_CR = new Uint8Array([0x0D]);

/** ATmega32U4 signature bytes (MSB first as returned by 's' command) */
export const ATMEGA32U4_SIG_BYTES = new Uint8Array([0x87, 0x95, 0x1e]); // reversed

/**
 * Build a response generator for a successful AVR109 bootload sequence.
 * @param verifyData  Data to return for block reads (verify phase)
 */
export function makeAVR109SuccessGenerator(
  verifyData: Uint8Array
): ResponseGenerator {
  return (cmd: Uint8Array): Uint8Array | null => {
    const opcode = cmd[0];

    switch (opcode) {
      case 0x53: // 'S' — software identifier
        return new TextEncoder().encode('CATERIN');

      case 0x50: // 'P' — enter prog mode
      case 0x45: // 'E' — leave prog mode
      case 0x65: // 'e' — chip erase
      case 0x41: // 'A' — set address
        return AVR109_CR;

      case 0x73: // 's' — read signature (3 bytes, MSB first)
        return ATMEGA32U4_SIG_BYTES.slice();

      case 0x42: { // 'B' — block write
        // body: ['B', sizeH, sizeL, memType, data...]
        return AVR109_CR;
      }

      case 0x67: { // 'g' — block read
        // body: ['g', sizeH, sizeL, memType]
        const size = ((cmd[1] ?? 0) << 8) | (cmd[2] ?? 0);
        const data = verifyData.subarray(0, size);
        if (data.length < size) {
          const padded = new Uint8Array(size).fill(0xFF);
          padded.set(data);
          return padded;
        }
        return data.slice();
      }

      default:
        return null;
    }
  };
}

// ── UPDI convenience helpers ────────────────────────────────────────────────
//
// UPDI uses half-duplex echo: set transport.echoEnabled = true in tests.
// The response generator receives the written bytes and should return the
// device's actual response (echo is handled automatically by MockTransport).

export const UPDI_ACK_BYTE = new Uint8Array([0x40]);

/** ATtiny416 signature stored in SIGROW[0..2] */
export const ATTINY416_SIG  = new Uint8Array([0x1e, 0x92, 0x21]);
/** ATmega4809 UPDI signature */
export const ATMEGA4809_SIG = new Uint8Array([0x1e, 0x96, 0x51]);

/**
 * Build a stateful UPDI response generator for a successful bootload.
 *
 * Tracks the current pointer (set by SET_PTR 0x61) to return the correct
 * data for SIGROW reads vs flash reads during LD_PTR_INC.
 *
 * @param sig         3-byte device signature (returned when reading SIGROW 0x1100)
 * @param verifyData  Data returned for flash LD_PTR_INC reads (verify phase)
 */
export function makeUPDISuccessGenerator(
  sig: Uint8Array,
  verifyData: Uint8Array
): ResponseGenerator {
  let currentPtr = 0; // tracks last SET_PTR value

  return (data: Uint8Array): Uint8Array | null => {
    if (data.length === 0) return null;

    const sync  = data[0];
    const instr = data[1];

    // Single byte write (data phase of STS or ST_PTR_INC) → ACK
    if (sync !== 0x55) {
      return UPDI_ACK_BYTE.slice();
    }

    if (instr === undefined) return null;

    // LDCS (0x80–0x8F): read CS register
    if ((instr & 0xF0) === 0x80) {
      const addr = instr & 0x0F;
      switch (addr) {
        case 0x00: return new Uint8Array([0x82]); // STATUSA: OK
        case 0x07: return new Uint8Array([0x10]); // ASI_KEY_STATUS: NVMPROG set
        case 0x0B: return new Uint8Array([0x08]); // ASI_SYS_STATUS: NVMPROG (not locked)
        default:   return new Uint8Array([0x00]);
      }
    }

    // STCS (0xC0–0xCF): write CS register → ACK
    if ((instr & 0xF0) === 0xC0) return UPDI_ACK_BYTE.slice();

    // LDS 16-bit, 1 byte (0x04): single byte read from data space
    if (instr === 0x04) {
      const addr = ((data[3] ?? 0) << 8) | (data[2] ?? 0);
      if (addr === 0x1002) return new Uint8Array([0x00]); // NVM_STATUS: not busy
      if (addr >= 0x1100 && addr <= 0x1102) return new Uint8Array([sig[addr - 0x1100] ?? 0]);
      return new Uint8Array([0x00]);
    }

    // STS 16-bit, 1 byte (0x44) → ACK for address phase
    if (instr === 0x44) return UPDI_ACK_BYTE.slice();

    // SET_PTR: ST ptr 16-bit (0x61) → ACK, and track the pointer
    if (instr === 0x61) {
      currentPtr = ((data[3] ?? 0) << 8) | (data[2] ?? 0);
      return UPDI_ACK_BYTE.slice();
    }

    // REPEAT (0xA0): no response
    if (instr === 0xA0) return null;

    // KEY (0xE0): no response
    if (instr === 0xE0) return null;

    // ST_PTR_INC (0x64): no immediate response (each data byte ACKed individually)
    if (instr === 0x64) return null;

    // LD_PTR_INC (0x24): return data based on current pointer
    if (instr === 0x24) {
      // SIGROW read (0x1100): return signature
      if (currentPtr >= 0x1100 && currentPtr < 0x1110) {
        const offset = currentPtr - 0x1100;
        const result = new Uint8Array(3);
        result.set(sig.subarray(offset, offset + 3));
        return result;
      }
      // EEPROM or other small reads: return zeros
      if (currentPtr >= 0x1400 && currentPtr < 0x1500) {
        return new Uint8Array(16).fill(0xFF);
      }
      // Flash read: return verifyData
      return verifyData.length > 0
        ? verifyData.subarray(0, Math.min(verifyData.length, 128)).slice()
        : new Uint8Array(1).fill(0xFF);
    }

    return null;
  };
}
