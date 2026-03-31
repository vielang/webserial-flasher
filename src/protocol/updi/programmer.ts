// UPDI (Unified Program and Debug Interface) programmer.
//
// Supports tinyAVR 0/1/2 series and megaAVR 0 series (ATmega4809).
// This is the first JavaScript implementation of UPDI programming.
//
// Physical requirements:
//   - Serial port opened at 8E2 (8 data bits, even parity, 2 stop bits)
//   - Single-wire half-duplex: TX echo must be consumed for every write
//   - A BREAK condition (≥12 bit-times low) resets the UPDI state machine
//
// Programming sequence:
//   1. sendBreak() — reset UPDI
//   2. ldcs(STATUSA) — verify the link is alive
//   3. Send NVMProg KEY
//   4. Wait for NVMPROG mode in ASI_KEY_STATUS
//   5. Chip erase (NVM_CMD_CHER via NVM_CTRLA)
//   6. Write flash pages (setPtr → stPtrInc → NVM_CMD_ERWP × N)
//   7. Verify
//   8. Reset device (ASI_RESET_REQ)
//
// Reference: Microchip DS40002312 — "AVR UPDI Programming Interface"

import {
  UPDI_CS_STATUSA,
  UPDI_CS_ASI_KEY_STATUS,
  UPDI_CS_ASI_SYS_STATUS,
  UPDI_CS_ASI_RESET_REQ,
  UPDI_KEY_NVMPROG,
  UPDI_SYS_LOCKSTATUS,
  NVM_CTRLA, NVM_STATUS,
  NVM_FBUSY,
  NVM_CMD_CHER, NVM_CMD_ERWP, NVM_CMD_NOP,
  UPDI_KEY_NVM_PROG, UPDI_KEY_CHIP_ERASE_REQ,
  UPDI_RESET_REQ_ASSERT, UPDI_RESET_REQ_DEASSERT,
  SIGROW_BASE, EEPROM_BASE, FUSE_BASE, FUSE_COUNT,
} from './constants.js';
import { UPDILink } from './link.js';
import {
  STK500ProtocolError,
  STK500SyncError,
  STK500SignatureMismatchError,
  STK500VerifyError,
  STK500InvalidHexError,
} from '../../core/errors.js';
import type {
  Board,
  STK500Options,
  BootloadProgressCallback,
  Logger,
} from '../../core/types.js';
import type { ISTKTransport } from '../../transport/ITransport.js';
import { parseIntelHex } from '../hexParser.js';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fuse register dump for tinyAVR 0/1/2 and megaAVR 0 series.
 * Note: fuse3 does not exist on these devices. Indices match NVM fuse layout.
 */
export interface UPDIFuses {
  fuse0: number;
  fuse1: number;
  fuse2: number;
  /** fuse3 does not exist — index 3 is reserved and returns 0xFF */
  fuse4: number;
  fuse5: number;
}

export class UPDI {
  private readonly link: UPDILink;
  private readonly log: Logger;
  private readonly syncAttempts: number;

  constructor(
    private readonly transport: ISTKTransport,
    private readonly board: Board,
    opts: STK500Options = {}
  ) {
    this.syncAttempts = opts.retry?.syncAttempts ?? 5;

    if (opts.quiet) {
      this.log = () => {};
    } else if (opts.logger) {
      this.log = opts.logger;
    } else {
      this.log = (level, msg) => {
        /* istanbul ignore next */
        if (typeof console !== 'undefined') {
          console.log(`[updi] [${level}] ${msg}`);
        }
      };
    }

    this.link = new UPDILink(transport, board, this.log);
  }

  // ── Initialization ────────────────────────────────────────────────────────

  /**
   * Send a BREAK condition to reset the UPDI state machine.
   * Requires transport.sendBreak() — throws if not available.
   */
  async sendBreak(): Promise<void> {
    if (!this.transport.sendBreak) {
      throw new STK500ProtocolError(
        'UPDI requires transport.sendBreak(). ' +
        'Use WebSerialTransport or NodeSerialTransport which implements this method.'
      );
    }
    this.log('debug', 'sendBreak: resetting UPDI state machine');
    await this.transport.sendBreak();
    await sleep(5); // short settling time after BREAK
  }

