// Auto-detection: probe an unknown target and determine its protocol + board.
//
// Tries each protocol in order with a short timeout:
//   1. STK500v1 — GET_SYNC (most common: Uno, Nano, Pro Mini)
//   2. STK500v2 — SIGN_ON  (Mega 2560, Mega 1280)
//   3. AVR109   — get software ID (Leonardo, Micro, Pro Micro)
//
// UPDI devices require a BREAK condition first and cannot be auto-detected
// in this manner — callers must select UPDI explicitly.
//
// Usage:
//   const result = await autoDetect(transport, { probeTimeoutMs: 300 });
//   if (result) {
//     console.log(result.protocol, result.board?.name, result.signature);
//   }

import { STK500  }    from './stk500.js';
import { STK500v2 }   from './protocol/stk500v2/programmer.js';
import { AVR109 }     from './protocol/avr109/programmer.js';
import {
  BOARDS,
  detectBoardBySignature,
} from './boards/database.js';
import type { Board } from './core/types.js';
import type { ISTKTransport } from './transport/ITransport.js';

/** Result from a successful auto-detect probe */
export interface AutoDetectResult {
  /** Detected bootloader protocol */
  protocol: 'stk500v1' | 'stk500v2' | 'avr109';
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

  return null;
}
