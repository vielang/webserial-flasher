// AVR109 / Caterina programmer.
// Used by Arduino Leonardo, Micro, SparkFun Pro Micro, Esplora, LilyPad USB.
//
// The AVR109 protocol (also called "butterfly" or "Caterina" protocol) uses
// single-byte ASCII commands — completely different from STK500v1/v2.
//
// Entry: the board must already be in bootloader mode.
//   - For CDC USB boards (Leonardo/Micro): perform 1200-baud touch reset first,
//     wait for re-enumeration, then open the new port and construct this class.
//   - For serial-only boards: DTR/RTS toggle is sufficient.
//
// Reference: Atmel Application Note AVR109 (doc2541)

import {
  STK500ProtocolError,
  STK500TimeoutError,
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

/** Receive exactly `count` bytes, or reject with STK500TimeoutError */
function receiveBytes(
  transport: ISTKTransport,
  count: number,
  timeoutMs: number
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;
    const chunks: Uint8Array[] = [];
    let total = 0;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      transport.off('data', onData);
      reject(new STK500TimeoutError(timeoutMs, 'AVR109 response'));
    }, timeoutMs);

    const finish = (err?: Error, data?: Uint8Array): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      transport.off('data', onData);
      if (err) reject(err);
      else     resolve(data!);
    };

    const onData = (chunk: Uint8Array): void => {
      if (settled) return;
      chunks.push(chunk.slice());
      total += chunk.length;
      if (total >= count) {
        const buf = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { buf.set(c, off); off += c.length; }
        finish(undefined, buf.subarray(0, count));
      }
    };

    transport.on('data', onData);
  });
}

// CR (0x0D) is the acknowledge byte for most AVR109 commands
const CR = 0x0D;

export class AVR109 {
  private readonly log: Logger;

  constructor(
    private readonly transport: ISTKTransport,
    private readonly board: Board,
    opts: STK500Options = {}
  ) {
    if (opts.quiet) {
      this.log = () => {};
    } else if (opts.logger) {
      this.log = opts.logger;
    } else {
      this.log = (level, msg) => {
        /* istanbul ignore next */
        if (typeof console !== 'undefined') {
          console.log(`[avr109] [${level}] ${msg}`);
        }
      };
    }
  }

  // ── Low-level helpers ──────────────────────────────────────────────────────

  private async write(bytes: number[]): Promise<void> {
    await this.transport.write(new Uint8Array(bytes));
  }

  /** Send command bytes and assert the response is CR (0x0D) */
  private async writeCR(bytes: number[]): Promise<void> {
    await this.write(bytes);
    const resp = await receiveBytes(this.transport, 1, this.board.timeout);
    if (resp[0] !== CR) {
      throw new STK500ProtocolError(
        `AVR109: expected CR (0x0D), ` +
        `got 0x${resp[0].toString(16).padStart(2, '0')}`
      );
    }
  }

  // ── Identification ─────────────────────────────────────────────────────────

  /**
   * Read the software identifier (7 bytes, e.g. "CATERIN" for Caterina).
   * Useful for probing whether the bootloader is running.
   */
  async getSoftwareId(): Promise<string> {
    this.log('debug', 'getSoftwareId');
    await this.write([0x53]); // 'S'
    const bytes = await receiveBytes(this.transport, 7, this.board.timeout);
    return String.fromCharCode(...bytes);
  }

  /** Attempt to get the software ID, retry up to `attempts` times */
  async sync(attempts: number): Promise<void> {
    this.log('debug', `sync (max ${attempts} attempts)`);
    for (let i = 1; i <= attempts; i++) {
      try {
        const id = await this.getSoftwareId();
        this.log('debug', `sync OK on attempt ${i}: "${id}"`);
        return;
      } catch (err) {
        this.log(
          'debug',
          `sync attempt ${i}/${attempts} failed: ` +
          `${err instanceof Error ? err.message : String(err)}`
        );
        if (i < attempts) await sleep(200);
      }
    }
    throw new STK500SyncError(attempts);
  }

  // ── Signature ──────────────────────────────────────────────────────────────

