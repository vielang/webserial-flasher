import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseUf2, binaryToUf2, isUf2 } from '../../src/protocol/picoboot/uf2.js';
import { STK500InvalidHexError } from '../../src/core/errors.js';
import {
  UF2_MAGIC_START0, UF2_MAGIC_START1, UF2_MAGIC_END,
  UF2_FLAG_FAMILY_ID, UF2_PAYLOAD_SIZE, UF2_BLOCK_SIZE,
  UF2_FAMILY_RP2040, RP2040_FLASH_BASE,
} from '../../src/protocol/picoboot/constants.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal valid UF2 file with `numBlocks` blocks of `payload` data */
function makeUf2(payloads: Uint8Array[], baseAddr = RP2040_FLASH_BASE): Uint8Array {
  const numBlocks = payloads.length;
  const out  = new Uint8Array(numBlocks * UF2_BLOCK_SIZE);
  const view = new DataView(out.buffer);
  for (let i = 0; i < numBlocks; i++) {
    const off  = i * UF2_BLOCK_SIZE;
    const addr = baseAddr + i * UF2_PAYLOAD_SIZE;
    view.setUint32(off + 0,   UF2_MAGIC_START0,   true);
    view.setUint32(off + 4,   UF2_MAGIC_START1,   true);
    view.setUint32(off + 8,   UF2_FLAG_FAMILY_ID, true);
    view.setUint32(off + 12,  addr,               true);
    view.setUint32(off + 16,  UF2_PAYLOAD_SIZE,   true);
    view.setUint32(off + 20,  i,                  true);
    view.setUint32(off + 24,  numBlocks,           true);
    view.setUint32(off + 28,  UF2_FAMILY_RP2040,  true);
    out.set(payloads[i]!.slice(0, UF2_PAYLOAD_SIZE), off + 32);
    view.setUint32(off + 508, UF2_MAGIC_END,       true);
  }
  return out;
}

// ── isUf2 ─────────────────────────────────────────────────────────────────────

describe('isUf2', () => {
  test('returns true for valid UF2 magic', () => {
    const block = new Uint8Array(4);
    new DataView(block.buffer).setUint32(0, UF2_MAGIC_START0, true);
    assert.equal(isUf2(block), true);
  });

  test('returns false for raw binary (no magic)', () => {
    assert.equal(isUf2(new Uint8Array([0x7F, 0x45, 0x4C, 0x46])), false); // ELF
    assert.equal(isUf2(new Uint8Array([0x00, 0x00, 0x00, 0x00])), false);
  });

  test('returns false for empty input', () => {
    assert.equal(isUf2(new Uint8Array(0)), false);
  });

  test('returns false for input shorter than 4 bytes', () => {
    assert.equal(isUf2(new Uint8Array([0x55])), false);
  });
});

// ── parseUf2 ─────────────────────────────────────────────────────────────────

describe('parseUf2 — valid files', () => {
  test('parses a single-block UF2 file', () => {
    const payload = new Uint8Array(UF2_PAYLOAD_SIZE).fill(0xAA);
    const uf2 = makeUf2([payload]);

    const result = parseUf2(uf2);
    assert.equal(result.blocks.length, 1);
    assert.equal(result.baseAddr, RP2040_FLASH_BASE);
    assert.equal(result.binary.length, UF2_PAYLOAD_SIZE);
    assert.equal(result.familyId, UF2_FAMILY_RP2040);
    assert.deepEqual(result.binary, payload);
  });

  test('parses a multi-block UF2 file and assembles contiguous binary', () => {
    const p0 = new Uint8Array(UF2_PAYLOAD_SIZE).fill(0x11);
    const p1 = new Uint8Array(UF2_PAYLOAD_SIZE).fill(0x22);
    const p2 = new Uint8Array(UF2_PAYLOAD_SIZE).fill(0x33);
    const uf2 = makeUf2([p0, p1, p2]);

    const result = parseUf2(uf2);
    assert.equal(result.blocks.length, 3);
    assert.equal(result.binary.length, UF2_PAYLOAD_SIZE * 3);
    assert.deepEqual(result.binary.slice(0,   UF2_PAYLOAD_SIZE), p0);
    assert.deepEqual(result.binary.slice(256, 512), p1);
    assert.deepEqual(result.binary.slice(512, 768), p2);
  });

  test('sorts blocks by target address even if out of order', () => {
    const p0 = new Uint8Array(UF2_PAYLOAD_SIZE).fill(0xAA);
    const p1 = new Uint8Array(UF2_PAYLOAD_SIZE).fill(0xBB);
    // Build UF2 with reversed block order
    const uf2Reversed = makeUf2([p1, p0], RP2040_FLASH_BASE);
    // Manually swap addresses so block 0 has +256 and block 1 has +0
    const view = new DataView(uf2Reversed.buffer);
    view.setUint32(12,  RP2040_FLASH_BASE + 256, true); // block 0 addr
    view.setUint32(512 + 12, RP2040_FLASH_BASE,  true); // block 1 addr

    const result = parseUf2(uf2Reversed);
    // After sort, p0 (addr 0x10000000) should come first
    assert.deepEqual(result.binary.slice(0,   UF2_PAYLOAD_SIZE), p0);
    assert.deepEqual(result.binary.slice(256, 512), p1);
  });

  test('fills gaps between non-contiguous blocks with 0xFF', () => {
    const p0 = new Uint8Array(UF2_PAYLOAD_SIZE).fill(0x11);
    const p2 = new Uint8Array(UF2_PAYLOAD_SIZE).fill(0x33);
    // Build a 2-block UF2 but address them as if block 1 is missing (gap of 256 bytes)
    const uf2 = makeUf2([p0, p2]);
    // Shift p2 address by 512 instead of 256 (skip one block)
    const view = new DataView(uf2.buffer);
    view.setUint32(512 + 12, RP2040_FLASH_BASE + 512, true);

    const result = parseUf2(uf2);
    assert.equal(result.binary.length, UF2_PAYLOAD_SIZE * 3);
    // Gap block (index 1) should be 0xFF
    assert.equal(result.binary[256], 0xFF);
  });

  test('skips blocks with NOT_MAIN flag (0x00000001)', () => {
    const mainPayload = new Uint8Array(UF2_PAYLOAD_SIZE).fill(0xCC);
    const uf2 = makeUf2([mainPayload]);
    // Set NOT_MAIN flag on the only block
    const view = new DataView(uf2.buffer);
    view.setUint32(8, 0x00000001, true);

    assert.throws(
      () => parseUf2(uf2),
      (err: unknown) => err instanceof STK500InvalidHexError
    );
  });
});

