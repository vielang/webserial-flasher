// UPDI Link Layer — low-level byte I/O over a half-duplex single-wire interface.
//
// UPDI uses a single GPIO for both TX and RX (the UPDI pin).  When bytes are
// transmitted, the same bytes are physically looped back to the RX line
// (half-duplex UART echo).  The link layer must:
//
//   1. Write bytes to the transport.
//   2. Read and discard the same N bytes (the TX echo).
//   3. Then read the actual device response.
//
// All public methods handle echo cancellation internally — callers see a clean
// request/response interface.
//
// Reference: Microchip AVR® UPDI Programming Interface Application Note (DS40002312)

import {
  UPDI_SYNC, UPDI_ACK,
  UPDI_LDCS, UPDI_STCS,
  UPDI_LDS, UPDI_STS,
  UPDI_LD, UPDI_ST,
  UPDI_REPEAT, UPDI_KEY,
  UPDI_ADDRESS_16,
  UPDI_DATA_8, UPDI_DATA_16,
  UPDI_PTR, UPDI_PTR_INC,
  UPDI_KEY_SIZE_64,
  UPDI_CTRLA_GT_2,
  UPDI_CS_CTRLA,
} from './constants.js';
import { STK500TimeoutError, STK500ProtocolError } from '../../core/errors.js';
import type { ISTKTransport } from '../../transport/ITransport.js';
import type { Board, Logger } from '../../core/types.js';

// Pre-computed instruction byte constants
const INSTR_LDCS_BASE  = UPDI_LDCS;                                   // 0x80
const INSTR_STCS_BASE  = UPDI_STCS;                                   // 0xC0
const INSTR_LDS_16_8   = UPDI_LDS | (UPDI_ADDRESS_16 << 2) | UPDI_DATA_8;   // 0x04
const INSTR_STS_16_8   = UPDI_STS | (UPDI_ADDRESS_16 << 2) | UPDI_DATA_8;   // 0x44
const INSTR_ST_PTR_16  = UPDI_ST  | (UPDI_PTR     << 2) | UPDI_DATA_16;     // 0x61 (set pointer)
const INSTR_ST_PTR_INC = UPDI_ST  | (UPDI_PTR_INC << 2) | UPDI_DATA_8;      // 0x64
const INSTR_LD_PTR_INC = UPDI_LD  | (UPDI_PTR_INC << 2) | UPDI_DATA_8;      // 0x24
const INSTR_REPEAT_8   = UPDI_REPEAT | UPDI_DATA_8;                   // 0xA0
const INSTR_KEY_64     = UPDI_KEY    | UPDI_KEY_SIZE_64;               // 0xE0

export class UPDILink {
  constructor(
    private readonly transport: ISTKTransport,
    private readonly board: Board,
    private readonly log: Logger
  ) {}

  // ── Private primitives ────────────────────────────────────────────────────

  /**
   * Write bytes and discard the echo (TX loopback).
   * After this returns the transport's receive buffer contains only device
   * responses, not echo bytes.
   */
  async send(bytes: number[]): Promise<void> {
    const data = new Uint8Array(bytes);
    await this.transport.write(data);
    // Discard echo bytes
    await this.receiveExact(data.length);
  }

