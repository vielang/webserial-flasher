// STK500v2 message framing utilities.
//
// Frame format:
//   [MSG_START(0x1B)] [SEQ] [SIZE_H] [SIZE_L] [TOKEN(0x0E)] [BODY...] [CHECKSUM]
//
// Checksum = XOR of every byte from MSG_START through the last body byte.
//
// Both encode and decode are stateless — sequence tracking lives in the programmer.

import { MSG_START, MSG_TOKEN } from './constants.js';
import { STK500TimeoutError, STK500ProtocolError } from '../../core/errors.js';
import type { ISTKTransport } from '../../transport/ITransport.js';

// ── Encode ─────────────────────────────────────────────────────────────────

/**
 * Build a complete STK500v2 frame for the given sequence number and body bytes.
 * Body must be ≤ 65535 bytes (uint16 size field).
 */
export function encodeFrame(seq: number, body: number[] | Uint8Array): Uint8Array {
  const size  = body.length;
  const frame = new Uint8Array(6 + size); // header(5) + body(size) + checksum(1)

  frame[0] = MSG_START;
  frame[1] = seq & 0xFF;
  frame[2] = (size >> 8) & 0xFF;
  frame[3] = size & 0xFF;
  frame[4] = MSG_TOKEN;

  for (let i = 0; i < size; i++) {
    frame[5 + i] = (body as Uint8Array)[i]; // works for both number[] and Uint8Array
  }

  let checksum = 0;
  for (let i = 0; i < 5 + size; i++) checksum ^= frame[i];
  frame[5 + size] = checksum;

  return frame;
}

// ── Decode ─────────────────────────────────────────────────────────────────

/**
 * Wait for one complete STK500v2 frame on the transport and return its body bytes.
 * Silently discards any bytes before MSG_START.
 * Rejects with STK500TimeoutError if no valid frame arrives within timeoutMs.
 * Rejects with STK500ProtocolError if the token or checksum is wrong.
 */
export function receiveFrame(
  transport: ISTKTransport,
  timeoutMs: number
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      transport.off('data', onData);
      reject(new STK500TimeoutError(timeoutMs, 'STK500v2 response'));
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
      chunks.push(chunk.slice()); // defensive copy
      totalBytes += chunk.length;
      tryParse();
    };

    const tryParse = (): void => {
      // Flatten accumulated chunks into one contiguous buffer
      const buf = new Uint8Array(totalBytes);
      let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.length; }

      // Locate MSG_START
      let startIdx = -1;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === MSG_START) { startIdx = i; break; }
      }
      if (startIdx < 0) return; // No start byte yet

      // Need at least 5 bytes for the full header
      if (buf.length - startIdx < 5) return;

      // Validate TOKEN at position +4
      if (buf[startIdx + 4] !== MSG_TOKEN) {
        finish(new STK500ProtocolError(
          `STK500v2: invalid token 0x${buf[startIdx + 4].toString(16).padStart(2, '0')}, ` +
          `expected 0x0E at position ${startIdx + 4}`
        ));
        return;
      }

      const msgSize     = (buf[startIdx + 2] << 8) | buf[startIdx + 3];
      const totalNeeded = startIdx + 5 + msgSize + 1; // header + body + checksum

      if (buf.length < totalNeeded) return; // Not enough data yet — wait

      // Verify XOR checksum over everything from MSG_START to end of body
      let checksum = 0;
      for (let i = startIdx; i < totalNeeded - 1; i++) checksum ^= buf[i];

      if (checksum !== buf[totalNeeded - 1]) {
        finish(new STK500ProtocolError(
          `STK500v2: checksum mismatch — ` +
          `computed 0x${checksum.toString(16).padStart(2, '0')}, ` +
          `received 0x${buf[totalNeeded - 1].toString(16).padStart(2, '0')}`
        ));
        return;
      }

      finish(undefined, buf.slice(startIdx + 5, startIdx + 5 + msgSize));
    };

    transport.on('data', onData);
  });
}
