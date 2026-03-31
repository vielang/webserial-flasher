// STK500v2 ISP programmer for Arduino Mega 2560 and other wiring-bootloader boards.
//
// Protocol: Atmel AVR068 — STK500 Communication Protocol v2
// Supported bootloaders: wiring (ATmegaBOOT_168 for Mega), STK600
//
// Frame format: [0x1B][seq][sizeH][sizeL][0x0E][body...][checksum_xor]
// All ISP commands embed the raw SPI opcodes for the target AVR.

import { Cmd, Status } from './constants.js';
import { encodeFrame, receiveFrame } from './frame.js';
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

export class STK500v2 {
  private seq          = 0;
  private readonly log: Logger;
  private readonly syncAttempts: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly transport: ISTKTransport,
    private readonly board: Board,
    opts: STK500Options = {}
  ) {
    this.syncAttempts = opts.retry?.syncAttempts ?? 5;
    this.retryDelayMs = opts.retry?.retryDelayMs ?? 200;

    if (opts.quiet) {
      this.log = () => {};
    } else if (opts.logger) {
      this.log = opts.logger;
    } else {
      this.log = (level, msg) => {
        /* istanbul ignore next */
        if (typeof console !== 'undefined') {
          console.log(`[stk500v2] [${level}] ${msg}`);
        }
      };
    }
  }

  // ── Frame I/O ──────────────────────────────────────────────────────────────

  /**
   * Send a command body and return the full response body.
   * Throws STK500ProtocolError when the device reports failure.
   */
  private async send(body: number[] | Uint8Array): Promise<Uint8Array> {
    this.seq = (this.seq + 1) & 0xFF;
    await this.transport.write(encodeFrame(this.seq, body));
    const response = await receiveFrame(this.transport, this.board.timeout);

    if (response.length < 2) {
      throw new STK500ProtocolError(
        `STK500v2: response too short (${response.length} bytes)`
      );
    }

    // Response format: [CMD_ECHO, STATUS, ...data...]
    const cmdEcho = body[0] ?? 0;
    if (response[0] !== cmdEcho) {
      throw new STK500ProtocolError(
        `STK500v2: unexpected command echo 0x${response[0].toString(16)} ` +
        `(expected 0x${cmdEcho.toString(16)})`
      );
    }
    if (response[1] !== Status.CMD_OK) {
      throw new STK500ProtocolError(
        `STK500v2: command 0x${cmdEcho.toString(16)} failed, ` +
        `status=0x${response[1].toString(16)}`
      );
    }

    return response;
  }

  // ── Reset ──────────────────────────────────────────────────────────────────

  async resetDevice(): Promise<void> {
    const method = this.board.resetMethod ?? 'dtr';
    const delay  = this.board.resetDelayMs ?? 200;

    if (method === 'none' || !this.transport.setSignals) {
      this.log('debug', 'resetDevice: skipped');
      return;
    }

    this.log('info', `resetDevice: toggling ${method.toUpperCase()}`);
    const low  = method === 'dtr' ? { dtr: false } : { rts: false };
    const high = method === 'dtr' ? { dtr: true  } : { rts: true  };

    await this.transport.setSignals(low);
    await sleep(delay);
    await this.transport.setSignals(high);
    await sleep(delay);
  }

  // ── Sync / Sign-On ─────────────────────────────────────────────────────────

  /**
   * Send CMD_SIGN_ON and return the bootloader name string (e.g. "AVRISP_MK2").
   * Throws on timeout or framing error.
   */
  async signOn(): Promise<string> {
    this.log('debug', 'signOn');
    const response = await this.send([Cmd.SIGN_ON]);
    // response: [CMD_SIGN_ON, STATUS_CMD_OK, strLen, ...chars...]
    if (response.length >= 3) {
      const len   = response[2];
      const chars = response.slice(3, 3 + len);
      return String.fromCharCode(...chars);
    }
    return '';
  }

  async sync(attempts: number): Promise<void> {
    this.log('debug', `sync (max ${attempts} attempts)`);
    for (let i = 1; i <= attempts; i++) {
      try {
        const name = await this.signOn();
        this.log('debug', `signOn OK on attempt ${i}: "${name}"`);
        return;
      } catch (err) {
        this.log(
          'debug',
          `signOn attempt ${i}/${attempts} failed: ` +
          `${err instanceof Error ? err.message : String(err)}`
        );
        if (i < attempts) await sleep(this.retryDelayMs);
      }
    }
    throw new STK500SyncError(attempts);
  }

  // ── Device Descriptor ──────────────────────────────────────────────────────

  /**
   * Send CMD_SET_DEVICE_DESCRIPTOR (0x04).
   * Most wiring-bootloader implementations accept any 52-byte body.
   * Key fields are flash/EEPROM page sizes and boot address.
   */
  async setDeviceDescriptor(): Promise<void> {
    this.log('debug', 'setDeviceDescriptor');
    const desc = this.board.stk500v2Descriptor ?? buildDefaultDescriptor(this.board);
    const body = new Uint8Array(1 + desc.length);
    body[0] = Cmd.SET_DEVICE_DESCRIPTOR;
    body.set(desc, 1);
    await this.send(body);
  }

  // ── Programming Mode ───────────────────────────────────────────────────────

  async enterProgMode(): Promise<void> {
    this.log('debug', 'enterProgMode');
    const p = this.board.ispParams ?? {};
    await this.send([
      Cmd.ENTER_PROGMODE_ISP,
      p.timeout      ?? 200,  // timeout value
      p.stabDelay    ?? 100,  // stabilisation delay (ms)
      p.cmdexeDelay  ?? 25,   // command execute delay (ms)
      p.synchLoops   ?? 32,   // SPI sync loops
      p.byteDelay    ?? 0,    // byte-level delay (µs)
      p.pollValue    ?? 0x53, // expected SPI programming enable response
      p.pollIndex    ?? 3,    // byte position to check in SPI response
      0xAC, 0x53, 0x00, 0x00, // SPI PROG_ENABLE command (AVR standard)
    ]);
  }

  async leaveProgMode(): Promise<void> {
    this.log('debug', 'leaveProgMode');
    await this.send([Cmd.LEAVE_PROGMODE_ISP, 1, 1]); // preDelay=1ms, postDelay=1ms
  }

  // ── Erase ──────────────────────────────────────────────────────────────────

  async chipErase(): Promise<void> {
    this.log('info', 'chipErase');
    const delay = this.board.ispParams?.eraseDelay ?? 55;
    await this.send([
      Cmd.CHIP_ERASE_ISP,
      (delay >> 8) & 0xFF, // eraseDelay high byte (ms)
      delay & 0xFF,         // eraseDelay low byte
      0x00,                  // pollMethod = 0 (use delay, not polling)
      0xAC, 0x80, 0x00, 0x00, // SPI CHIP_ERASE command
    ]);
    await sleep(delay);
  }

  // ── Address ────────────────────────────────────────────────────────────────

  /**
   * CMD_LOAD_ADDRESS — sets the current flash address for subsequent reads/writes.
   * Address is in WORDS (byte_address / 2).
   * For addresses > 65535 words (>128KB), bit 31 is set to indicate extended mode.
   */
  async loadAddress(wordAddr: number): Promise<void> {
    // Extended addressing: set bit 31 when word address exceeds 16-bit range
    const addr = wordAddr > 0xFFFF
      ? (wordAddr | 0x80000000) >>> 0
      : wordAddr;

    await this.send([
      Cmd.LOAD_ADDRESS,
      (addr >>> 24) & 0xFF,
      (addr >>> 16) & 0xFF,
      (addr >>>  8) & 0xFF,
       addr         & 0xFF,
    ]);
  }

  // ── Flash Read / Write ─────────────────────────────────────────────────────

  /**
   * Write one flash page (CMD_PROGRAM_FLASH_ISP).
   * @param wordAddr  Word address of the page start
   * @param data      Page data (must be ≤ board.pageSize bytes)
   */
  async programFlash(wordAddr: number, data: Uint8Array): Promise<void> {
    await this.loadAddress(wordAddr);

    const size  = data.length;
    const mode  = this.board.ispParams?.flashMode  ?? 0xC1; // page-mode write
    const delay = this.board.ispParams?.flashDelay ?? 6;    // page write delay (ms)

    // Body: [CMD, sizeH, sizeL, mode, delay, loadLow, loadHigh, writePage, poll1, poll2, data...]
    const body = new Uint8Array(10 + size);
    body[0] = Cmd.PROGRAM_FLASH_ISP;
    body[1] = (size >> 8) & 0xFF;
    body[2] = size & 0xFF;
    body[3] = mode;
    body[4] = delay;
    body[5] = 0x40; // SPI: load flash page — low byte  (AVR universal cmd)
    body[6] = 0x48; // SPI: load flash page — high byte
    body[7] = 0x4C; // SPI: write flash page
    body[8] = 0xFF; // flash readback poll value 1
    body[9] = 0xFF; // flash readback poll value 2
    body.set(data, 10);

    await this.send(body);
  }

  /**
   * Read one flash page (CMD_READ_FLASH_ISP).
   * @param wordAddr  Word address of the page start
   * @param size      Number of BYTES to read
   * @returns         The raw flash bytes
   */
  async readFlash(wordAddr: number, size: number): Promise<Uint8Array> {
    await this.loadAddress(wordAddr);

    const response = await this.send([
      Cmd.READ_FLASH_ISP,
      (size >> 8) & 0xFF,
      size & 0xFF,
      0x20, // SPI: read program memory (low byte)
    ]);

    // Response: [CMD_READ_FLASH_ISP, STATUS_CMD_OK, data..., STATUS_CMD_OK]
    // Data starts at index 2, ends before the trailing status byte
    return response.slice(2, 2 + size);
  }

  // ── Signature ──────────────────────────────────────────────────────────────

  /**
   * Read the 3-byte device signature via three CMD_READ_SIGNATURE_ISP calls.
   */
  async readSignature(): Promise<Uint8Array> {
    this.log('debug', 'readSignature');
    const sig = new Uint8Array(3);
    for (let i = 0; i < 3; i++) {
      const response = await this.send([
        Cmd.READ_SIGNATURE_ISP,
        1,    // returnSize = 1 byte
        0,    // delay = 0
        0x30, // SPI: read signature
        0x00,
        i,    // byte index (0, 1, or 2)
        0x00,
      ]);
      // Response: [CMD, STATUS_CMD_OK, STATUS_ISP_READY, byte]
      sig[i] = response[3] ?? 0;
    }
    return sig;
  }

  async verifySignature(): Promise<void> {
    const actual   = await this.readSignature();
    const expected = this.board.signature;

    if (!actual.every((b, i) => b === expected[i])) {
      throw new STK500SignatureMismatchError(expected, actual);
    }

    const fmt = (b: Uint8Array): string =>
      Array.from(b).map((x) => `0x${x.toString(16).padStart(2, '0')}`).join(', ');
    this.log('info', `signature verified: [${fmt(actual)}]`);
  }

  // ── Fuse / Lock read (Phase C) ────────────────────────────────────────────

  /**
   * Read one fuse byte via CMD_READ_FUSE_ISP (0x18).
   * @param fuseType  Which fuse: 'low' | 'high' | 'ext' | 'lock'
   */
  async readFuseIsp(fuseType: 'low' | 'high' | 'ext' | 'lock'): Promise<number> {
    this.log('debug', `readFuseIsp: ${fuseType}`);
    // SPI commands for fuse reading
    const spiCmds: Record<string, [number, number, number]> = {
      low:  [0x50, 0x00, 0x00],
      high: [0x58, 0x08, 0x00],
      ext:  [0x50, 0x08, 0x00],
      lock: [0x58, 0x00, 0x00],
    };
    const [b1, b2, b3] = spiCmds[fuseType]!;
    const response = await this.send([
      Cmd.READ_FUSE_ISP,
      1,     // returnSize = 1
      0,     // delay = 0
      b1, b2, b3, 0x00,  // SPI cmd bytes
    ]);
    // Response: [CMD, STATUS, STATUS_ISP, fuseVal]
    return response[3] ?? 0;
  }

  /**
   * Read all four fuse/lock bytes in one call.
   */
  async readFuses(): Promise<{ low: number; high: number; ext: number; lock: number }> {
    const low  = await this.readFuseIsp('low');
    const high = await this.readFuseIsp('high');
    const ext  = await this.readFuseIsp('ext');
    const lock = await this.readFuseIsp('lock');
    this.log('info', `fuses: low=0x${low.toString(16)} high=0x${high.toString(16)} ext=0x${ext.toString(16)} lock=0x${lock.toString(16)}`);
    return { low, high, ext, lock };
  }

  /**
   * Write a fuse byte via CMD_PROGRAM_FUSE_ISP (0x17).
   * @param fuseType  Which fuse: 'low' | 'high' | 'ext'
   * @param val       New fuse value
   */
  async writeFuseIsp(fuseType: 'low' | 'high' | 'ext', val: number): Promise<void> {
    this.log('debug', `writeFuseIsp: ${fuseType}=0x${val.toString(16)}`);
    const spiCmds: Record<string, [number, number]> = {
      low:  [0xAC, 0xA0],
      high: [0xAC, 0xA8],
      ext:  [0xAC, 0xA4],
    };
    const [b1, b2] = spiCmds[fuseType]!;
    await this.send([
      Cmd.PROGRAM_FUSE_ISP,
      b1, b2, 0x00, val,  // SPI write-fuse command
    ]);
    await sleep(5);
  }

  // ── EEPROM read / write (Phase C) ─────────────────────────────────────────

  /**
   * Write EEPROM data via CMD_PROGRAM_EEPROM_ISP (0x15).
   * @param byteAddr  Byte address in EEPROM
   * @param data      Data bytes (length ≤ eepromPageSize, default 8)
   */
  async programEeprom(byteAddr: number, data: Uint8Array): Promise<void> {
    const eepromPageSize = this.board.eepromPageSize ?? 8;
    if (data.length > eepromPageSize) {
      throw new STK500ProtocolError(
        `EEPROM chunk too large: ${data.length} > page size ${eepromPageSize}`
      );
    }

    // EEPROM address is passed as word address (byte / 2 for most devices)
    const wordAddr = byteAddr >> 1;
    await this.loadAddress(wordAddr);

    const size  = data.length;
    const body  = new Uint8Array(9 + size);
    body[0] = Cmd.PROGRAM_EEPROM_ISP;
    body[1] = (size >> 8) & 0xFF;
    body[2] = size & 0xFF;
    body[3] = 0xA1;  // EEPROM page load mode
    body[4] = 20;    // delay (ms)
    body[5] = 0xC1;  // EEPROM write command (0xC0 for page, 0xC4 for byte)
    body[6] = 10;    // page write delay (ms)
    body[7] = 0xFF;  // poll value 1
    body[8] = 0xFF;  // poll value 2
    body.set(data, 9);

    await this.send(body);
  }

  /**
   * Read EEPROM data via CMD_READ_EEPROM_ISP (0x16).
   * @param byteAddr  Byte address in EEPROM
   * @param size      Number of bytes to read
   */
  async readEeprom(byteAddr: number, size: number): Promise<Uint8Array> {
    const wordAddr = byteAddr >> 1;
    await this.loadAddress(wordAddr);

    const response = await this.send([
      Cmd.READ_EEPROM_ISP,
      (size >> 8) & 0xFF,
      size & 0xFF,
      0xA0, // SPI: read EEPROM byte command
    ]);
    // Response: [CMD, STATUS, data..., STATUS]
    return response.slice(2, 2 + size);
  }

  // ── Upload / Verify ────────────────────────────────────────────────────────

  async upload(
    hexData: string | Uint8Array,
    progressCallback?: (pct: number) => void
  ): Promise<void> {
    const { data: hex, byteCount } = parseIntelHex(hexData);
    this.log('info', `upload: ${byteCount} bytes`);

    // Phase G: HEX size validation
    if (this.board.flashSize && byteCount > this.board.flashSize) {
      throw new STK500InvalidHexError(
        `HEX too large: ${byteCount} bytes exceeds flash size ${this.board.flashSize} bytes`
      );
    }

    let pageaddr = 0;
    while (pageaddr < hex.length) {
      const wordAddr  = pageaddr >> 1; // convert byte address to word address
      const chunkSize = Math.min(this.board.pageSize, hex.length - pageaddr);
      const chunk     = hex.subarray(pageaddr, pageaddr + chunkSize);

      await this.programFlash(wordAddr, chunk);

      pageaddr += chunkSize;
      progressCallback?.((pageaddr / hex.length) * 100);
    }
    this.log('info', 'upload complete');
  }

  async verify(
    hexData: string | Uint8Array,
    progressCallback?: (pct: number) => void
  ): Promise<void> {
    const { data: hex, byteCount } = parseIntelHex(hexData);
    this.log('info', `verify: checking ${byteCount} bytes`);

    let pageaddr = 0;
    while (pageaddr < hex.length) {
      const wordAddr  = pageaddr >> 1;
      const chunkSize = Math.min(this.board.pageSize, hex.length - pageaddr);
      const expected  = hex.subarray(pageaddr, pageaddr + chunkSize);
      const actual    = await this.readFlash(wordAddr, chunkSize);

      for (let i = 0; i < chunkSize; i++) {
        if (actual[i] !== expected[i]) {
          throw new STK500VerifyError(pageaddr + i, expected[i], actual[i]);
        }
      }

      pageaddr += chunkSize;
      progressCallback?.((pageaddr / hex.length) * 100);
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

    progress('Resetting device',           0);
    await this.resetDevice();

    progress('Syncing',                    5);
    await this.sync(this.syncAttempts);

    progress('Verifying signature',       15);
    await this.verifySignature();

    progress('Configuring device',        20);
    await this.setDeviceDescriptor();

    progress('Entering programming mode', 25);
    await this.enterProgMode();

    progress('Erasing chip',              30);
    await this.chipErase();

    progress('Uploading',                 35);
    await this.upload(hexData, (pct) => {
      progress('Uploading', 35 + pct * 0.40);
    });

    progress('Verifying',                 75);
    await this.verify(hexData, (pct) => {
      progress('Verifying', 75 + pct * 0.20);
    });

    progress('Exiting programming mode',  95);
    await this.leaveProgMode();

    progress('Complete',                 100);
  }
}

