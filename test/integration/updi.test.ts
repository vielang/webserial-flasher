import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { UPDI } from '../../src/protocol/updi/programmer.js';
import {
  STK500SyncError,
  STK500SignatureMismatchError,
  STK500VerifyError,
  STK500ProtocolError,
} from '../../src/core/errors.js';
import {
  MockTransport,
  UPDI_ACK_BYTE,
  ATTINY416_SIG,
  makeUPDISuccessGenerator,
} from '../helpers/MockTransport.js';
import { BOARDS } from '../../src/boards/database.js';

// Minimal valid HEX: 64 bytes at 0x0000 + EOF (one tinyAVR page)
const MINI_DATA = new Uint8Array(4).fill(0xAA).map((v, i) => i + 1); // [1,2,3,4]

const MINI_HEX = [
  ':0400000001020304F2',
  ':00000001FF',
].join('\n');

const TINY416 = BOARDS['attiny416']!;

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('UPDI integration', () => {
  let transport: MockTransport;
  let updi: UPDI;

  beforeEach(() => {
    transport = new MockTransport();
    transport.echoEnabled = true;
    updi = new UPDI(transport, TINY416, { quiet: true });
  });

  // ── sendBreak ──────────────────────────────────────────────────────────────

  test('sendBreak: invokes transport.sendBreak() and increments breakCount', async () => {
    await updi.sendBreak();
    assert.equal(transport.breakCount, 1);
  });

  test('sendBreak: throws if transport lacks sendBreak()', async () => {
    // Create a minimal transport without sendBreak
    const noBreakTransport = {
      write: async () => {},
      on: () => {},
      off: () => {},
      close: async () => {},
    } as import('../../src/transport/ITransport.js').ISTKTransport;
    const prog = new UPDI(noBreakTransport, TINY416, { quiet: true });
    await assert.rejects(prog.sendBreak(), STK500ProtocolError);
  });

  // ── sync ───────────────────────────────────────────────────────────────────

  test('sync: succeeds when STATUSA returns a non-0xFF value', async () => {
    transport.setResponseGenerator(() => new Uint8Array([0x82]));
    await updi.sync(1); // should not throw
  });

  test('sync: throws STK500SyncError when STATUSA returns 0xFF (no device)', async () => {
    transport.setResponseGenerator(() => new Uint8Array([0xFF]));
    await assert.rejects(
      updi.sync(3),
      (err: unknown) => {
        assert(err instanceof STK500SyncError);
        assert.equal(err.attempts, 3);
        return true;
      }
    );
  });

  // ── enterProgMode ──────────────────────────────────────────────────────────

  test('enterProgMode: sends STCS(CTRLA) then KEY', async () => {
    transport.setResponseGenerator(makeUPDISuccessGenerator(ATTINY416_SIG, MINI_DATA));
    await updi.enterProgMode();

    // Verify that KEY instruction (0xE0) was sent among the writes
    const keyWrite = transport.writtenBytes.find(
      (b) => b[0] === 0x55 && b[1] === 0xE0
    );
    assert(keyWrite, 'KEY instruction (0x55 0xE0 ...) must be sent');
    assert.equal(keyWrite!.length, 10, 'KEY write: SYNC + 0xE0 + 8 key bytes = 10 bytes');
  });

  // ── getSignature ───────────────────────────────────────────────────────────

  test('getSignature: returns 3 bytes from SIGROW', async () => {
    transport.setResponseGenerator(makeUPDISuccessGenerator(ATTINY416_SIG, MINI_DATA));
    const sig = await updi.getSignature();
    assert.deepEqual(sig, ATTINY416_SIG);
  });

  test('verifySignature: throws STK500SignatureMismatchError for wrong sig', async () => {
    const wrongSig = new Uint8Array([0x1e, 0x91, 0x23]); // ATtiny412
    transport.setResponseGenerator(makeUPDISuccessGenerator(wrongSig, MINI_DATA));
    await assert.rejects(
      updi.verifySignature(),
      (err: unknown) => {
        assert(err instanceof STK500SignatureMismatchError);
        return true;
      }
    );
  });

  // ── chipErase ─────────────────────────────────────────────────────────────

  test('chipErase: writes CHER command to NVM_CTRLA then waits for ready', async () => {
    transport.setResponseGenerator(makeUPDISuccessGenerator(ATTINY416_SIG, MINI_DATA));
    await updi.chipErase(); // should not throw

    // Find STS write to NVM_CTRLA (0x1000) with value CHER (0x05)
    const cherWrite = transport.writtenBytes.find(
      (b) => b[0] === 0x55 && b[1] === 0x44 && b[2] === 0x00 && b[3] === 0x10
    );
    assert(cherWrite, 'STS write to NVM_CTRLA (0x1000) must be sent');
  });

  // ── bootload full happy path ───────────────────────────────────────────────

  test('bootload: full sequence completes with correct progress events', async () => {
    const events: Array<{ status: string; pct: number }> = [];
    transport.setResponseGenerator(makeUPDISuccessGenerator(ATTINY416_SIG, MINI_DATA));

    await updi.bootload(MINI_HEX, (status, pct) => {
      events.push({ status, pct });
    });

    const statuses = events.map((e) => e.status);
    assert(statuses.includes('Resetting UPDI'),             'should reset');
    assert(statuses.includes('Syncing'),                     'should sync');
    assert(statuses.includes('Entering programming mode'),   'should enter prog mode');
    assert(statuses.includes('Verifying signature'),         'should verify sig');
    assert(statuses.includes('Erasing chip'),                'should erase');
    assert(statuses.includes('Uploading'),                   'should upload');
    assert(statuses.includes('Verifying'),                   'should verify');
    assert(statuses.includes('Complete'),                    'should complete');

    assert.equal(events[0]!.pct, 0);
    assert.equal(events[events.length - 1]!.pct, 100);
  });

  // ── verify failure ─────────────────────────────────────────────────────────

  test('bootload: throws STK500VerifyError on byte mismatch', async () => {
    const corrupted = new Uint8Array([0x01, 0x02, 0xFF, 0x04]); // byte 2 wrong
    transport.setResponseGenerator(makeUPDISuccessGenerator(ATTINY416_SIG, corrupted));

    await assert.rejects(
      updi.bootload(MINI_HEX),
      (err: unknown) => {
        assert(err instanceof STK500VerifyError);
        assert.equal(err.expected, 0x03);
        assert.equal(err.actual,   0xFF);
        return true;
      }
    );
  });

  // ── EEPROM ─────────────────────────────────────────────────────────────────

  test('writeEeprom: sends setPtr to EEPROM base + offset', async () => {
    transport.setResponseGenerator(makeUPDISuccessGenerator(ATTINY416_SIG, MINI_DATA));
    await updi.writeEeprom(0, new Uint8Array([0xDE, 0xAD]));

    // Find SET_PTR write to EEPROM_BASE (0x1400)
    const ptrWrite = transport.writtenBytes.find(
      (b) => b[0] === 0x55 && b[1] === 0x61 && b[2] === 0x00 && b[3] === 0x14
    );
    assert(ptrWrite, 'SET_PTR to EEPROM_BASE (0x1400) must be sent');
  });

  // ── sendKey ────────────────────────────────────────────────────────────────

  test('sendKey: writes SYNC + 0xE0 + 8 key bytes (10 bytes total)', async () => {
    transport.setResponseGenerator(() => null);
    await updi['link'].sendKey(new Uint8Array([0x20, 0x67, 0x6F, 0x72, 0x50, 0x4D, 0x56, 0x4E]));

    const keyWrite = transport.writtenBytes[0]!;
    assert.equal(keyWrite.length, 10);
    assert.equal(keyWrite[0], 0x55, 'SYNC');
    assert.equal(keyWrite[1], 0xE0, 'KEY instruction');
    assert.equal(keyWrite[2], 0x20, 'key[0]');
    assert.equal(keyWrite[9], 0x4E, 'key[7]');
  });
});
