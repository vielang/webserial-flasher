import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PicoBoot }            from '../../src/protocol/picoboot/programmer.js';
import { binaryToUf2, isUf2 } from '../../src/protocol/picoboot/uf2.js';
import {
  PICOBOOT_MAGIC, FLASH_PAGE_SIZE, FLASH_SECTOR_SIZE,
  RP2040_FLASH_BASE, PicobootCmd, PicobootStatus,
} from '../../src/protocol/picoboot/constants.js';
import { STK500VerifyError, STK500ProtocolError } from '../../src/core/errors.js';
import {
  MockPicobootTransport,
  hasPicobootMagic,
  extractCmdId,
  extractAddr,
  extractSize,
  buildErrorStatus,
  buildOkStatus,
  extractToken,
} from '../helpers/MockPicobootTransport.js';

// ── Test fixture data ─────────────────────────────────────────────────────────

// 512 bytes of firmware (2 flash pages, fills one sector boundary)
const FIRMWARE = new Uint8Array(512);
for (let i = 0; i < FIRMWARE.length; i++) FIRMWARE[i] = i & 0xFF;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PicoBoot integration', () => {
  let transport: MockPicobootTransport;
  let pico:      PicoBoot;

  beforeEach(() => {
    transport = new MockPicobootTransport();
    pico      = new PicoBoot(transport, { quiet: true });
  });

  // ── Command packet structure ───────────────────────────────────────────────

  test('every sent command has PICOBOOT magic 0x431FD10B', async () => {
    await pico.exclusiveAccess(true);
    await pico.exitXip();
    for (const cmd of transport.cmdHistory) {
      assert(hasPicobootMagic(cmd), `Command missing magic: ${Array.from(cmd).map(b => b.toString(16)).join(' ')}`);
    }
  });

  test('token increments monotonically across commands', async () => {
    await pico.exclusiveAccess(true);
    await pico.exitXip();
    await pico.flashErase(0, FLASH_SECTOR_SIZE);

    const tokens = transport.cmdHistory.map((cmd) =>
      new DataView(cmd.buffer, cmd.byteOffset).getUint32(4, true)
    );
    for (let i = 1; i < tokens.length; i++) {
      assert.equal(tokens[i], (tokens[i - 1]! + 1) >>> 0, `Token ${i} should be token[${i-1}]+1`);
    }
  });

  // ── exclusiveAccess ────────────────────────────────────────────────────────

  test('exclusiveAccess: sends EXCLUSIVE_ACCESS command with correct arg', async () => {
    await pico.exclusiveAccess(true);
    const cmd = transport.cmdHistory[0]!;
    assert.equal(extractCmdId(cmd), PicobootCmd.EXCLUSIVE_ACCESS);
    assert.equal(cmd[16], 1, 'exclusive flag must be 1');
  });

  test('exclusiveAccess(false): exclusive flag = 0', async () => {
    await pico.exclusiveAccess(false);
    assert.equal(transport.cmdHistory[0]![16], 0);
  });

  // ── exitXip ────────────────────────────────────────────────────────────────

  test('exitXip: sends EXIT_XIP command', async () => {
    await pico.exitXip();
    assert.equal(extractCmdId(transport.cmdHistory[0]!), PicobootCmd.EXIT_XIP);
  });

  // ── flashErase ────────────────────────────────────────────────────────────

  test('flashErase: sends FLASH_ERASE with correct addr and size', async () => {
    await pico.flashErase(0x1000, FLASH_SECTOR_SIZE);
    const cmd = transport.cmdHistory[0]!;
    assert.equal(extractCmdId(cmd), PicobootCmd.FLASH_ERASE);
    assert.equal(extractAddr(cmd),  0x1000);
    assert.equal(extractSize(cmd),  FLASH_SECTOR_SIZE);
  });

  test('flashErase: throws on non-4KB-aligned address', async () => {
    await assert.rejects(
      pico.flashErase(0x100, FLASH_SECTOR_SIZE),
      STK500ProtocolError
    );
  });

  test('flashErase: throws on non-4KB-aligned size', async () => {
    await assert.rejects(
      pico.flashErase(0, 100),
      STK500ProtocolError
    );
  });

  // ── flashWrite ────────────────────────────────────────────────────────────

  test('flashWrite: sends WRITE command then 256 bytes of data', async () => {
    const page = new Uint8Array(FLASH_PAGE_SIZE).fill(0xAB);
    await pico.flashWrite(0, page);

    const cmd = transport.cmdHistory[0]!;
    assert.equal(extractCmdId(cmd), PicobootCmd.WRITE);
    assert.equal(extractAddr(cmd),  0);
    assert.equal(extractSize(cmd),  FLASH_PAGE_SIZE);
    assert.deepEqual(transport.dataHistory[0], page);
  });

  test('flashWrite: throws on non-256-byte-aligned address', async () => {
    await assert.rejects(
      pico.flashWrite(0x100 + 1, new Uint8Array(FLASH_PAGE_SIZE)),
      STK500ProtocolError
    );
  });

  test('flashWrite: throws if data is not exactly 256 bytes', async () => {
    await assert.rejects(
      pico.flashWrite(0, new Uint8Array(128)),
      STK500ProtocolError
    );
  });

  // ── flashRead ─────────────────────────────────────────────────────────────

  test('flashRead: sends READ command (bit7 set = 0x84)', async () => {
    await pico.flashRead(0, FLASH_PAGE_SIZE);
    const cmd = transport.cmdHistory[0]!;
    assert.equal(extractCmdId(cmd), PicobootCmd.READ);
    assert.equal(cmd[8]! & 0x80, 0x80, 'READ command must have bit7 set');
  });

  test('flashRead: returns data from mock flash', async () => {
    // Pre-load flash data
    const data = new Uint8Array(FLASH_PAGE_SIZE).fill(0xDE);
    transport.flash.set(0, data);
    const result = await pico.flashRead(0, FLASH_PAGE_SIZE);
    assert.deepEqual(result, data);
  });

  // ── reboot ────────────────────────────────────────────────────────────────

  test('reboot: sends REBOOT command with PC=0, SP=0, delay=500', async () => {
    await pico.reboot(0, 0, 500);
    const cmd  = transport.cmdHistory[0]!;
    const view = new DataView(cmd.buffer, cmd.byteOffset);
    assert.equal(extractCmdId(cmd),   PicobootCmd.REBOOT);
    assert.equal(view.getUint32(16, true), 0,   'PC should be 0');
    assert.equal(view.getUint32(20, true), 0,   'SP should be 0');
    assert.equal(view.getUint32(24, true), 500, 'delayMs should be 500');
  });

  // ── error status handling ─────────────────────────────────────────────────

  test('throws STK500ProtocolError when device returns INVALID_ADDRESS status', async () => {
    transport.setResponseGenerator((cmd) => {
      const token = extractToken(cmd);
      const cmdId = extractCmdId(cmd);
      return buildErrorStatus(token, cmdId, PicobootStatus.INVALID_ADDRESS);
    });

    await assert.rejects(
      pico.flashErase(0, FLASH_SECTOR_SIZE),
      STK500ProtocolError
    );
  });

  // ── bootload: raw binary ───────────────────────────────────────────────────

  test('bootload (raw binary): executes full flash sequence', async () => {
    const events: Array<{ status: string; pct: number }> = [];

    await pico.bootload(FIRMWARE, (s, p) => events.push({ status: s, pct: p }));

    const statuses = events.map((e) => e.status);
    assert(statuses.includes('Parsing firmware'),     'should parse');
    assert(statuses.includes('Taking exclusive access'), 'should take exclusive access');
    assert(statuses.includes('Exiting XIP mode'),    'should exit XIP');
    assert(statuses.includes('Erasing flash'),        'should erase');
    assert(statuses.includes('Uploading'),            'should upload');
    assert(statuses.includes('Verifying'),            'should verify');
    assert(statuses.includes('Rebooting device'),     'should reboot');
    assert(statuses.includes('Complete'),             'should complete');

    assert.equal(events[0]!.pct, 0);
    assert.equal(events[events.length - 1]!.pct, 100);
  });

  test('bootload (raw binary): issues EXCLUSIVE_ACCESS then EXIT_XIP before FLASH_ERASE', async () => {
    await pico.bootload(FIRMWARE, undefined, { verify: false });

    const cmdIds = transport.cmdHistory.map(extractCmdId);
    const eraseIdx    = cmdIds.indexOf(PicobootCmd.FLASH_ERASE);
    const exitXipIdx  = cmdIds.indexOf(PicobootCmd.EXIT_XIP);
    const exclusiveIdx = cmdIds.indexOf(PicobootCmd.EXCLUSIVE_ACCESS);

    assert(exclusiveIdx !== -1, 'EXCLUSIVE_ACCESS must be sent');
    assert(exitXipIdx   !== -1, 'EXIT_XIP must be sent');
    assert(eraseIdx     !== -1, 'FLASH_ERASE must be sent');
    assert(exclusiveIdx < exitXipIdx,  'EXCLUSIVE_ACCESS before EXIT_XIP');
    assert(exitXipIdx   < eraseIdx,    'EXIT_XIP before FLASH_ERASE');
  });

  test('bootload (raw binary): writes correct number of pages', async () => {
    await pico.bootload(FIRMWARE, undefined, { verify: false });
    const writeCount = transport.cmdHistory.filter(
      (cmd) => extractCmdId(cmd) === PicobootCmd.WRITE
    ).length;
    // 512 bytes → 2 pages of 256
    assert.equal(writeCount, 2);
  });

  test('bootload (raw binary): uses PICOBOOT offset addressing (not XIP address)', async () => {
    await pico.bootload(FIRMWARE, undefined, { verify: false, baseAddr: RP2040_FLASH_BASE });

    const eraseCmds = transport.cmdHistory.filter(
      (cmd) => extractCmdId(cmd) === PicobootCmd.FLASH_ERASE
    );
    assert(eraseCmds.length > 0);
    // Flash offset = XIP_base & 0x0FFFFFFF = 0
    assert.equal(extractAddr(eraseCmds[0]!), 0x00000000, 'should use offset-0 addressing');
  });

  // ── bootload: UF2 file ────────────────────────────────────────────────────

  test('bootload (UF2): detects and parses UF2 format automatically', async () => {
    const uf2 = binaryToUf2(FIRMWARE, RP2040_FLASH_BASE);
    assert(isUf2(uf2));

    await pico.bootload(uf2, undefined, { verify: false });

    const writeCount = transport.cmdHistory.filter(
      (cmd) => extractCmdId(cmd) === PicobootCmd.WRITE
    ).length;
    assert.equal(writeCount, 2, 'should write 2 pages from UF2');
  });

  // ── verify ────────────────────────────────────────────────────────────────

  test('bootload: verify passes when read-back matches firmware', async () => {
    // Pre-load flash so read-back returns correct data
    for (let i = 0; i < FIRMWARE.length; i += FLASH_PAGE_SIZE) {
      transport.flash.set(i, FIRMWARE.slice(i, i + FLASH_PAGE_SIZE));
    }

    await assert.doesNotReject(
      pico.bootload(FIRMWARE, undefined, { verify: true })
    );
  });

  test('bootload: throws STK500VerifyError on flash read-back mismatch', async () => {
    // Flash is 0xFF (default) so mismatches FIRMWARE at byte 0
    await assert.rejects(
      pico.bootload(FIRMWARE, undefined, { verify: true }),
      (err: unknown) => {
        assert(err instanceof STK500VerifyError);
        assert.equal(err.address, RP2040_FLASH_BASE); // first byte
        assert.equal(err.expected, FIRMWARE[0]);
        return true;
      }
    );
  });

  test('bootload: skips verify when opts.verify = false', async () => {
    const events: string[] = [];
    // Flash is empty (0xFF) but no verify should happen
    await pico.bootload(FIRMWARE, (s) => events.push(s), { verify: false });
    assert(!events.includes('Verifying'), 'should not verify when disabled');
  });
});