  /**
   * Read 3-byte device signature (MSB first).
   * Caterina returns: [sig_byte_2, sig_byte_1, sig_byte_0]
   */
  async getSignature(): Promise<Uint8Array> {
    this.log('debug', 'getSignature');
    await this.write([0x73]); // 's'
    const raw = await receiveBytes(this.transport, 3, this.board.timeout);
    // AVR109 returns signature MSB first; reverse to match board.signature order
    return new Uint8Array([raw[2], raw[1], raw[0]]);
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

  // ── Programming mode ───────────────────────────────────────────────────────

  async enterProgMode(): Promise<void> {
    this.log('debug', 'enterProgMode');
    await this.writeCR([0x50]); // 'P'
  }

  async leaveProgMode(): Promise<void> {
    this.log('debug', 'leaveProgMode');
    await this.writeCR([0x45]); // 'E'
  }

  // ── Erase ──────────────────────────────────────────────────────────────────

  async chipErase(): Promise<void> {
    this.log('info', 'chipErase');
    await this.writeCR([0x65]); // 'e'
  }

  // ── Address ────────────────────────────────────────────────────────────────

  /**
   * Set the current word address (auto-increment applies to subsequent reads/writes).
   * @param wordAddr  Flash word address (= byte_address / 2)
   */
  async setAddress(wordAddr: number): Promise<void> {
    await this.writeCR([
      0x41,              // 'A'
      (wordAddr >> 8) & 0xFF,
      wordAddr & 0xFF,
    ]);
  }

  // ── Block write / read ─────────────────────────────────────────────────────

  /**
   * Write a block to flash ('F') or EEPROM ('E').
   * @param memType  'F' for flash, 'E' for EEPROM
   * @param data     Block data (size ≤ board.pageSize)
   */
  async writeBlock(memType: 'F' | 'E', data: Uint8Array): Promise<void> {
    const size = data.length;
    const body = new Uint8Array(4 + size);
    body[0] = 0x42; // 'B'
    body[1] = (size >> 8) & 0xFF;
    body[2] = size & 0xFF;
    body[3] = memType === 'F' ? 0x46 : 0x45; // 'F' or 'E'
    body.set(data, 4);
    await this.transport.write(body);
    const resp = await receiveBytes(this.transport, 1, this.board.timeout);
    if (resp[0] !== CR) {
      throw new STK500ProtocolError(
        `AVR109: block write failed — ` +
        `got 0x${resp[0].toString(16).padStart(2, '0')}`
      );
    }
  }

  /**
   * Read a block from flash ('F') or EEPROM ('E').
   * Address must be set with setAddress() first.
   * @param memType  'F' for flash, 'E' for EEPROM
   * @param size     Number of bytes to read
   */
  async readBlock(memType: 'F' | 'E', size: number): Promise<Uint8Array> {
    await this.write([
      0x67, // 'g'
      (size >> 8) & 0xFF,
      size & 0xFF,
      memType === 'F' ? 0x46 : 0x45,
    ]);
    return receiveBytes(this.transport, size, this.board.timeout);
  }

  // ── Fuse read (Phase C) ────────────────────────────────────────────────────

  /**
   * Read the low fuse byte.
   * Caterina command: 'F' (0x46) → 1 byte response
   */
  async readLowFuse(): Promise<number> {
    await this.write([0x46]); // 'F'
    const resp = await receiveBytes(this.transport, 1, this.board.timeout);
    return resp[0];
  }

  /**
   * Read the high fuse byte.
   * Caterina command: 'N' (0x4E) → 1 byte response
   */
  async readHighFuse(): Promise<number> {
    await this.write([0x4E]); // 'N'
    const resp = await receiveBytes(this.transport, 1, this.board.timeout);
    return resp[0];
  }

  /**
   * Read the lock bits.
   * Caterina command: 'r' (0x72) → 1 byte response
   */
  async readLockBits(): Promise<number> {
    await this.write([0x72]); // 'r'
    const resp = await receiveBytes(this.transport, 1, this.board.timeout);
    return resp[0];
  }

  /**
   * Read available fuse bytes: low, high, and lock bits.
   * Extended fuse is not accessible via AVR109.
   */
  async readFuses(): Promise<{ low: number; high: number; lock: number }> {
    const low  = await this.readLowFuse();
    const high = await this.readHighFuse();
    const lock = await this.readLockBits();
    this.log('info', `fuses: low=0x${low.toString(16)} high=0x${high.toString(16)} lock=0x${lock.toString(16)}`);
    return { low, high, lock };
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

    const blockSize = this.board.pageSize; // 128 for ATmega32U4

    let pageaddr = 0;
    while (pageaddr < hex.length) {
      const wordAddr  = pageaddr >> 1;
      const chunkSize = Math.min(blockSize, hex.length - pageaddr);
      const chunk     = hex.subarray(pageaddr, pageaddr + chunkSize);

      await this.setAddress(wordAddr);
      await this.writeBlock('F', chunk);

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

    const blockSize = this.board.pageSize;

    let pageaddr = 0;
    while (pageaddr < hex.length) {
      const wordAddr  = pageaddr >> 1;
      const chunkSize = Math.min(blockSize, hex.length - pageaddr);
      const expected  = hex.subarray(pageaddr, pageaddr + chunkSize);

      await this.setAddress(wordAddr);
      const actual = await this.readBlock('F', chunkSize);

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

  // ── Quit ───────────────────────────────────────────────────────────────────

  /**
   * Exit the bootloader — device resets and runs the new firmware.
   * No response is expected; device immediately resets on receiving 'Q'.
   */
  async quit(): Promise<void> {
    this.log('debug', 'quit');
    await this.transport.write(new Uint8Array([0x51])); // 'Q'
    await sleep(200); // give the device a moment to reset
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

    // Note: CDC touch reset must be done BEFORE constructing this object.
    // See CDCResetHelper for browser WebSerial usage.

    progress('Entering programming mode',  5);
    await this.enterProgMode();

    progress('Verifying signature',       10);
    await this.verifySignature();

    progress('Erasing chip',              20);
    await this.chipErase();

    progress('Uploading',                 25);
    await this.upload(hexData, (pct) => {
      progress('Uploading', 25 + pct * 0.50);
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