  /**
   * Verify the UPDI link is active by reading STATUSA.
   * Returns the STATUSA value on success, throws STK500SyncError on failure.
   */
  async sync(attempts: number): Promise<void> {
    this.log('debug', `sync (max ${attempts} attempts)`);
    for (let i = 1; i <= attempts; i++) {
      try {
        const status = await this.link.ldcs(UPDI_CS_STATUSA);
        // 0x00 or any non-0xFF value indicates UPDI is responding
        if (status !== 0xFF) {
          this.log('debug', `sync OK on attempt ${i}, STATUSA=0x${status.toString(16)}`);
          return;
        }
        throw new Error('STATUSA returned 0xFF — no device');
      } catch (err) {
        this.log(
          'debug',
          `sync attempt ${i}/${attempts}: ` +
          `${err instanceof Error ? err.message : String(err)}`
        );
        if (i < attempts) await sleep(100);
      }
    }
    throw new STK500SyncError(attempts);
  }

  // ── NVM Programming Mode ──────────────────────────────────────────────────

  /**
   * Send the NVMProg key and wait until the device acknowledges NVMPROG mode.
   */
  async enterProgMode(): Promise<void> {
    this.log('debug', 'enterProgMode: sending NVMProg key');

    // Configure guard time for faster communication
    await this.link.configureGuardTime();

    // Broadcast NVM programming key
    await this.link.sendKey(UPDI_KEY_NVM_PROG);

    // Wait for the device to enter NVM programming mode
    const deadline = Date.now() + this.board.timeout;
    while (Date.now() < deadline) {
      const keyStatus = await this.link.ldcs(UPDI_CS_ASI_KEY_STATUS);
      if (keyStatus & UPDI_KEY_NVMPROG) {
        this.log('info', 'NVMPROG mode active');
        return;
      }
      await sleep(5);
    }

    throw new STK500ProtocolError('UPDI: failed to enter NVM programming mode (NVMPROG not set)');
  }

  /**
   * Check if the device is locked (LOCKSTATUS bit in ASI_SYS_STATUS).
   */
  async isLocked(): Promise<boolean> {
    const status = await this.link.ldcs(UPDI_CS_ASI_SYS_STATUS);
    return (status & UPDI_SYS_LOCKSTATUS) !== 0;
  }

  // ── Chip Erase ────────────────────────────────────────────────────────────

  /**
   * Erase the entire chip (flash + EEPROM + fuses reset to defaults).
   * Must be in NVMPROG mode first — OR use the CHIPERASE key for locked devices.
   */
  async chipErase(): Promise<void> {
    this.log('info', 'chipErase');
    await this.link.sts(NVM_CTRLA, NVM_CMD_CHER);
    await this.waitNvmReady();
    // Clear the NVM command register after erase
    await this.link.sts(NVM_CTRLA, NVM_CMD_NOP);
  }

  /**
   * Chip erase using the CHIPERASE key — works even on locked devices.
   * Sends BREAK + key, then waits for erase to complete.
   */
  async chipEraseKey(): Promise<void> {
    this.log('info', 'chipEraseKey: using CHIPERASE key for locked device');

    // Reset UPDI and send chip-erase key
    await this.sendBreak();
    await this.link.configureGuardTime();
    await this.link.sendKey(UPDI_KEY_CHIP_ERASE_REQ);

    // Toggle reset to trigger the erase
    await this.link.stcs(UPDI_CS_ASI_RESET_REQ, UPDI_RESET_REQ_ASSERT);
    await sleep(5);
    await this.link.stcs(UPDI_CS_ASI_RESET_REQ, UPDI_RESET_REQ_DEASSERT);

    // Wait for erase to complete (device re-enters UPDI idle)
    const deadline = Date.now() + this.board.timeout;
    while (Date.now() < deadline) {
      try {
        const keyStatus = await this.link.ldcs(UPDI_CS_ASI_KEY_STATUS);
        if (!(keyStatus & 0x08)) { // CHIPERASE key cleared = erase done
          this.log('info', 'chipEraseKey: complete');
          return;
        }
      } catch { /* UPDI may be briefly unresponsive during erase */ }
      await sleep(20);
    }
    throw new STK500ProtocolError('UPDI: chip erase timeout');
  }

  // ── NVM Busy Poll ─────────────────────────────────────────────────────────