// ── Device Descriptor Builder ──────────────────────────────────────────────

/**
 * Build a standard 52-byte STK500v2 device descriptor from board config.
 * Most wiring-bootloader implementations only check a few fields and ignore the rest.
 * Layout (AVR068 Table 10):
 *   [0-7]   ucReadIO[8]        — I/O read access mask
 *   [8-15]  ucReadIOShadow[8]  — shadow I/O read mask (zeros)
 *   [16-23] ucWriteIO[8]       — I/O write access mask
 *   [24-31] ucWriteIOShadow[8] — shadow I/O write mask (zeros)
 *   [32-33] uiFlashPageSize    — flash page size in bytes (LE)
 *   [34]    ucEepromPageSize   — EEPROM page size in bytes
 *   [35-38] ulBootAddress      — boot section word address (LE)
 *   [39-40] uiUpperBootSize    — boot section size in words (LE)
 *   [41-44] ulFlashSize        — total flash size in bytes (LE)
 *   [45-51] (reserved / zeros)
 */
function buildDefaultDescriptor(board: Board): Uint8Array {
  const desc = new Uint8Array(52); // zeros by default

  // I/O space read mask (typical for ATmega2560-class devices)
  desc[0]  = 0xB6; desc[1]  = 0xFF; desc[2]  = 0xFF; desc[3]  = 0xFF;
  desc[4]  = 0xFF; desc[5]  = 0x3F; desc[6]  = 0xFF; desc[7]  = 0xFF;
  // ucReadIOShadow[8] — zeros (8-15)

  // I/O space write mask
  desc[16] = 0xB4; desc[17] = 0x00; desc[18] = 0x00; desc[19] = 0x00;
  desc[20] = 0x00; desc[21] = 0x30; desc[22] = 0x00; desc[23] = 0x00;
  // ucWriteIOShadow[8] — zeros (24-31)

  // Flash page size (little-endian)
  const page = board.pageSize;
  desc[32] = page & 0xFF;
  desc[33] = (page >> 8) & 0xFF;

  // EEPROM page size
  desc[34] = board.eepromPageSize ?? 8;

  // Boot section start address (word address, little-endian)
  const boot = board.bootAddress ?? 0;
  desc[35] = boot & 0xFF;
  desc[36] = (boot >>  8) & 0xFF;
  desc[37] = (boot >> 16) & 0xFF;
  desc[38] = (boot >> 24) & 0xFF;

  // Upper boot section size (words, little-endian)
  const upper = board.upperBootSize ?? 0;
  desc[39] = upper & 0xFF;
  desc[40] = (upper >> 8) & 0xFF;

  // Flash size (bytes, little-endian)
  const flash = board.flashSize ?? 0;
  desc[41] = flash & 0xFF;
  desc[42] = (flash >>  8) & 0xFF;
  desc[43] = (flash >> 16) & 0xFF;
  desc[44] = (flash >> 24) & 0xFF;

  // Bytes 45-51 remain zero

  return desc;
}
