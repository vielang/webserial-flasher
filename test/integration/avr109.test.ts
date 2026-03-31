import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AVR109 } from '../../src/protocol/avr109/programmer.js';
import {
  STK500ProtocolError,
  STK500SyncError,
  STK500SignatureMismatchError,
  STK500VerifyError,
} from '../../src/core/errors.js';
import {
  MockTransport,
  AVR109_CR,
  ATMEGA32U4_SIG_BYTES,
  makeAVR109SuccessGenerator,
} from '../helpers/MockTransport.js';
import { BOARDS } from '../../src/boards/database.js';

// Minimal valid HEX: 4 bytes at 0x0000 + EOF
const MINI_HEX = [
  ':0400000001020304F2',
  ':00000001FF',
].join('\n');

const MINI_DATA = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
const LEONARDO  = BOARDS['arduino-leonardo'];

// ── Tests ─────────────────────────────────────────────────────────────────

describe('AVR109 integration', () => {
  let transport: MockTransport;
  let prog: AVR109;

  beforeEach(() => {
    transport = new MockTransport();
    prog = new AVR109(transport, LEONARDO, { quiet: true });
  });

  // ── Sync ───────────────────────────────────────────────────────────────

  test('getSoftwareId: returns "CATERIN" from Caterina bootloader', async () => {
    transport.setResponseGenerator(makeAVR109SuccessGenerator(MINI_DATA));
    const id = await prog.getSoftwareId();
    assert.equal(id, 'CATERIN');
  });

  test('sync: throws STK500SyncError after all attempts fail', async () => {
    transport.setResponseGenerator(() => null);
    await assert.rejects(
      (async () => {
        const p = new AVR109(transport, LEONARDO, {
          quiet: true,
        });
        await p.sync(3);
      })(),
      (err: unknown) => {
        assert(err instanceof STK500SyncError);
        assert.equal(err.attempts, 3);
        return true;
      }
    );
  });

  // ── enterProgMode / leaveProgMode ──────────────────────────────────────

  test('enterProgMode: sends 0x50 and expects CR', async () => {
    transport.setResponseGenerator(() => AVR109_CR.slice());
    await prog.enterProgMode();
    assert.equal(transport.writtenBytes[0][0], 0x50, "command must be 'P'");
  });

  test('enterProgMode: throws STK500ProtocolError on non-CR response', async () => {
    transport.setResponseGenerator(() => new Uint8Array([0xFF]));
    await assert.rejects(prog.enterProgMode(), STK500ProtocolError);
  });

  test('leaveProgMode: sends 0x45 and expects CR', async () => {
    transport.setResponseGenerator(() => AVR109_CR.slice());
    await prog.leaveProgMode();
    assert.equal(transport.writtenBytes[0][0], 0x45, "command must be 'E'");
  });

  // ── chipErase ─────────────────────────────────────────────────────────

  test('chipErase: sends 0x65 and expects CR', async () => {
    transport.setResponseGenerator(() => AVR109_CR.slice());
    await prog.chipErase();
    assert.equal(transport.writtenBytes[0][0], 0x65, "command must be 'e'");
  });

  // ── Signature ──────────────────────────────────────────────────────────

  test('getSignature: returns 3 bytes in correct order', async () => {
    transport.setResponseGenerator(() => ATMEGA32U4_SIG_BYTES.slice());
    const sig = await prog.getSignature();
    // ATMEGA32U4_SIG_BYTES = [0x87, 0x95, 0x1e] (MSB first from device)
    // After reversal: [0x1e, 0x95, 0x87]
    assert.deepEqual(sig, new Uint8Array([0x1e, 0x95, 0x87]));
  });

  test('verifySignature: succeeds for matching board', async () => {
    transport.setResponseGenerator(() => ATMEGA32U4_SIG_BYTES.slice());
    await prog.verifySignature(); // should not throw
  });

  test('verifySignature: throws STK500SignatureMismatchError for wrong chip', async () => {
    // Return ATmega328P signature (wrong for Leonardo)
    const wrongSig = new Uint8Array([0x0f, 0x95, 0x1e]); // reversed: [0x1e, 0x95, 0x0f]
    transport.setResponseGenerator(() => wrongSig.slice());
    await assert.rejects(
      prog.verifySignature(),
      (err: unknown) => {
        assert(err instanceof STK500SignatureMismatchError);
        return true;
      }
    );
  });

  // ── Block write / read ─────────────────────────────────────────────────

  test('writeBlock: sends correct 4-byte header + data', async () => {
    transport.setResponseGenerator(() => AVR109_CR.slice());
    const data = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    await prog.writeBlock('F', data);

    const sent = transport.writtenBytes[0];
    assert.equal(sent[0], 0x42,  "command must be 'B'");
    assert.equal(sent[1], 0x00,  'size high');
    assert.equal(sent[2], 0x04,  'size low = 4');
    assert.equal(sent[3], 0x46,  "memType must be 'F'");
    assert.deepEqual(sent.subarray(4), data);
  });

  test('readBlock: sends correct 4-byte command', async () => {
    transport.setResponseGenerator(() => new Uint8Array(4).fill(0xAA));
    const result = await prog.readBlock('F', 4);
    const sent = transport.writtenBytes[0];
    assert.equal(sent[0], 0x67,  "command must be 'g'");
    assert.equal(sent[1], 0x00);
    assert.equal(sent[2], 0x04);
    assert.equal(sent[3], 0x46,  "memType must be 'F'");
    assert.deepEqual(result, new Uint8Array(4).fill(0xAA));
  });

  // ── setAddress ─────────────────────────────────────────────────────────

  test('setAddress: sends 0x41 + 2 address bytes', async () => {
    transport.setResponseGenerator(() => AVR109_CR.slice());
    await prog.setAddress(0x0080); // word address 128
    const sent = transport.writtenBytes[0];
    assert.equal(sent[0], 0x41, "command must be 'A'");
    assert.equal(sent[1], 0x00, 'addrH');
    assert.equal(sent[2], 0x80, 'addrL');
  });

  // ── Full happy path ─────────────────────────────────────────────────────

  test('bootload: full sequence completes successfully', async () => {
    const events: Array<{ status: string; pct: number }> = [];
    transport.setResponseGenerator(makeAVR109SuccessGenerator(MINI_DATA));

    await prog.bootload(MINI_HEX, (status, pct) => {
      events.push({ status, pct });
    });

    const statuses = events.map((e) => e.status);
    assert(statuses.includes('Entering programming mode'), 'should enter prog mode');
    assert(statuses.includes('Verifying signature'),       'should verify sig');
    assert(statuses.includes('Erasing chip'),              'should erase');
    assert(statuses.includes('Uploading'),                 'should upload');
    assert(statuses.includes('Verifying'),                 'should verify');
    assert(statuses.includes('Complete'),                  'should complete');

    // AVR109 has no reset phase — first event is 'Entering programming mode' at 5%
    assert(events[0].pct >= 0 && events[0].pct <= 10, 'first event should be near 0%');
    assert.equal(events[events.length - 1].pct, 100);
  });

  // ── Verify failure ──────────────────────────────────────────────────────

  test('verify: throws STK500VerifyError on byte mismatch', async () => {
    const corrupted = new Uint8Array([0x01, 0x02, 0xFF, 0x04]); // byte 2 wrong
    transport.setResponseGenerator(makeAVR109SuccessGenerator(corrupted));

    await assert.rejects(
      prog.bootload(MINI_HEX),
      (err: unknown) => {
        assert(err instanceof STK500VerifyError);
        assert.equal(err.address,  2);
        assert.equal(err.expected, 0x03);
        assert.equal(err.actual,   0xFF);
        return true;
      }
    );
  });

  // ── EEPROM block write / read ───────────────────────────────────────────

  test("writeBlock with memType 'E' sends correct memtype byte", async () => {
    transport.setResponseGenerator(() => AVR109_CR.slice());
    await prog.writeBlock('E', new Uint8Array([0xDE, 0xAD]));
    assert.equal(transport.writtenBytes[0][3], 0x45, "memType must be 'E'");
  });

  test("readBlock with memType 'E' sends correct memtype byte", async () => {
    transport.setResponseGenerator(() => new Uint8Array(2).fill(0x00));
    await prog.readBlock('E', 2);
    assert.equal(transport.writtenBytes[0][3], 0x45, "memType must be 'E'");
  });
});