  /**
   * Receive exactly `count` bytes from the transport.
   * Accumulates chunks until the total reaches `count`, then resolves.
   * Rejects with STK500TimeoutError if the deadline expires.
   */
  receiveExact(count: number): Promise<Uint8Array> {
    if (count === 0) return Promise.resolve(new Uint8Array(0));

    return new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      const chunks: Uint8Array[] = [];
      let received = 0;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.transport.off('data', onData);
        reject(new STK500TimeoutError(this.board.timeout, `UPDI: waiting for ${count} bytes`));
      }, this.board.timeout);

      const onData = (chunk: Uint8Array): void => {
        if (settled) return;
        chunks.push(chunk.slice());
        received += chunk.length;
        if (received >= count) {
          settled = true;
          clearTimeout(timer);
          this.transport.off('data', onData);
          const buf = new Uint8Array(received);
          let off = 0;
          for (const c of chunks) { buf.set(c, off); off += c.length; }
          resolve(buf.subarray(0, count));
        }
      };

      this.transport.on('data', onData);
    });
  }

  // ── CS register access (LDCS / STCS) ─────────────────────────────────────

  /**
   * Read one byte from a UPDI Control/Status register.
   * LDCS sequence: SYNC + (0x80 | addr) → echo 2 bytes → read 1 byte
   */
  async ldcs(addr: number): Promise<number> {
    await this.send([UPDI_SYNC, INSTR_LDCS_BASE | (addr & 0x0F)]);
    const resp = await this.receiveExact(1);
    this.log('debug', `LDCS[0x${addr.toString(16)}] = 0x${resp[0].toString(16).padStart(2, '0')}`);
    return resp[0];
  }

  /**
   * Write one byte to a UPDI Control/Status register.
   * STCS sequence: SYNC + (0xC0 | addr) + val → echo 3 bytes → read 1 ACK
   */
  async stcs(addr: number, val: number): Promise<void> {
    await this.send([UPDI_SYNC, INSTR_STCS_BASE | (addr & 0x0F), val]);
    const ack = await this.receiveExact(1);
    if (ack[0] !== UPDI_ACK) {
      throw new STK500ProtocolError(
        `UPDI STCS[0x${addr.toString(16)}]: expected ACK 0x40, ` +
        `got 0x${ack[0].toString(16).padStart(2, '0')}`
      );
    }
    this.log('debug', `STCS[0x${addr.toString(16)}] = 0x${val.toString(16).padStart(2, '0')}`);
  }

  // ── Data-space access (LDS / STS — 16-bit address, 8-bit data) ───────────

  /**
   * Read one byte from a 16-bit data-space address.
   * LDS sequence: SYNC + 0x04 + addrL + addrH → echo 4 bytes → read 1 byte
   */
  async lds(addr: number): Promise<number> {
    await this.send([UPDI_SYNC, INSTR_LDS_16_8, addr & 0xFF, (addr >> 8) & 0xFF]);
    const resp = await this.receiveExact(1);
    this.log('debug', `LDS[0x${addr.toString(16).padStart(4, '0')}] = 0x${resp[0].toString(16).padStart(2, '0')}`);
    return resp[0];
  }

  /**
   * Write one byte to a 16-bit data-space address.
   * STS sequence:
   *   → SYNC + 0x44 + addrL + addrH → echo 4 bytes → read 1 ACK
   *   → val                           → echo 1 byte  → read 1 ACK
   */
  async sts(addr: number, val: number): Promise<void> {
    // Phase 1: send address
    await this.send([UPDI_SYNC, INSTR_STS_16_8, addr & 0xFF, (addr >> 8) & 0xFF]);
    const ack1 = await this.receiveExact(1);
    if (ack1[0] !== UPDI_ACK) {
      throw new STK500ProtocolError(
        `UPDI STS[0x${addr.toString(16)}] addr ACK: ` +
        `got 0x${ack1[0].toString(16).padStart(2, '0')}`
      );
    }
    // Phase 2: send data (also echoed!)
    await this.send([val]);
    const ack2 = await this.receiveExact(1);
    if (ack2[0] !== UPDI_ACK) {
      throw new STK500ProtocolError(
        `UPDI STS[0x${addr.toString(16)}] data ACK: ` +
        `got 0x${ack2[0].toString(16).padStart(2, '0')}`
      );
    }
    this.log('debug', `STS[0x${addr.toString(16).padStart(4, '0')}] = 0x${val.toString(16).padStart(2, '0')}`);
  }

  // ── Pointer register operations ───────────────────────────────────────────

  /**
   * Load a 16-bit address into the UPDI pointer register.
   * ST(ptr, 16-bit) sequence: SYNC + 0x61 + addrL + addrH → echo 4 bytes → read 1 ACK
   */
  async setPtr(addr: number): Promise<void> {
    await this.send([UPDI_SYNC, INSTR_ST_PTR_16, addr & 0xFF, (addr >> 8) & 0xFF]);
    const ack = await this.receiveExact(1);
    if (ack[0] !== UPDI_ACK) {
      throw new STK500ProtocolError(
        `UPDI SET_PTR(0x${addr.toString(16)}): no ACK ` +
        `(got 0x${ack[0].toString(16).padStart(2, '0')})`
      );
    }
    this.log('debug', `SET_PTR(0x${addr.toString(16).padStart(4, '0')})`);
  }

  /**
   * Write a block of bytes to memory using ST ptr++ (with optional REPEAT).
   *
   * For count > 1, a REPEAT instruction is sent first so the device auto-advances
   * the pointer.  Each byte requires: send byte → discard echo → read ACK.
   */
  async stPtrInc(data: Uint8Array): Promise<void> {
    if (data.length === 0) return;

    // Send REPEAT if more than one byte
    if (data.length > 1) {
      await this.send([UPDI_SYNC, INSTR_REPEAT_8, data.length - 1]);
    }

    // Send ST_PTR_INC instruction
    await this.send([UPDI_SYNC, INSTR_ST_PTR_INC]);

    // Send each data byte — each triggers echo + ACK
    for (let i = 0; i < data.length; i++) {
      await this.send([data[i]]);
      const ack = await this.receiveExact(1);
      if (ack[0] !== UPDI_ACK) {
        throw new STK500ProtocolError(
          `UPDI ST_PTR_INC byte[${i}]: no ACK ` +
          `(got 0x${ack[0].toString(16).padStart(2, '0')})`
        );
      }
    }
    this.log('debug', `ST_PTR_INC(${data.length} bytes)`);
  }

  /**
   * Read a block of bytes using LD ptr++ (with optional REPEAT).
   *
   * For count > 1, a REPEAT is sent first.  The device streams back `count`
   * data bytes directly — no echoes for reads.
   */
  async ldPtrInc(count: number): Promise<Uint8Array> {
    if (count === 0) return new Uint8Array(0);

    // Send REPEAT if more than one byte
    if (count > 1) {
      await this.send([UPDI_SYNC, INSTR_REPEAT_8, count - 1]);
    }

    // Send LD_PTR_INC instruction
    await this.send([UPDI_SYNC, INSTR_LD_PTR_INC]);

    // Device streams back `count` bytes (no echo for device→host direction)
    const result = await this.receiveExact(count);
    this.log('debug', `LD_PTR_INC(${count} bytes)`);
    return result;
  }

  // ── KEY instruction ───────────────────────────────────────────────────────

  /**
   * Broadcast an 8-byte key to unlock NVM or chip-erase operations.
   * KEY sequence: SYNC + 0xE0 + 8 key bytes → echo 10 bytes → no ACK
   */
  async sendKey(key: Uint8Array): Promise<void> {
    if (key.length !== 8) {
      throw new STK500ProtocolError(`UPDI KEY: expected 8-byte key, got ${key.length}`);
    }
    await this.send([UPDI_SYNC, INSTR_KEY_64, ...key]);
    // No ACK for KEY — device just latches the key state
    this.log('debug', `KEY sent (${Array.from(key).map(b => b.toString(16).padStart(2,'0')).join(' ')})`);
  }

  // ── Convenience ───────────────────────────────────────────────────────────

  /**
   * Configure guard time to minimum (2 cycles) for faster communication.
   * Called once after establishing the link.
   */
  async configureGuardTime(): Promise<void> {
    await this.stcs(UPDI_CS_CTRLA, UPDI_CTRLA_GT_2);
  }

  /**
   * Read a contiguous memory region.
   * Internally uses setPtr + ldPtrInc.
   */
  async readMemory(addr: number, size: number): Promise<Uint8Array> {
    await this.setPtr(addr);
    return this.ldPtrInc(size);
  }

  /**
   * Write a contiguous memory region.
   * Internally uses setPtr + stPtrInc.
   */
  async writeMemory(addr: number, data: Uint8Array): Promise<void> {
    await this.setPtr(addr);
    await this.stPtrInc(data);
  }
}
