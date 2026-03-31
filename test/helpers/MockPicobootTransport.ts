// Mock PICOBOOT transport for unit and integration tests.
// Simulates a RP2040 in BOOTSEL mode responding to PICOBOOT commands.

import type { IPicobootTransport } from '../../src/transport/IPicobootTransport.js';
import {
  PICOBOOT_MAGIC, PICOBOOT_STATUS_SIZE,
  PicobootCmd, PicobootStatus,
} from '../../src/protocol/picoboot/constants.js';

// ── Mock transport ───────────────────────────────────────────────────────────

export class MockPicobootTransport implements IPicobootTransport {
  /** All 32-byte command packets sent by the programmer */
  public readonly cmdHistory:  Uint8Array[] = [];
  /** All data payloads sent via sendBytes() */
  public readonly dataHistory: Uint8Array[] = [];
  /** Simulated flash memory (offset → data) */
  public readonly flash = new Map<number, Uint8Array>();

  public resetCount = 0;

  /** If set, override the automatic response with a custom generator */
  private responseGen: ((cmd: Uint8Array) => Uint8Array | null) | null = null;

  /** Set a custom response generator */
  setResponseGenerator(gen: (cmd: Uint8Array) => Uint8Array | null): void {
    this.responseGen = gen;
  }

  /** Reset all recorded state between test cases */
  reset(): void {
    this.cmdHistory.length  = 0;
    this.dataHistory.length = 0;
    this.flash.clear();
    this.resetCount = 0;
    this.responseGen = null;
  }

  // ── IPicobootTransport ────────────────────────────────────────────────────

  async sendCommand(cmd: Uint8Array): Promise<void> {
    this.cmdHistory.push(new Uint8Array(cmd));
  }

  async receiveBytes(maxLength: number): Promise<Uint8Array> {
    if (maxLength === 0) return new Uint8Array(0);

    const lastCmd = this.cmdHistory[this.cmdHistory.length - 1];
    if (!lastCmd) return buildOkStatus(0, 0);

    // Custom generator takes priority
    if (this.responseGen) {
      return this.responseGen(lastCmd) ?? buildOkStatus(extractToken(lastCmd), extractCmdId(lastCmd));
    }

    return this._autoRespond(lastCmd, maxLength);
  }

  async sendBytes(data: Uint8Array): Promise<void> {
    this.dataHistory.push(new Uint8Array(data));
    // Note: writes are NOT automatically stored in this.flash.
    // Tests that need read-back to succeed should pre-populate this.flash manually.
  }

  async resetInterface(): Promise<void> {
    this.resetCount++;
  }

  async close(): Promise<void> {}

  // ── Auto-responder ────────────────────────────────────────────────────────

  private _autoRespond(cmd: Uint8Array, maxLength: number): Uint8Array {
    const token = extractToken(cmd);
    const cmdId = extractCmdId(cmd);

    switch (cmdId) {
      case PicobootCmd.EXCLUSIVE_ACCESS:
      case PicobootCmd.EXIT_XIP:
      case PicobootCmd.ENTER_CMD_XIP:
      case PicobootCmd.FLASH_ERASE:
      case PicobootCmd.WRITE:
      case PicobootCmd.REBOOT:
        // OUT commands → return OK status
        return buildOkStatus(token, cmdId);

      case PicobootCmd.READ: {
        // IN command — receiveBytes is called first for data, then for status.
        // We alternate: if maxLength > PICOBOOT_STATUS_SIZE, return data; else return status.
        if (maxLength > PICOBOOT_STATUS_SIZE) {
          const addr = extractAddr(cmd);
          const size = extractSize(cmd);
          return this._readFlash(addr, size);
        }
        return buildOkStatus(token, cmdId);
      }

      default:
        return buildOkStatus(token, cmdId);
    }
  }

  private _readFlash(addr: number, size: number): Uint8Array {
    const result = new Uint8Array(size).fill(0xFF);
    for (const [blockAddr, blockData] of this.flash) {
      const overlap = blockAddr - addr;
      if (overlap >= 0 && overlap < size) {
        result.set(blockData.subarray(0, Math.min(blockData.length, size - overlap)), overlap);
      } else if (overlap < 0 && -overlap < blockData.length) {
        result.set(blockData.subarray(-overlap, Math.min(blockData.length, size - overlap)), 0);
      }
    }
    return result;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the token from a 32-byte command packet */
export function extractToken(cmd: Uint8Array): number {
  return new DataView(cmd.buffer, cmd.byteOffset).getUint32(4, true);
}

/** Extract the command ID from a 32-byte command packet */
export function extractCmdId(cmd: Uint8Array): number {
  return cmd[8] ?? 0;
}

/** Extract flash address from range_cmd args (offset 16) */
export function extractAddr(cmd: Uint8Array): number {
  return new DataView(cmd.buffer, cmd.byteOffset).getUint32(16, true);
}

/** Extract flash size from range_cmd args (offset 20) */
export function extractSize(cmd: Uint8Array): number {
  return new DataView(cmd.buffer, cmd.byteOffset).getUint32(20, true);
}

/**
 * Build a 16-byte PICOBOOT OK status response:
 *   [dToken u32][dStatusCode=0 u32][bCmdId u8][bInProgress=0 u8][6-byte pad]
 */
export function buildOkStatus(token: number, cmdId: number): Uint8Array {
  const buf  = new Uint8Array(PICOBOOT_STATUS_SIZE);
  const view = new DataView(buf.buffer);
  view.setUint32(0, token,               true);
  view.setUint32(4, PicobootStatus.OK,   true);
  buf[8] = cmdId;
  return buf;
}

/**
 * Build a 16-byte PICOBOOT error status response.
 */
export function buildErrorStatus(token: number, cmdId: number, statusCode: number): Uint8Array {
  const buf  = new Uint8Array(PICOBOOT_STATUS_SIZE);
  const view = new DataView(buf.buffer);
  view.setUint32(0, token,      true);
  view.setUint32(4, statusCode, true);
  buf[8] = cmdId;
  return buf;
}

/** Verify that a command packet has the correct PICOBOOT magic */
export function hasPicobootMagic(cmd: Uint8Array): boolean {
  if (cmd.length < 4) return false;
  return new DataView(cmd.buffer, cmd.byteOffset).getUint32(0, true) === PICOBOOT_MAGIC;
}
