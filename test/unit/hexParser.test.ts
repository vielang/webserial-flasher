import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntelHex } from '../../src/protocol/hexParser.js';
import { STK500InvalidHexError } from '../../src/core/errors.js';

// ── Minimal valid HEX fixtures ─────────────────────────────────────────────

// Single 4-byte data record at address 0x0000 + EOF
// Checksum: (4+0+0+0+1+2+3+4)=0x0E → 0x100-0x0E = 0xF2
const SIMPLE_HEX = [
  ':0400000001020304F2',
  ':00000001FF',
].join('\n');

// Two records: one at 0x0000, one at 0x0100 (creates a 256-byte gap filled with 0xFF)
// Second record checksum: (4+0x01+0x00+0+1+2+3+4)=0x0F → 0x100-0x0F = 0xF1
const SPARSE_HEX = [
  ':0400000001020304F2',  // 4 bytes at 0x0000
  ':0401000001020304F1',  // 4 bytes at 0x0100
  ':00000001FF',
].join('\n');

// HEX larger than the old 8192-byte default bufferSize limit
function buildLargeHex(byteCount: number): string {
  const lines: string[] = [];
  let address = 0;
  const remaining = { count: byteCount };

  while (remaining.count > 0) {
    const lineBytes = Math.min(16, remaining.count);
    const addrHigh  = (address >> 8) & 0xff;
    const addrLow   = address & 0xff;
    const data      = new Array(lineBytes).fill(0xaa);

    let checksum =
      (lineBytes + addrHigh + addrLow + 0 /* DATA */) & 0xff;
    data.forEach((b) => { checksum = (checksum + b) & 0xff; });
    checksum = (0x100 - checksum) & 0xff;

    const hex = [
      ':',
      lineBytes.toString(16).padStart(2, '0').toUpperCase(),
      addrHigh.toString(16).padStart(2, '0').toUpperCase(),
      addrLow.toString(16).padStart(2, '0').toUpperCase(),
      '00',
      ...data.map((b: number) => b.toString(16).padStart(2, '0').toUpperCase()),
      checksum.toString(16).padStart(2, '0').toUpperCase(),
    ].join('');

    lines.push(hex);
    address          += lineBytes;
    remaining.count  -= lineBytes;
  }

  lines.push(':00000001FF');
  return lines.join('\n');
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('hexParser', () => {
  test('parses simple HEX record', () => {
    const { data, byteCount } = parseIntelHex(SIMPLE_HEX);
    assert.equal(byteCount, 4);
    assert.deepEqual(data, new Uint8Array([0x01, 0x02, 0x03, 0x04]));
  });

  test('fills gaps between sparse records with 0xFF', () => {
    const { data, byteCount } = parseIntelHex(SPARSE_HEX);
    // 0x0000..0x0003 = [01 02 03 04], 0x0004..0x00FF = 0xFF, 0x0100..0x0103 = [01 02 03 04]
    assert.equal(byteCount, 0x0104);
    assert.equal(data[0], 0x01);
    assert.equal(data[3], 0x04);
    assert.equal(data[4], 0xff);  // gap
    assert.equal(data[255], 0xff); // gap
    assert.equal(data[256], 0x01); // second record
    assert.equal(data[259], 0x04);
  });

  test('parses files larger than 8192 bytes without truncation', () => {
    // This exposed the original premature-return bug
    const hexStr = buildLargeHex(20000);
    const { byteCount } = parseIntelHex(hexStr);
    assert.equal(byteCount, 20000, 'should parse all 20000 bytes');
  });

  test('parses a 32 KB Arduino Uno-sized file', () => {
    const hexStr = buildLargeHex(32768);
    const { byteCount } = parseIntelHex(hexStr);
    assert.equal(byteCount, 32768);
  });

  test('validates checksums and throws on mismatch', () => {
    const bad = ':0400000001020304FF\n:00000001FF'; // checksum 0xFF, expected 0xF4
    assert.throws(
      () => parseIntelHex(bad),
      (err: unknown) => {
        assert(err instanceof STK500InvalidHexError);
        assert(err.message.includes('Checksum error'));
        return true;
      }
    );
  });

  test('throws when colon is missing', () => {
    const bad = '0400000001020304F4\n:00000001FF';
    assert.throws(() => parseIntelHex(bad), STK500InvalidHexError);
  });

  test('throws on unknown record type', () => {
    // Record type 0x06 is undefined
    const bad = ':040000060102030400\n:00000001FF';
    assert.throws(() => parseIntelHex(bad), STK500InvalidHexError);
  });

  test('throws when EOF record is missing', () => {
    const noEof = ':0400000001020304F4';
    assert.throws(() => parseIntelHex(noEof), STK500InvalidHexError);
  });

  test('accepts Uint8Array input', () => {
    const bytes = new TextEncoder().encode(SIMPLE_HEX);
    const { byteCount } = parseIntelHex(bytes);
    assert.equal(byteCount, 4);
  });

  test('handles CRLF line endings', () => {
    const crlf = SIMPLE_HEX.replace(/\n/g, '\r\n');
    const { byteCount } = parseIntelHex(crlf);
    assert.equal(byteCount, 4);
  });

  test('extended linear address (type 4) updates highAddress', () => {
    // EXT_LINEAR_ADDR 0x0001: LL=02, AAAA=0000, TT=04, data=[0x00,0x01]="0001"
    //   checksum: (2+0+0+4+0+1)=7 → 0x100-7 = 0xF9
    //   correct record = :020000040001F9  (NOT :02000004000100F9)
    // DATA at 0x00010000 checksum: F2
    const hex = [
      ':020000040001F9',             // EXT_LINEAR_ADDR: set high = 0x0001
      ':0400000001020304F2',          // DATA at (0x0001_0000 + 0x0000)
      ':00000001FF',
    ].join('\n');
    const { byteCount } = parseIntelHex(hex);
    assert.equal(byteCount, 0x10004); // 0x00010000 + 4
  });

  test('returns startLinearAddress from type-5 record', () => {
    // Checksum for START_LINEAR_ADDR 0x00000000:
    //   (4+0+0+5+0+0+0+0)=9 → 0x100-9 = 0xF7
    // Checksum for data record 01020304:
    //   (4+0+0+0+1+2+3+4)=0x0E → 0x100-0x0E = 0xF2
    const fixture = [
      ':0400000001020304F2',
      ':0400000500000000F7', // START_LINEAR_ADDR = 0x00000000
      ':00000001FF',
    ].join('\n');
    const { startLinearAddress } = parseIntelHex(fixture);
    assert.equal(startLinearAddress, 0);
  });
});
