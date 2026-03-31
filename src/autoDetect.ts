// Auto-detection: probe an unknown target and determine its protocol + board.
//
// Tries each protocol in order with a short timeout:
//   1. STK500v1 — GET_SYNC (most common: Uno, Nano, Pro Mini)
//   2. STK500v2 — SIGN_ON  (Mega 2560, Mega 1280)
//   3. AVR109   — get software ID (Leonardo, Micro, Pro Micro)
//   4. UPDI     — LDCS(STATUSA) + SIGROW read (opt-in via includeUpdi)
//
// UPDI probe is opt-in because it requires:
//   a) The transport to support sendBreak()
//   b) The serial port to be opened at 8E2 (even parity, 2 stop bits)
// Enable it by setting `includeUpdi: true` in options.
//
// Usage:
//   const result = await autoDetect(transport, { probeTimeoutMs: 300 });
//   if (result) {
//     console.log(result.protocol, result.board?.name, result.signature);
//   }

import { STK500  }    from './stk500.js';
import { STK500v2 }   from './protocol/stk500v2/programmer.js';
import { AVR109 }     from './protocol/avr109/programmer.js';
import { UPDILink }   from './protocol/updi/link.js';
import {
  UPDI_CS_STATUSA,
  SIGROW_BASE,
} from './protocol/updi/constants.js';
import {
  BOARDS,
  detectBoardBySignature,
} from './boards/database.js';
import type { Board } from './core/types.js';
import type { ISTKTransport } from './transport/ITransport.js';

/** Result from a successful auto-detect probe */
export interface AutoDetectResult {
  /** Detected bootloader protocol */
  protocol: 'stk500v1' | 'stk500v2' | 'avr109' | 'updi';
  /** Raw 3-byte device signature */
  signature: Uint8Array;
  /** Matched board, or undefined if the signature is unknown */
  board: Board | undefined;
}

export interface AutoDetectOptions {
  /**
   * Timeout (ms) for each individual protocol probe attempt.
   * Shorter = faster detection but may miss slow bootloaders.
   * Default: 300
   */
  probeTimeoutMs?: number;
  /** Suppress all log output during probing (default: true) */
  quiet?: boolean;
  /**
   * Also probe for UPDI devices (tinyAVR, ATmega4809).
   *
   * Requires:
   *   - transport.sendBreak() to be available
   *   - Serial port already opened at 8E2 (even parity, 2 stop bits)
   *
   * Default: false
   */
  includeUpdi?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Probe board for a given transport — detect protocol and signature. */
export async function autoDetect(
  transport: ISTKTransport,
  opts: AutoDetectOptions = {}
): Promise<AutoDetectResult | null> {
  const timeout = opts.probeTimeoutMs ?? 300;
  const quiet   = opts.quiet !== false; // default quiet=true

  // Minimal probe board — only timeout matters for probing
  const probeBoard: Board = {
    ...BOARDS['arduino-uno']!,
    timeout,
  };

  // ── 1. STK500v1 ────────────────────────────────────────────────────────────
  try {
    const stk = new STK500(transport, probeBoard, {
      quiet,
      retry: { syncAttempts: 1, retryDelayMs: 0 },
    });
    await stk.sync(1);
    const sig   = await stk.getSignature();
    const board = detectBoardBySignature(sig) ?? undefined;
    return { protocol: 'stk500v1', signature: sig, board };
  } catch { /* not STK500v1 */ }

  // ── 2. STK500v2 ────────────────────────────────────────────────────────────
  try {
    const probeV2Board: Board = { ...BOARDS['arduino-mega2560']!, timeout };
    const stk2 = new STK500v2(transport, probeV2Board, {
      quiet,
      retry: { syncAttempts: 1, retryDelayMs: 0 },
    });
    await stk2.sync(1);
    const sig   = await stk2.readSignature();
    const board = detectBoardBySignature(sig) ?? undefined;
    return { protocol: 'stk500v2', signature: sig, board };
  } catch { /* not STK500v2 */ }

  // ── 3. AVR109 ──────────────────────────────────────────────────────────────
  try {
    const probeAvrBoard: Board = { ...BOARDS['arduino-leonardo']!, timeout };
    const avr = new AVR109(transport, probeAvrBoard, { quiet });
    await avr.sync(1);
    const sig   = await avr.getSignature();
    const board = detectBoardBySignature(sig) ?? undefined;
    return { protocol: 'avr109', signature: sig, board };
  } catch { /* not AVR109 */ }

  // ── 4. UPDI (opt-in) ───────────────────────────────────────────────────────
  // Requires the transport to support sendBreak() and the port to be opened
  // at 8E2 settings. Enable via opts.includeUpdi = true.
  if (opts.includeUpdi && transport.sendBreak) {
    try {
      // Use a probe board whose timeout controls how long we wait for each byte
      const probeUpdiBoard: Board = { ...BOARDS['attiny412']!, timeout };
      const link = new UPDILink(transport, probeUpdiBoard, () => {});

      // 1. Reset UPDI state machine
      await transport.sendBreak();
      await sleep(5); // settling time

      // 2. Read STATUSA register — any non-0xFF response means UPDI is alive
      const statusa = await link.ldcs(UPDI_CS_STATUSA);
      if (statusa === 0xFF) throw new Error('UPDI STATUSA=0xFF — no device');

      // 3. Read 3-byte device signature from SIGROW (address 0x1100–0x1102)
      const sig = await link.readMemory(SIGROW_BASE, 3);

      const board = detectBoardBySignature(sig) ?? undefined;
      return { protocol: 'updi', signature: sig, board };
    } catch { /* not UPDI or transport does not support sendBreak */ }
  }

  return null;
}