  /** Wait until NVM_STATUS.FBUSY clears (flash write/erase completed) */
  async waitNvmReady(): Promise<void> {
    const deadline = Date.now() + this.board.timeout;
    while (Date.now() < deadline) {
      const status = await this.link.lds(NVM_STATUS);
      if (!(status & NVM_FBUSY)) return;
      await sleep(1);
    }
    throw new STK500ProtocolError('UPDI: NVM controller busy timeout');
  }

  // ── Signature ─────────────────────────────────────────────────────────────

  /**
   * Read the 3-byte device ID from SIGROW (address 0x1100).
   */
  async getSignature(): Promise<Uint8Array> {
    this.log('debug', 'getSignature');
    const sigBase = this.board.sigrowBase ?? SIGROW_BASE;
    return this.link.readMemory(sigBase, 3);
  }

  async verifySignature(): Promise<void> {
    const actual   = await this.getSignature();
    const expected = this.board.signature;

    if (!actual.every((b, i) => b === expected[i])) {
      throw new STK500SignatureMismatchError(expected, actual);
    }

    const fmt = (b: Uint8Array): string =>
      Array.from(b).map((x) => `0x${x.toString(16).padStart(2, '0')}`).join(', ');
    this.log('info', `signature verified: [${fmt(actual)}]`);
  }

  // ── Flash Programming ─────────────────────────────────────────────────────

  /**
   * Write one page of flash.
   * @param byteAddr  Absolute byte address in flash (e.g. 0x8000 for tinyAVR start)
   * @param data      Page data (length = board.pageSize)
   */
  async programPage(byteAddr: number, data: Uint8Array): Promise<void> {
    // Clear any previous NVM command
    await this.link.sts(NVM_CTRLA, NVM_CMD_NOP);

    // Set pointer and stream data into page buffer
    await this.link.setPtr(byteAddr);
    await this.link.stPtrInc(data);

    // Execute erase + write
    await this.link.sts(NVM_CTRLA, NVM_CMD_ERWP);
    await this.waitNvmReady();
  }

  /** Read `size` bytes from flash starting at `byteAddr` */
  async readFlash(byteAddr: number, size: number): Promise<Uint8Array> {
    return this.link.readMemory(byteAddr, size);
  }

  // ── EEPROM ────────────────────────────────────────────────────────────────

  /**
   * Write EEPROM bytes.
   * @param offset  Byte offset within EEPROM (0-based)
   * @param data    Data to write
   */
  async writeEeprom(offset: number, data: Uint8Array): Promise<void> {
    await this.link.sts(NVM_CTRLA, NVM_CMD_NOP);
    await this.link.setPtr(EEPROM_BASE + offset);
    await this.link.stPtrInc(data);
    await this.link.sts(NVM_CTRLA, NVM_CMD_ERWP);
    await this.waitNvmReady();
  }

  /** Read `size` EEPROM bytes starting at `offset` */
  async readEeprom(offset: number, size: number): Promise<Uint8Array> {
    return this.link.readMemory(EEPROM_BASE + offset, size);
  }

  // ── Fuses ─────────────────────────────────────────────────────────────────

  /**
   * Read all fuse bytes (6 fuses for tinyAVR/megaAVR 0).
   */
  async readFuses(): Promise<UPDIFuses> {
    const data = await this.link.readMemory(FUSE_BASE, FUSE_COUNT);
    return {
      fuse0: data[0] ?? 0xFF,
      fuse1: data[1] ?? 0xFF,
      fuse2: data[2] ?? 0xFF,
      // data[3] is reserved (no fuse3) — skip
      fuse4: data[4] ?? 0xFF,
      fuse5: data[5] ?? 0xFF,
    };
  }