describe('parseUf2 — invalid files', () => {
  test('throws for empty data', () => {
    assert.throws(() => parseUf2(new Uint8Array(0)), STK500InvalidHexError);
  });

  test('throws when size is not a multiple of 512', () => {
    assert.throws(() => parseUf2(new Uint8Array(100)), STK500InvalidHexError);
  });

  test('throws for corrupt magic bytes in a block', () => {
    const uf2 = makeUf2([new Uint8Array(UF2_PAYLOAD_SIZE)]);
    uf2[0] = 0xFF; // corrupt magicStart0
    assert.throws(() => parseUf2(uf2), STK500InvalidHexError);
  });
});

// ── binaryToUf2 ───────────────────────────────────────────────────────────────

describe('binaryToUf2', () => {
  test('produces correct number of blocks for exact multiple of payload size', () => {
    const binary = new Uint8Array(UF2_PAYLOAD_SIZE * 3);
    const uf2 = binaryToUf2(binary);
    assert.equal(uf2.length, UF2_BLOCK_SIZE * 3);
  });

  test('produces one extra block for non-multiple binary', () => {
    const binary = new Uint8Array(UF2_PAYLOAD_SIZE * 2 + 1);
    const uf2 = binaryToUf2(binary);
    assert.equal(uf2.length, UF2_BLOCK_SIZE * 3);
  });

  test('sets correct magic bytes in every block', () => {
    const uf2  = binaryToUf2(new Uint8Array(UF2_PAYLOAD_SIZE));
    const view = new DataView(uf2.buffer);
    assert.equal(view.getUint32(0,   true), UF2_MAGIC_START0);
    assert.equal(view.getUint32(4,   true), UF2_MAGIC_START1);
    assert.equal(view.getUint32(508, true), UF2_MAGIC_END);
  });

  test('sets familyID flag and RP2040 family ID', () => {
    const uf2  = binaryToUf2(new Uint8Array(UF2_PAYLOAD_SIZE));
    const view = new DataView(uf2.buffer);
    assert.equal(view.getUint32(8,  true), UF2_FLAG_FAMILY_ID);
    assert.equal(view.getUint32(28, true), UF2_FAMILY_RP2040);
  });

  test('sets correct target addresses', () => {
    const binary = new Uint8Array(UF2_PAYLOAD_SIZE * 2);
    const uf2    = binaryToUf2(binary, 0x10001000);
    const view   = new DataView(uf2.buffer);
    assert.equal(view.getUint32(12,        true), 0x10001000);  // block 0
    assert.equal(view.getUint32(512 + 12,  true), 0x10001100);  // block 1
  });

  test('embeds binary data in payload area (offset 32–287)', () => {
    const binary = new Uint8Array(UF2_PAYLOAD_SIZE).fill(0xAB);
    const uf2    = binaryToUf2(binary);
    assert.deepEqual(uf2.slice(32, 32 + UF2_PAYLOAD_SIZE), binary);
  });

  test('round-trip: binaryToUf2 → parseUf2 → same binary', () => {
    const original = new Uint8Array(UF2_PAYLOAD_SIZE * 4);
    for (let i = 0; i < original.length; i++) original[i] = i & 0xFF;

    const uf2    = binaryToUf2(original);
    const result = parseUf2(uf2);
    assert.deepEqual(result.binary, original);
    assert.equal(result.baseAddr, RP2040_FLASH_BASE);
    assert.equal(result.familyId, UF2_FAMILY_RP2040);
  });
});
