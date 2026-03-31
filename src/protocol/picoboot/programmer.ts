// PICOBOOT programmer for Raspberry Pi Pico (RP2040) and Pico 2 (RP2350).
//
// Protocol reference:
//   https://github.com/raspberrypi/picotool/blob/master/picoboot_connection/picoboot_connection.c
//   https://github.com/raspberrypi/pico-sdk/blob/master/src/common/boot_picoboot_headers/include/boot/picoboot.h
//
// Flash sequence:
//   1. EXCLUSIVE_ACCESS(1)  — take exclusive control, disable MSD drive
//   2. EXIT_XIP             — exit execute-in-place mode (required before erase/write)
//   3. FLASH_ERASE(addr, size)  — erase sectors (4KB-aligned)
//   4. WRITE(addr, data)        — write pages (256-byte-aligned)
//   5. REBOOT(0, 0, 500)        — reboot from flash
//
// Addressing: PICOBOOT uses offset-0 flash addressing.
//   XIP 0x10001000 → PICOBOOT addr 0x00001000

import type { IPicobootTransport } from '../../transport/IPicobootTransport.js';
import type { BootloadProgressCallback, STK500Options, Logger } from '../../core/types.js';
import { STK500ProtocolError, STK500VerifyError } from '../../core/errors.js';
import {
  PICOBOOT_MAGIC, PICOBOOT_CMD_SIZE, PICOBOOT_STATUS_SIZE,
  PicobootCmd, PicobootStatus,
  FLASH_SECTOR_SIZE, FLASH_PAGE_SIZE,
  RP2040_FLASH_BASE, RP2040_FLASH_ADDR_MASK,
} from './constants.js';
import { parseUf2, binaryToUf2, isUf2 } from './uf2.js';

// ── PicoBoot class ──────────────────────────────────────────────────────────

export class PicoBoot {
  private readonly transport: IPicobootTransport;
  private readonly log: Logger;
  private token = 1;

