// UF2 file format parser and generator for RP2040 / RP2350 firmware.
// Reference: https://github.com/microsoft/uf2
//
// A UF2 file is a sequence of 512-byte blocks. Each block carries 256 bytes
// of firmware payload plus metadata. The Raspberry Pi Pico bootloader accepts
// UF2 files via USB drag-and-drop (MSD) or via the PICOBOOT protocol.

import {
  UF2_MAGIC_START0, UF2_MAGIC_START1, UF2_MAGIC_END,
  UF2_FLAG_FAMILY_ID, UF2_FLAG_NOT_MAIN,
  UF2_BLOCK_SIZE, UF2_PAYLOAD_SIZE,
  UF2_FAMILY_RP2040, RP2040_FLASH_BASE,
} from './constants.js';
import { STK500InvalidHexError } from '../../core/errors.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface UF2Block {
  /** UF2 flags field */
  flags:       number;
  /** Target XIP address for this block */
  targetAddr:  number;
  /** Number of payload bytes in this block (always 256 for RP2040) */
  payloadSize: number;
  /** Sequential block index (0-based) */
  blockNo:     number;
  /** Total block count in file */
  numBlocks:   number;
  /** Family ID (e.g. UF2_FAMILY_RP2040) */
  familyId:    number;
  /** Firmware payload — payloadSize bytes */
  data:        Uint8Array;
}

export interface UF2ParseResult {
  /** All flashable blocks, sorted by target address */
  blocks:   UF2Block[];
  /** Lowest XIP target address found */
  baseAddr: number;
  /** Contiguous binary assembled from all blocks (0xFF-padded for gaps) */
  binary:   Uint8Array;
  /** Family ID from the first flashable block */
  familyId: number;
}

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * Returns true if `data` starts with UF2 magic bytes.
 * Use this to distinguish a UF2 file from a raw binary.
 */
export function isUf2(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint32(0, true) === UF2_MAGIC_START0;
}

// ── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a UF2 file into individual blocks and a contiguous binary image.
 *
 * - Skips blocks with the NOT_MAIN flag set.
 * - Sorts blocks by target address before assembling.
 * - Fills gaps between blocks with 0xFF.
 *
 * @throws STK500InvalidHexError if the file is structurally invalid.
 */
export function parseUf2(data: Uint8Array): UF2ParseResult {
  if (data.length === 0) {
    throw new STK500InvalidHexError('UF2 data is empty');
  }
  if (data.length % UF2_BLOCK_SIZE !== 0) {
    throw new STK500InvalidHexError(
      `UF2 file size (${data.length} bytes) is not a multiple of 512`
    );
  }

  const view   = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const blocks: UF2Block[] = [];

  const total = data.length / UF2_BLOCK_SIZE;
  for (let i = 0; i < total; i++) {
    const off = i * UF2_BLOCK_SIZE;

    const magic0   = view.getUint32(off + 0,   true);
    const magic1   = view.getUint32(off + 4,   true);
    const magicEnd = view.getUint32(off + 508, true);

    if (magic0 !== UF2_MAGIC_START0 || magic1 !== UF2_MAGIC_START1 || magicEnd !== UF2_MAGIC_END) {
      throw new STK500InvalidHexError(`UF2 block ${i}: invalid magic bytes`);
    }

    const flags       = view.getUint32(off + 8,  true);
    const targetAddr  = view.getUint32(off + 12, true);
    const payloadSize = view.getUint32(off + 16, true);
    const blockNo     = view.getUint32(off + 20, true);
    const numBlocks   = view.getUint32(off + 24, true);
    const familyId    = view.getUint32(off + 28, true);

    // Skip blocks not intended for main flash
    if (flags & UF2_FLAG_NOT_MAIN) continue;

    if (payloadSize > UF2_PAYLOAD_SIZE) {
      throw new STK500InvalidHexError(
        `UF2 block ${i}: payloadSize ${payloadSize} exceeds maximum ${UF2_PAYLOAD_SIZE}`
      );
    }

    blocks.push({
      flags,
      targetAddr,
      payloadSize,
      blockNo,
      numBlocks,
      familyId,
      data: data.slice(off + 32, off + 32 + payloadSize),
    });
  }

  if (blocks.length === 0) {
    throw new STK500InvalidHexError('UF2 file contains no flashable blocks');
  }

  // Sort ascending by target address
  blocks.sort((a, b) => a.targetAddr - b.targetAddr);

  const baseAddr   = blocks[0]!.targetAddr;
  const lastBlock  = blocks[blocks.length - 1]!;
  const totalBytes = lastBlock.targetAddr - baseAddr + lastBlock.payloadSize;
  const binary     = new Uint8Array(totalBytes).fill(0xFF);

  for (const block of blocks) {
    const offset = block.targetAddr - baseAddr;
    binary.set(block.data.subarray(0, block.payloadSize), offset);
  }

  return {
    blocks,
    baseAddr,
    binary,
    familyId: blocks[0]!.familyId,
  };
}

// ── Generator ───────────────────────────────────────────────────────────────

/**
 * Convert a raw binary into a UF2 file.
 *
 * @param binary    Raw firmware bytes
 * @param baseAddr  XIP start address (default: 0x10000000 for RP2040)
 * @param familyId  UF2 family ID (default: RP2040)
 * @returns         UF2 file as Uint8Array (numBlocks × 512 bytes)
 */
export function binaryToUf2(
  binary:   Uint8Array,
  baseAddr: number = RP2040_FLASH_BASE,
  familyId: number = UF2_FAMILY_RP2040,
): Uint8Array {
  const numBlocks = Math.ceil(binary.length / UF2_PAYLOAD_SIZE);
  const out       = new Uint8Array(numBlocks * UF2_BLOCK_SIZE);
  const view      = new DataView(out.buffer);

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
    view.setUint32(off + 28,  familyId,            true);
    out.set(binary.slice(i * UF2_PAYLOAD_SIZE, (i + 1) * UF2_PAYLOAD_SIZE), off + 32);
    view.setUint32(off + 508, UF2_MAGIC_END,       true);
  }

  return out;
}
