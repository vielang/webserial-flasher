// Intel HEX parser — ported from https://github.com/bminer/intel-hex.js
// Rewrites and fixes:
//   1. REMOVED premature return when bufLength >= bufferSize (was 8192 bytes —
//      Arduino Uno .hex files are routinely 20-32 KB, causing silent truncation)
//   2. Buffer grows dynamically without fixed upper limit
//   3. Gap regions filled with 0xFF (unprogrammed flash default)
//   4. Throws typed STK500InvalidHexError instead of generic Error
//   5. Returns byteCount for progress calculation

import { STK500InvalidHexError } from '../core/errors.js';

const DATA               = 0;
const END_OF_FILE        = 1;
const EXT_SEGMENT_ADDR   = 2;
const START_SEGMENT_ADDR = 3;
const EXT_LINEAR_ADDR    = 4;
const START_LINEAR_ADDR  = 5;

const UNPROGRAMMED = 0xff; // Default flash value for gap regions

export interface ParseResult {
  /** Binary payload ready for upload */
  data: Uint8Array;
  /** CS:IP value from record type 3 (null if not present) */
  startSegmentAddress: number | null;
  /** EIP value from record type 5 (null if not present) */
  startLinearAddress: number | null;
  /** Total number of data bytes parsed */
  byteCount: number;
}

export function parseIntelHex(
  rawData: string | Uint8Array,
  addressOffset = 0
): ParseResult {
  const data =
    rawData instanceof Uint8Array
      ? new TextDecoder().decode(rawData)
      : rawData;

  // Start with 8 KB — grows as needed, no fixed ceiling
  let buf = new Uint8Array(8192);
  buf.fill(UNPROGRAMMED);
  let bufLength = 0;

  let highAddress      = 0;
  let startSegmentAddress: number | null = null;
  let startLinearAddress: number | null  = null;
  let lineNum = 0;
  let pos     = 0;

  // Minimum valid line: ':LLAAAATTCC' = 11 chars
  const MIN_LINE = 11;

  while (pos + MIN_LINE <= data.length) {
    // Each record starts with ':'
    if (data[pos++] !== ':') {
      throw new STK500InvalidHexError(
        `Line ${lineNum + 1} does not start with a colon (:) — got '${data[pos - 1]}'`,
        lineNum + 1
      );
    }
    lineNum++;

    // Parse fixed header fields
    const dataLength = parseInt(data.slice(pos, pos + 2), 16); pos += 2;
    const lowAddress = parseInt(data.slice(pos, pos + 4), 16); pos += 4;
    const recordType = parseInt(data.slice(pos, pos + 2), 16); pos += 2;

    // Parse data field
    const dataField = data.slice(pos, pos + dataLength * 2);
    pos += dataLength * 2;
    const checksum = parseInt(data.slice(pos, pos + 2), 16); pos += 2;

    const dataBytes = new Uint8Array(dataLength);
    for (let i = 0; i < dataLength; i++) {
      dataBytes[i] = parseInt(dataField.slice(i * 2, i * 2 + 2), 16);
    }

    // Verify checksum (two's complement of sum of all preceding bytes)
    let calcCS =
      (dataLength + ((lowAddress >> 8) & 0xff) + (lowAddress & 0xff) + recordType) & 0xff;
    for (let i = 0; i < dataLength; i++) {
      calcCS = (calcCS + dataBytes[i]) & 0xff;
    }
    calcCS = (0x100 - calcCS) & 0xff;

    if (checksum !== calcCS) {
      throw new STK500InvalidHexError(
        `Checksum error on line ${lineNum}: ` +
          `got 0x${checksum.toString(16).padStart(2, '0')}, ` +
          `expected 0x${calcCS.toString(16).padStart(2, '0')}`,
        lineNum
      );
    }

    switch (recordType) {
      case DATA: {
        const absAddr = highAddress + lowAddress - addressOffset;
        if (absAddr < 0) {
          throw new STK500InvalidHexError(
            `Negative address on line ${lineNum} after applying offset ${addressOffset}`,
            lineNum
          );
        }
        const endAddr = absAddr + dataLength;

        // Grow buffer if this record falls beyond current allocation
        if (endAddr > buf.length) {
          const newSize  = Math.max(endAddr * 2, buf.length * 2);
          const grown    = new Uint8Array(newSize);
          grown.fill(UNPROGRAMMED);
          grown.set(buf.subarray(0, bufLength));
          buf = grown;
        }

        // Fill any address gap with 0xFF (unprogrammed flash)
        if (absAddr > bufLength) {
          buf.fill(UNPROGRAMMED, bufLength, absAddr);
        }

        buf.set(dataBytes, absAddr);
        bufLength = Math.max(bufLength, endAddr);
        break;
      }

      case END_OF_FILE:
        if (dataLength !== 0) {
          throw new STK500InvalidHexError(
            `EOF record must have 0 data bytes, got ${dataLength} on line ${lineNum}`,
            lineNum
          );
        }
        return {
          data:               buf.subarray(0, bufLength),
          startSegmentAddress,
          startLinearAddress,
          byteCount:          bufLength,
        };

      case EXT_SEGMENT_ADDR:
        if (dataLength !== 2 || lowAddress !== 0) {
          throw new STK500InvalidHexError(
            `Invalid extended segment address record on line ${lineNum}`,
            lineNum
          );
        }
        highAddress = parseInt(dataField, 16) << 4;
        break;

      case START_SEGMENT_ADDR:
        if (dataLength !== 4 || lowAddress !== 0) {
          throw new STK500InvalidHexError(
            `Invalid start segment address record on line ${lineNum}`,
            lineNum
          );
        }
        startSegmentAddress = parseInt(dataField, 16);
        break;

      case EXT_LINEAR_ADDR:
        if (dataLength !== 2 || lowAddress !== 0) {
          throw new STK500InvalidHexError(
            `Invalid extended linear address record on line ${lineNum}`,
            lineNum
          );
        }
        highAddress = parseInt(dataField, 16) << 16;
        break;

      case START_LINEAR_ADDR:
        if (dataLength !== 4 || lowAddress !== 0) {
          throw new STK500InvalidHexError(
            `Invalid start linear address record on line ${lineNum}`,
            lineNum
          );
        }
        startLinearAddress = parseInt(dataField, 16);
        break;

      default:
        throw new STK500InvalidHexError(
          `Unknown record type 0x${recordType.toString(16).padStart(2, '0')} on line ${lineNum}`,
          lineNum
        );
    }

    // Skip CRLF or LF line endings
    if (data[pos] === '\r') pos++;
    if (data[pos] === '\n') pos++;
  }

  throw new STK500InvalidHexError(
    'Unexpected end of HEX data — missing EOF record (:00000001FF)'
  );
}