  constructor(transport: IPicobootTransport, opts?: STK500Options) {
    this.transport = transport;
    if (opts?.quiet) {
      this.log = () => {};
    } else if (opts?.logger) {
      this.log = opts.logger;
    } else {
      this.log = (level, msg) => console.log(`[arduino-flasher:picoboot] [${level}] ${msg}`);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Flash firmware to the RP2040 / RP2350.
   *
   * Accepts either a UF2 file (detected by magic bytes) or a raw binary.
   * Raw binaries are assumed to start at XIP base 0x10000000 unless
   * `opts.baseAddr` is specified.
   *
   * @param data      UF2 file or raw binary as Uint8Array
   * @param progress  Optional progress callback (status, 0–100)
   * @param opts      Optional: baseAddr (for raw binary), verify (default: true)
   */
  async bootload(
    data:     Uint8Array,
    progress?: BootloadProgressCallback,
    opts?:    { baseAddr?: number; verify?: boolean },
  ): Promise<void> {
    const report = (status: string, pct: number): void => {
      this.log('info', `${status} (${pct}%)`);
      progress?.(status, pct);
    };

    // ── 1. Parse input ────────────────────────────────────────────────────────
    report('Parsing firmware', 0);
    let binary:   Uint8Array;
    let baseAddr: number;

    if (isUf2(data)) {
      this.log('debug', 'Input detected as UF2 file');
      const parsed = parseUf2(data);
      binary   = parsed.binary;
      baseAddr = parsed.baseAddr;
      this.log('debug', `UF2: ${parsed.blocks.length} blocks, baseAddr=0x${baseAddr.toString(16)}, familyId=0x${parsed.familyId.toString(16)}`);
    } else {
      this.log('debug', 'Input detected as raw binary');
      binary   = data;
      baseAddr = opts?.baseAddr ?? RP2040_FLASH_BASE;
    }

    // Convert XIP address to PICOBOOT offset address
    const flashOffset = baseAddr & RP2040_FLASH_ADDR_MASK;
    const doVerify    = opts?.verify !== false;

    // ── 2. Reset interface ────────────────────────────────────────────────────
    report('Connecting to device', 2);
    try {
      await this.transport.resetInterface();
    } catch {
      this.log('debug', 'resetInterface failed (non-fatal, continuing)');
    }

    // ── 3. Exclusive access ───────────────────────────────────────────────────
    report('Taking exclusive access', 5);
    await this.exclusiveAccess(true);

    // ── 4. Exit XIP mode ──────────────────────────────────────────────────────
    report('Exiting XIP mode', 8);
    await this.exitXip();

    // ── 5. Erase flash ────────────────────────────────────────────────────────
    report('Erasing flash', 10);
    const eraseSize = alignUp(binary.length, FLASH_SECTOR_SIZE);
    await this.flashErase(flashOffset, eraseSize);
    this.log('debug', `Erased ${eraseSize} bytes at offset 0x${flashOffset.toString(16)}`);

    // ── 6. Write pages ────────────────────────────────────────────────────────
    const padded    = padToAlignment(binary, FLASH_PAGE_SIZE);
    const numPages  = padded.length / FLASH_PAGE_SIZE;
    report('Uploading', 15);

    for (let i = 0; i < numPages; i++) {
      const pageOff = flashOffset + i * FLASH_PAGE_SIZE;
      const page    = padded.slice(i * FLASH_PAGE_SIZE, (i + 1) * FLASH_PAGE_SIZE);
      await this.flashWrite(pageOff, page);

      const pct = 15 + Math.round((i + 1) / numPages * 55);
      progress?.('Uploading', pct);
    }
    report('Uploading', 70);
    this.log('debug', `Wrote ${padded.length} bytes (${numPages} pages)`);

    // ── 7. Verify ─────────────────────────────────────────────────────────────
    if (doVerify) {
      report('Verifying', 72);
      const readBack = await this.flashRead(flashOffset, padded.length);

      for (let i = 0; i < binary.length; i++) {
        if (readBack[i] !== binary[i]) {
          throw new STK500VerifyError(
            baseAddr + i,
            binary[i]!,
            readBack[i]!,
          );
        }
        if (i % (FLASH_PAGE_SIZE * 8) === 0) {
          const pct = 72 + Math.round(i / binary.length * 20);
          progress?.('Verifying', pct);
        }
      }
      report('Verifying', 92);
    }

    // ── 8. Reboot ─────────────────────────────────────────────────────────────
    report('Rebooting device', 95);
    await this.reboot(0, 0, 500);

    report('Complete', 100);
  }

  // ── PICOBOOT commands ──────────────────────────────────────────────────────

  /** EXCLUSIVE_ACCESS — take or release exclusive control (disables/enables MSD) */
  async exclusiveAccess(exclusive: boolean): Promise<void> {
    const args = new Uint8Array([exclusive ? 1 : 0]);
    await this.execCmd(PicobootCmd.EXCLUSIVE_ACCESS, args);
  }

  /** EXIT_XIP — exit execute-in-place mode (required before erase or write) */
  async exitXip(): Promise<void> {
    await this.execCmd(PicobootCmd.EXIT_XIP, new Uint8Array(0));
  }

  /** ENTER_CMD_XIP — re-enter XIP mode (optional, called after programming) */
  async enterCmdXip(): Promise<void> {
    await this.execCmd(PicobootCmd.ENTER_CMD_XIP, new Uint8Array(0));
  }

  /**
   * FLASH_ERASE — erase flash sectors.
   * @param addr  Flash offset (0-based, 4KB-aligned)
   * @param size  Number of bytes to erase (must be a multiple of 4096)
   */
  async flashErase(addr: number, size: number): Promise<void> {
    if (addr % FLASH_SECTOR_SIZE !== 0) {
      throw new STK500ProtocolError(
        `FLASH_ERASE: addr 0x${addr.toString(16)} is not 4KB-aligned`
      );
    }
    if (size % FLASH_SECTOR_SIZE !== 0) {
      throw new STK500ProtocolError(
        `FLASH_ERASE: size ${size} is not a multiple of 4096`
      );
    }
    const args = buildRangeArgs(addr, size);
    await this.execCmd(PicobootCmd.FLASH_ERASE, args);
  }

  /**
   * WRITE — write a flash page (256 bytes).
   * @param addr  Flash offset (0-based, 256-byte-aligned)
   * @param data  Exactly 256 bytes of payload
   */
  async flashWrite(addr: number, data: Uint8Array): Promise<void> {
    if (addr % FLASH_PAGE_SIZE !== 0) {
      throw new STK500ProtocolError(
        `WRITE: addr 0x${addr.toString(16)} is not 256-byte-aligned`
      );
    }
    if (data.length !== FLASH_PAGE_SIZE) {
      throw new STK500ProtocolError(
        `WRITE: data must be exactly ${FLASH_PAGE_SIZE} bytes (got ${data.length})`
      );
    }
    const args = buildRangeArgs(addr, data.length);
    await this.execCmd(PicobootCmd.WRITE, args, data);
  }

  /**
   * READ — read bytes from flash.
   * @param addr  Flash offset (0-based)
   * @param size  Number of bytes to read
   */
  async flashRead(addr: number, size: number): Promise<Uint8Array> {
    const args = buildRangeArgs(addr, size);
    return this.execCmd(PicobootCmd.READ, args, undefined, size) as Promise<Uint8Array>;
  }

  /**
   * REBOOT — reboot the device.
   * @param pc        Program counter (0 = boot from flash)
   * @param sp        Stack pointer (0 = use default)
   * @param delayMs   Milliseconds before reboot (allows USB ACK to complete)
   */
  async reboot(pc = 0, sp = 0, delayMs = 500): Promise<void> {
    const args = new Uint8Array(12);
    const view = new DataView(args.buffer);
    view.setUint32(0, pc,      true);
    view.setUint32(4, sp,      true);
    view.setUint32(8, delayMs, true);
    await this.execCmd(PicobootCmd.REBOOT, args);
  }

  // ── UF2 helpers ────────────────────────────────────────────────────────────

  /**
   * Convert a raw binary to UF2 format.
   * Convenience wrapper around the standalone `binaryToUf2` utility.
   */
  binaryToUf2(
    binary:   Uint8Array,
    baseAddr: number = RP2040_FLASH_BASE,
    familyId?: number,
  ): Uint8Array {
    return binaryToUf2(binary, baseAddr, familyId);
  }

  // ── Private protocol helpers ───────────────────────────────────────────────

  /**
   * Execute a PICOBOOT command and (optionally) transfer data.
   *
   * Flow for OUT commands (no data):   CMD→ | STATUS←
   * Flow for OUT commands (write):     CMD→ | DATA→ | STATUS←
   * Flow for IN commands (read):       CMD→ | DATA← | STATUS←
   *
   * @returns Received data for IN commands, or throws on error status
   */
  private async execCmd(
    cmdId:      number,
    args:       Uint8Array,
    outData?:   Uint8Array,
    inLength = 0,
  ): Promise<Uint8Array | null> {
    const isInCmd        = (cmdId & 0x80) !== 0;
    const transferLength = isInCmd ? inLength : (outData?.length ?? 0);

    const cmd = this.buildCmd(cmdId, args, transferLength);
    await this.transport.sendCommand(cmd);

    // Data phase: OUT (write) or IN (read)
    let readData: Uint8Array | null = null;
    if (isInCmd && inLength > 0) {
      readData = await this.transport.receiveBytes(inLength);
    } else if (outData && outData.length > 0) {
      await this.transport.sendBytes(outData);
    }

    // Status phase — read up to PICOBOOT_STATUS_SIZE bytes from IN endpoint.
    // The device sends a 16-byte picoboot_cmd_status struct:
    //   [dToken u32][dStatusCode u32][bCmdId u8][bInProgress u8][6-byte pad]
    const status = await this.transport.receiveBytes(PICOBOOT_STATUS_SIZE);
    if (status.length >= 8) {
      const statusCode = new DataView(
        status.buffer, status.byteOffset, status.byteLength
      ).getUint32(4, true);

      if (statusCode !== PicobootStatus.OK) {
        const name = this.statusName(statusCode);
        throw new STK500ProtocolError(
          `PICOBOOT cmd 0x${cmdId.toString(16)} failed: ${name} (code ${statusCode})`
        );
      }
    }
    // If status.length < 8, assume ZLP (zero-length packet) = OK

    return readData;
  }

  /** Build a 32-byte PICOBOOT command packet */
  private buildCmd(cmdId: number, args: Uint8Array, transferLength: number): Uint8Array {
    const buf  = new Uint8Array(PICOBOOT_CMD_SIZE);
    const view = new DataView(buf.buffer);
    view.setUint32(0,  PICOBOOT_MAGIC,  true);  // dMagic
    view.setUint32(4,  this.token++,    true);  // dToken
    buf[8]  = cmdId;                            // bCmdId
    buf[9]  = args.length & 0xFF;              // bCmdSize
    // bytes 10-11: _unused = 0
    view.setUint32(12, transferLength,  true);  // dTransferLength
    buf.set(args.slice(0, Math.min(args.length, 16)), 16);  // args (max 16 bytes)
    return buf;
  }

  private statusName(code: number): string {
    const names: Record<number, string> = {
      0: 'OK', 1: 'UNKNOWN_CMD', 2: 'BAD_CHECKSUM', 3: 'NOT_PERMITTED',
      4: 'INVALID_ADDRESS', 5: 'BAD_ALIGNMENT', 6: 'INTERLEAVED',
      7: 'REBOOTING', 8: 'UNKNOWN', 9: 'INVALID_STATE',
    };
    return names[code] ?? `status_${code}`;
  }
}

// ── Private utilities ────────────────────────────────────────────────────────

/** Build the 8-byte range args struct: [addr u32][size u32] (little-endian) */
function buildRangeArgs(addr: number, size: number): Uint8Array {
  const args = new Uint8Array(8);
  const view = new DataView(args.buffer);
  view.setUint32(0, addr, true);
  view.setUint32(4, size, true);
  return args;
}

/** Round `n` up to the nearest multiple of `alignment` */
function alignUp(n: number, alignment: number): number {
  return Math.ceil(n / alignment) * alignment;
}

/** Pad `data` to a multiple of `alignment` with 0xFF */
function padToAlignment(data: Uint8Array, alignment: number): Uint8Array {
  const padded = alignUp(data.length, alignment);
  if (padded === data.length) return data;
  const out = new Uint8Array(padded).fill(0xFF);
  out.set(data);
  return out;
}
