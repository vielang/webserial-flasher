// Receive a fixed-length response from the device.
//
// Fixes vs original:
//   1. settled flag prevents double-resolve after timeout
//   2. Timeout fires correctly even if INSYNC byte never arrives
//   3. Pre-allocated buffer avoids per-chunk Uint8Array concatenation
//   4. Cleanup always removes the data listener (no memory leak)

import type { ISTKTransport } from '../transport/ITransport.js';
import Constants from '../core/constants.js';
import { STK500TimeoutError } from '../core/errors.js';

const INSYNC_BYTE = Constants.Resp_STK_INSYNC; // 0x14

export default function receiveData(
  transport: ISTKTransport,
  timeoutMs: number,
  responseLength: number
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    // Pre-allocate to avoid repeated array construction on each chunk
    const buffer    = new Uint8Array(responseLength);
    let offset      = 0;
    let started     = false;
    let settled     = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      transport.off('data', handleChunk);
    };

    const finish = (err?: Error, data?: Uint8Array): void => {
      if (settled) return; // Guard against double-settle
      settled = true;
      cleanup();
      if (err) reject(err);
      else     resolve(data!);
    };

    const handleChunk = (chunk: Uint8Array): void => {
      if (settled) return;

      let chunkStart = 0;

      // Scan for the INSYNC sentinel byte before accumulating
      if (!started) {
        for (let i = 0; i < chunk.length; i++) {
          if (chunk[i] === INSYNC_BYTE) {
            chunkStart = i;
            started    = true;
            break;
          }
        }
        if (!started) return; // INSYNC not yet seen — keep waiting
      }

      const slice     = chunk.subarray(chunkStart);
      const remaining = responseLength - offset;
      const toCopy    = Math.min(slice.length, remaining);

      buffer.set(slice.subarray(0, toCopy), offset);
      offset += toCopy;

      if (offset === responseLength) {
        finish(undefined, buffer);
      } else if (offset > responseLength) {
        // Should never happen with toCopy clamping, but guard anyway
        finish(new Error(`Buffer overflow: received ${offset} > expected ${responseLength}`));
      }
    };

    // Install timeout — fires even if INSYNC never arrives
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        finish(new STK500TimeoutError(timeoutMs, 'waiting for device response'));
      }, timeoutMs);
    }

    transport.on('data', handleChunk);
  });
}