  /**
   * Write a single fuse byte.
   * @param fuseNum  0–5 (fuse register index)
   * @param val      New fuse value
   */
  async writeFuse(fuseNum: number, val: number): Promise<void> {
    if (fuseNum < 0 || fuseNum > 5) {
      throw new STK500ProtocolError(`UPDI: invalid fuse number ${fuseNum} (must be 0–5)`);
    }
    await this.link.sts(NVM_CTRLA, NVM_CMD_NOP);
    await this.link.sts(FUSE_BASE + fuseNum, val);
    await this.link.sts(NVM_CTRLA, 0x07); // WFU command
    await this.waitNvmReady();
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  /** Exit programming mode and reset the device to run user firmware. */
  async leaveProgMode(): Promise<void> {
    this.log('debug', 'leaveProgMode: asserting reset');
    await this.link.stcs(UPDI_CS_ASI_RESET_REQ, UPDI_RESET_REQ_ASSERT);
    await sleep(10);
    await this.link.stcs(UPDI_CS_ASI_RESET_REQ, UPDI_RESET_REQ_DEASSERT);
    this.log('debug', 'device reset — user firmware running');
  }

  // ── Upload / Verify ────────────────────────────────────────────────────────

  async upload(
    hexData: string | Uint8Array,
    progressCallback?: (pct: number) => void
  ): Promise<void> {
    const { data: hex, byteCount } = parseIntelHex(hexData);
    this.log('info', `upload: ${byteCount} bytes`);

    // HEX size validation
    if (this.board.flashSize && byteCount > this.board.flashSize) {
      throw new STK500InvalidHexError(
        `HEX too large: ${byteCount} bytes exceeds flash size ${this.board.flashSize} bytes`
      );
    }

    const pageSize  = this.board.pageSize;
    const flashBase = this.board.flashBase ?? 0x8000;

    let offset = 0;
    while (offset < hex.length) {
      const chunkSize = Math.min(pageSize, hex.length - offset);
      const chunk     = hex.subarray(offset, offset + chunkSize);
      // Pad last page to full page size with 0xFF (unprogrammed flash value)
      let page: Uint8Array;
      if (chunkSize < pageSize) {
        page = new Uint8Array(pageSize).fill(0xFF);
        page.set(chunk);
      } else {
        page = chunk;
      }

      await this.programPage(flashBase + offset, page);

      offset += chunkSize;
      progressCallback?.((offset / hex.length) * 100);
    }
    this.log('info', 'upload complete');
  }

  async verify(
    hexData: string | Uint8Array,
    progressCallback?: (pct: number) => void
  ): Promise<void> {
    const { data: hex, byteCount } = parseIntelHex(hexData);
    this.log('info', `verify: checking ${byteCount} bytes`);

    const pageSize  = this.board.pageSize;
    const flashBase = this.board.flashBase ?? 0x8000;

    let offset = 0;
    while (offset < hex.length) {
      const size     = Math.min(pageSize, hex.length - offset);
      const expected = hex.subarray(offset, offset + size);
      const actual   = await this.readFlash(flashBase + offset, size);

      for (let i = 0; i < size; i++) {
        if (actual[i] !== expected[i]) {
          throw new STK500VerifyError(offset + i, expected[i], actual[i]);
        }
      }

      offset += size;
      progressCallback?.((offset / hex.length) * 100);
    }
    this.log('info', 'verify OK');
  }

  // ── bootload (main entry point) ────────────────────────────────────────────

  async bootload(
    hexData: string | Uint8Array,
    progressCallback?: BootloadProgressCallback
  ): Promise<void> {
    const progress = (status: string, pct: number): void => {
      this.log('info', `${status} (${Math.round(pct)}%)`);
      progressCallback?.(status, pct);
    };

    // 1 ── BREAK to reset UPDI state machine
    progress('Resetting UPDI', 0);
    await this.sendBreak();

    // 2 ── Sync (verify link is alive)
    progress('Syncing', 5);
    await this.sync(this.syncAttempts);

    // 3 ── Enter NVM programming mode
    progress('Entering programming mode', 10);
    await this.enterProgMode();

    // 3b ── If device is locked, use chip-erase key to unlock
    if (await this.isLocked()) {
      this.log('warn', 'device is locked — performing CHIPERASE key unlock');
      await this.chipEraseKey();
      // Re-enter programming mode after chip erase key
      await this.sendBreak();
      await this.sync(this.syncAttempts);
      await this.enterProgMode();
    }

    // 4 ── Verify signature
    progress('Verifying signature', 15);
    await this.verifySignature();

    // 5 ── Chip erase (via NVM command, device is now unlocked)
    progress('Erasing chip', 20);
    await this.chipErase();

    // 6 ── Upload firmware (25 → 75%)
    progress('Uploading', 25);
    await this.upload(hexData, (pct) => {
      progress('Uploading', 25 + pct * 0.50);
    });

    // 7 ── Verify (75 → 95%)
    progress('Verifying', 75);
    await this.verify(hexData, (pct) => {
      progress('Verifying', 75 + pct * 0.20);
    });

    // 8 ── Reset device — run new firmware
    progress('Exiting programming mode', 95);
    await this.leaveProgMode();

    progress('Complete', 100);
  }
}
