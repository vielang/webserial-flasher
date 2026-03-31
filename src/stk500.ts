// STK500v1 programmer — main class.
//
// Full rewrite addressing:
//   - DTR/RTS reset before sync (bootloader entry)
//   - Chip erase before programming
//   - Real verify (readback + byte comparison, not echo validation)
//   - Complete setOptions (all 20 SET_DEVICE parameters)
//   - Typed errors (STK500SyncError, STK500SignatureMismatchError, etc.)
//   - Retry with configurable backoff
//   - Transport abstraction (Node.js SerialPort or WebSerial)
//   - Levelled logging (debug / info / warn / error)

import Constants from './core/constants.js';
import {
  STK500SyncError,
  STK500SignatureMismatchError,
  STK500VerifyError,
  STK500ProtocolError,
  STK500InvalidHexError,
} from './core/errors.js';
import type {
  Board,
  STK500Options,
  BootloadProgressCallback,
  Logger,
} from './core/types.js';
import type { ISTKTransport } from './transport/ITransport.js';
import sendCommand from './protocol/sendCommand.js';
import { parseIntelHex } from './protocol/hexParser.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class STK500 {
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
          console.log(`[arduino-flasher] [${level}] ${msg}`);
        }
      };
    }
  }

  // ─── Reset ────────────────────────────────────────────────────────────────

  /**
   * Toggle DTR or RTS to force the Arduino into bootloader mode.
   * Skipped automatically when board.resetMethod === 'none' or when
   * the transport does not implement setSignals().
   */
  async resetDevice(): Promise<void> {
    const method = this.board.resetMethod ?? 'dtr';
    const delay  = this.board.resetDelayMs ?? 200;

    if (method === 'none') {
      this.log('debug', 'resetDevice: skipped (resetMethod=none)');
      return;
    }
    if (!this.transport.setSignals) {
      this.log('debug', 'resetDevice: transport has no setSignals() — skipping');
      return;
    }

    this.log('info', `resetDevice: toggling ${method.toUpperCase()}`);

    const low  = method === 'dtr' ? { dtr: false } : { rts: false };
    const high = method === 'dtr' ? { dtr: true  } : { rts: true  };

    await this.transport.setSignals(low);
    await sleep(delay);
    await this.transport.setSignals(high);
    await sleep(delay); // Give bootloader time to start listening
  }

  // ─── Sync ─────────────────────────────────────────────────────────────────

  /**
   * Send GET_SYNC up to `attempts` times.
   * Throws STK500SyncError if all attempts fail.
   */
  async sync(attempts: number): Promise<Uint8Array> {
    this.log('debug', `sync (max ${attempts} attempts)`);

    for (let i = 1; i <= attempts; i++) {
      try {
        const data = await sendCommand(this.transport, {
          cmd:          [Constants.Cmnd_STK_GET_SYNC],
          responseData: Constants.OK_RESPONSE,
          timeout:      this.board.timeout,
        });
        this.log('debug', `sync OK on attempt ${i}`);
        return data;
      } catch (err) {
        this.log(
          'debug',
          `sync attempt ${i}/${attempts} failed: ${err instanceof Error ? err.message : String(err)}`
        );
        if (i < attempts) await sleep(this.retryDelayMs);
      }
    }

    throw new STK500SyncError(attempts);
  }

  // ─── Signature ────────────────────────────────────────────────────────────

  /**
   * Read the device signature and verify it matches board.signature.
   * Throws STK500SignatureMismatchError when wrong board type is selected.
   */
  async verifySignature(): Promise<Uint8Array> {
    this.log('debug', 'verifySignature');

    // Response: [INSYNC, sig0, sig1, sig2, OK]  = 5 bytes
    const data = await sendCommand(this.transport, {
      cmd:            [Constants.Cmnd_STK_READ_SIGN],
      responseLength: 5,
      timeout:        this.board.timeout,
    });

    const actual   = data.subarray(1, 4); // Strip INSYNC and OK framing
    const expected = this.board.signature;

    if (!actual.every((b, i) => b === expected[i])) {
      throw new STK500SignatureMismatchError(expected, actual);
    }

    const fmt = (b: Uint8Array): string =>
      Array.from(b).map((x) => `0x${x.toString(16).padStart(2, '0')}`).join(', ');
    this.log('info', `signature verified: [${fmt(actual)}]`);

    return data;
  }

  /**
   * Read the raw device signature without matching against a board.
   * Useful for auto-detecting the board type.
   */
  async getSignature(): Promise<Uint8Array> {
    this.log('debug', 'getSignature');

    const data = await sendCommand(this.transport, {
      cmd:            [Constants.Cmnd_STK_READ_SIGN],
      responseLength: 5,
      timeout:        this.board.timeout,
    });

    return data.subarray(1, 4);
  }

  // ─── Device Configuration ─────────────────────────────────────────────────

  /**
   * Send SET_DEVICE with full 20-parameter configuration.
   * Merges board defaults with any override values passed in `options`.
   * Previously sent only 2 of the required 20 parameters — now complete.
   */
  async setOptions(options: Partial<Record<string, number>> = {}): Promise<void> {
    this.log('debug', 'setOptions');

    const b = this.board;
    const o = options;

    await sendCommand(this.transport, {
      cmd: [
        Constants.Cmnd_STK_SET_DEVICE,
        o['devicecode']    ?? b.deviceCode       ?? 0,
        o['revision']      ?? 0,
        o['progtype']      ?? b.progType         ?? 0,
        o['parmode']       ?? b.parMode          ?? 0,
        o['polling']       ?? b.polling          ?? 0,
        o['selftimed']     ?? b.selfTimed        ?? 0,
        o['lockbytes']     ?? b.lockBytes        ?? 0,
        o['fusebytes']     ?? b.fuseBytes        ?? 0,
        o['flashpollval1'] ?? b.flashPollVal1    ?? 0xff,
        o['flashpollval2'] ?? b.flashPollVal2    ?? 0xff,
        o['eeprompollval1'] ?? b.eepromPollVal1  ?? 0xff,
        o['eeprompollval2'] ?? b.eepromPollVal2  ?? 0xff,
        // Page size as two bytes (high, low)
        (b.pageSize >> 8) & 0xff,
        b.pageSize & 0xff,
        // EEPROM size as two bytes
        ((b.eepromSize ?? 0) >> 8) & 0xff,
        (b.eepromSize ?? 0) & 0xff,
        // Flash size as four bytes (MSB first)
        ((b.flashSize ?? 0) >> 24) & 0xff,
        ((b.flashSize ?? 0) >> 16) & 0xff,
        ((b.flashSize ?? 0) >>  8) & 0xff,
        (b.flashSize ?? 0) & 0xff,
      ],
      responseData: Constants.OK_RESPONSE,
      timeout:      this.board.timeout,
    });
  }

  // ─── Programming Mode ─────────────────────────────────────────────────────

  async enterProgrammingMode(): Promise<Uint8Array> {
    this.log('debug', 'enterProgrammingMode');
    return sendCommand(this.transport, {
      cmd:          [Constants.Cmnd_STK_ENTER_PROGMODE],
      responseData: Constants.OK_RESPONSE,
      timeout:      this.board.timeout,
    });
  }

  async exitProgrammingMode(): Promise<Uint8Array> {
    this.log('debug', 'exitProgrammingMode');
    return sendCommand(this.transport, {
      cmd:          [Constants.Cmnd_STK_LEAVE_PROGMODE],
      responseData: Constants.OK_RESPONSE,
      timeout:      this.board.timeout,
    });
  }

  // ─── Erase ────────────────────────────────────────────────────────────────

  /** Erase the entire flash. Must be called before programming. */
  async chipErase(): Promise<void> {
    this.log('info', 'chipErase');
    await sendCommand(this.transport, {
      cmd:          [Constants.Cmnd_STK_CHIP_ERASE],
      responseData: Constants.OK_RESPONSE,
      timeout:      this.board.timeout,
    });
    await sleep(this.board.eraseDelayMs ?? 10);
  }

  // ─── Address / Page Helpers ───────────────────────────────────────────────

  async loadAddress(useaddr: number): Promise<Uint8Array> {
    return sendCommand(this.transport, {
      cmd:          [Constants.Cmnd_STK_LOAD_ADDRESS, useaddr & 0xff, (useaddr >> 8) & 0xff],
      responseData: Constants.OK_RESPONSE,
      timeout:      this.board.timeout,
    });
  }

  async loadPage(writeBytes: Uint8Array): Promise<Uint8Array> {
    if (writeBytes.length > this.board.pageSize) {
      throw new STK500ProtocolError(
        `loadPage: ${writeBytes.length} bytes exceeds page size ${this.board.pageSize}`
      );
    }

    // Command: [CMND, size_high, size_low, 'F'(0x46=Flash), ...data..., CRC_EOP]
    const cmd = new Uint8Array([
      Constants.Cmnd_STK_PROG_PAGE,
      (writeBytes.length >> 8) & 0xff,
      writeBytes.length & 0xff,
      0x46, // 'F' = Flash
      ...writeBytes,
      Constants.Sync_CRC_EOP,
    ]);

    return sendCommand(this.transport, {
      cmd,
      responseData: Constants.OK_RESPONSE,
      timeout:      this.board.timeout,
    });
  }

  /**
   * Read one page from device flash.
   * Returns only the data bytes (INSYNC/OK framing stripped).
   */
  async readPage(wordAddr: number, size: number): Promise<Uint8Array> {
    await this.loadAddress(wordAddr);

    // Response: [INSYNC, ...size data bytes..., OK] = size + 2
    const response = await sendCommand(this.transport, {
      cmd: [
        Constants.Cmnd_STK_READ_PAGE,
        (size >> 8) & 0xff,
        size & 0xff,
        0x46, // 'F' = Flash
      ],
      responseLength: size + 2,
      timeout:        this.board.timeout,
    });

    return response.subarray(1, size + 1);
  }

  // ─── Universal SPI (fuse / lock bit access) ───────────────────────────────

  /**
   * Issue a raw 4-byte SPI command via the STK500v1 UNIVERSAL command (0x56).
   * Returns the 4th byte of the SPI response, which is the data byte.
   *
   * Example: await stk.universalSpi([0x50, 0x00, 0x00, 0x00]) → low fuse byte
   */
  async universalSpi(spiCmd: [number, number, number, number]): Promise<number> {
    const response = await sendCommand(this.transport, {
      cmd:            [Constants.Cmnd_STK_UNIVERSAL, ...spiCmd],
      responseLength: 6, // [INSYNC, r0, r1, r2, r3, OK]
      timeout:        this.board.timeout,
    });
    return response[4] ?? 0; // 4th SPI response byte
  }

  /**
   * Read all fuse bytes via SPI UNIVERSAL commands.
   * Returns { low, high, ext, lock } fuse values.
   */
  async readFuses(): Promise<{ low: number; high: number; ext: number; lock: number }> {
    this.log('debug', 'readFuses');
    const low  = await this.universalSpi([0x50, 0x00, 0x00, 0x00]);
    const high = await this.universalSpi([0x58, 0x08, 0x00, 0x00]);
    const ext  = await this.universalSpi([0x50, 0x08, 0x00, 0x00]);
    const lock = await this.universalSpi([0x58, 0x00, 0x00, 0x00]);
    this.log('info', `fuses: low=0x${low.toString(16)} high=0x${high.toString(16)} ext=0x${ext.toString(16)} lock=0x${lock.toString(16)}`);
    return { low, high, ext, lock };
  }

  /**
   * Write fuse bytes via SPI UNIVERSAL commands.
   * @param fuse  Which fuse to write: 'low' | 'high' | 'ext' | 'lock'
   * @param val   New fuse value
   */
  async writeFuse(fuse: 'low' | 'high' | 'ext' | 'lock', val: number): Promise<void> {
    this.log('debug', `writeFuse: ${fuse}=0x${val.toString(16)}`);
    const cmds: Record<string, [number, number, number, number]> = {
      low:  [0xAC, 0xA0, 0x00, val],
      high: [0xAC, 0xA8, 0x00, val],
      ext:  [0xAC, 0xA4, 0x00, val],
      lock: [0xAC, 0xE0, 0x00, val],
    };
    await this.universalSpi(cmds[fuse]!);
    await sleep(10); // fuse write delay
  }

  /**
   * Write one EEPROM page.
   * @param byteAddr  Byte address in EEPROM (NOT word address)
   * @param data      Data to write (length ≤ board.pageSize)
   */
  async writeEepromPage(byteAddr: number, data: Uint8Array): Promise<void> {
    // EEPROM uses byte addresses and memType 'E' (0x45)
    const addrForLoad = this.board.use8BitAddresses ? byteAddr : byteAddr >> 1;
    await this.loadAddress(addrForLoad);

    const cmd = new Uint8Array([
      Constants.Cmnd_STK_PROG_PAGE,
      (data.length >> 8) & 0xff,
      data.length & 0xff,
      0x45, // 'E' = EEPROM
      ...data,
      Constants.Sync_CRC_EOP,
    ]);

    await sendCommand(this.transport, {
      cmd,
      responseData: Constants.OK_RESPONSE,
      timeout:      this.board.timeout,
    });
  }

  /**
   * Read one EEPROM page.
   * @param byteAddr  Byte address in EEPROM
   * @param size      Number of bytes to read
   */
  async readEepromPage(byteAddr: number, size: number): Promise<Uint8Array> {
    const addrForLoad = this.board.use8BitAddresses ? byteAddr : byteAddr >> 1;
    await this.loadAddress(addrForLoad);

    const response = await sendCommand(this.transport, {
      cmd: [
        Constants.Cmnd_STK_READ_PAGE,
        (size >> 8) & 0xff,
        size & 0xff,
        0x45, // 'E' = EEPROM
      ],
      responseLength: size + 2,
      timeout:        this.board.timeout,
    });

    return response.subarray(1, size + 1);
  }

  // ─── Upload ───────────────────────────────────────────────────────────────

  async upload(
    hexData: string | Uint8Array,
    progressCallback?: (percentage: number) => void
  ): Promise<void> {
    this.log('info', 'upload: parsing HEX');
    const { data: hex, byteCount } = parseIntelHex(hexData);
    this.log('info', `upload: ${byteCount} bytes to write`);

    // Phase G: HEX size validation
    if (this.board.flashSize && byteCount > this.board.flashSize) {
      throw new STK500InvalidHexError(
        `HEX too large: ${byteCount} bytes exceeds flash size ${this.board.flashSize} bytes`
      );
    }

    let pageaddr = 0;
    while (pageaddr < hex.length) {
      const useaddr   = this.board.use8BitAddresses ? pageaddr : pageaddr >> 1;
      const chunkSize = Math.min(this.board.pageSize, hex.length - pageaddr);
      const chunk     = hex.subarray(pageaddr, pageaddr + chunkSize);

      await this.loadAddress(useaddr);
      await this.loadPage(chunk);

      pageaddr += chunkSize;
      await sleep(4); // Brief yield — device writes the page to flash
      progressCallback?.((pageaddr / hex.length) * 100);
    }

    this.log('info', 'upload complete');
  }

  // ─── Verify ───────────────────────────────────────────────────────────────

  /**
   * Read back flash and compare byte-by-byte against the HEX source.
   *
   * Fixed vs original: the original sent READ_PAGE but discarded the response,
   * making verify() a no-op. This version actually reads and compares.
   */
  async verify(
    hexData: string | Uint8Array,
    progressCallback?: (percentage: number) => void
  ): Promise<void> {
    this.log('info', 'verify: parsing HEX');
    const { data: hex, byteCount } = parseIntelHex(hexData);
    this.log('info', `verify: checking ${byteCount} bytes`);

    let pageaddr = 0;
    while (pageaddr < hex.length) {
      const useaddr   = this.board.use8BitAddresses ? pageaddr : pageaddr >> 1;
      const chunkSize = Math.min(this.board.pageSize, hex.length - pageaddr);
      const expected  = hex.subarray(pageaddr, pageaddr + chunkSize);

      const actual = await this.readPage(useaddr, chunkSize);

      for (let i = 0; i < chunkSize; i++) {
        if (actual[i] !== expected[i]) {
          throw new STK500VerifyError(pageaddr + i, expected[i], actual[i]);
        }
      }

      pageaddr += chunkSize;
      await sleep(4);
      progressCallback?.((pageaddr / hex.length) * 100);
    }

    this.log('info', 'verify OK — flash matches HEX');
  }

  // ─── bootload (main entry point) ──────────────────────────────────────────

  /**
   * Complete programming sequence:
   *   reset → sync → verify signature → configure device →
   *   enter prog mode → erase chip → upload → verify → exit prog mode
   *
   * @param hexData Intel HEX string or binary
   * @param progressCallback Called with (status, 0–100) at each stage
   */
  async bootload(
    hexData: string | Uint8Array,
    progressCallback?: BootloadProgressCallback
  ): Promise<void> {
    const progress = (status: string, pct: number): void => {
      this.log('info', `${status} (${Math.round(pct)}%)`);
      progressCallback?.(status, pct);
    };

    // 1 ── Reset device so bootloader is listening
    progress('Resetting device', 0);
    await this.resetDevice();

    // 2 ── Sync: retry several times — bootloader may need a moment
    progress('Syncing', 5);
    await this.sync(this.syncAttempts);
    await this.sync(3); // Second sync for reliability

    // 3 ── Confirm we're talking to the expected chip
    progress('Verifying signature', 15);
    await this.verifySignature();

    // 4 ── Send device parameters
    progress('Configuring device', 20);
    await this.setOptions();

    // 5 ── Enter programming mode
    progress('Entering programming mode', 25);
    await this.enterProgrammingMode();

    // 6 ── Erase flash before writing
    progress('Erasing chip', 30);
    await this.chipErase();

    // 7 ── Write firmware (35 → 75%)
    progress('Uploading', 35);
    await this.upload(hexData, (pct) => {
      progress('Uploading', 35 + pct * 0.40);
    });

    // 8 ── Read back and verify (75 → 95%)
    progress('Verifying', 75);
    await this.verify(hexData, (pct) => {
      progress('Verifying', 75 + pct * 0.20);
    });

    // 9 ── Exit programming mode — board resets and runs new firmware
    progress('Exiting programming mode', 95);
    await this.exitProgrammingMode();

    progress('Complete', 100);
  }
}
