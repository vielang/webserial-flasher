// Send a command and wait for the response.
//
// Fixes vs original:
//   1. Length check before Array.every() — prevents silent false-pass when
//      data.length > responseData.length (Array.every stops at caller length)
//   2. findIndex reports exact mismatch position in error messages
//   3. transport.write() is now async (Promise-based)

import type { ISTKTransport } from '../transport/ITransport.js';
import Constants from '../core/constants.js';
import { STK500ProtocolError } from '../core/errors.js';
import receiveData from './receiveData.js';

interface SendCommandOptions {
  /** Command bytes. Arrays automatically get Sync_CRC_EOP appended. */
  cmd: Uint8Array | readonly number[];
  /** Response timeout in ms. 0 = no timeout. */
  timeout?: number;
  /** Expected exact response bytes (length + content must match) */
  responseData?: Uint8Array;
  /** Expected response length when content doesn't need validation */
  responseLength?: number;
}

export default async function sendCommand(
  transport: ISTKTransport,
  opt: SendCommandOptions
): Promise<Uint8Array> {
  const timeout = opt.timeout ?? 0;

  // Determine how many bytes to collect
  let expectedLength = 0;
  if (opt.responseData && opt.responseData.length > 0) {
    expectedLength = opt.responseData.length;
  }
  if (opt.responseLength) {
    expectedLength = opt.responseLength; // responseLength wins over responseData.length
  }

  // Build the raw command — arrays get CRC_EOP appended, Uint8Arrays are sent as-is
  let cmd: Uint8Array;
  if (Array.isArray(opt.cmd)) {
    cmd = new Uint8Array([...(opt.cmd as number[]), Constants.Sync_CRC_EOP]);
  } else {
    cmd = opt.cmd as Uint8Array;
  }

  // Transmit
  await transport.write(cmd);

  // Collect response
  const data = await receiveData(transport, timeout, expectedLength);

  // Validate response content when caller provided expected bytes
  if (opt.responseData && opt.responseData.length > 0) {
    const expected = opt.responseData;

    if (data.length !== expected.length) {
      throw new STK500ProtocolError(
        `Response length mismatch: got ${data.length} bytes, expected ${expected.length}`
      );
    }

    const mismatchAt = data.findIndex((v, i) => v !== expected[i]);
    if (mismatchAt !== -1) {
      const hex = (b: Uint8Array): string =>
        Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(' ');
      throw new STK500ProtocolError(
        `Response mismatch at byte ${mismatchAt}: ` +
          `expected [${hex(expected)}], got [${hex(data)}]`
      );
    }
  }

  return data;
}
