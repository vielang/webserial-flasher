import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { STK500v2 } from '../../src/protocol/stk500v2/programmer.js';
import {
  STK500SyncError,
  STK500SignatureMismatchError,
  STK500VerifyError,
} from '../../src/core/errors.js';
import {
  MockTransport,
  makeV2SuccessGenerator,
  buildV2OkResponse,
  buildV2SignOnResponse,
  buildV2SignatureResponse,
  buildV2FlashReadResponse,
  v2RequestSeq,
  v2RequestCmd,
  ATMEGA2560_SIG,
} from '../helpers/MockTransport.js';
import { BOARDS } from '../../src/boards/database.js';

// Minimal valid HEX: 4 bytes at 0x0000 + EOF
// Checksum: (4+0+0+0+1+2+3+4)=0x0E → 0x100-0x0E = 0xF2
const MINI_HEX = [
  ':0400000001020304F2',
  ':00000001FF',
].join('\n');

const MINI_DATA = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
const MEGA      = BOARDS['arduino-mega2560'];

// ── Tests ─────────────────────────────────────────────────────────────────

describe('STK500v2 integration', () => {
  let transport: MockTransport;
  let stk: STK500v2;

  beforeEach(() => {
    transport = new MockTransport();
    stk = new STK500v2(transport, MEGA, {
      quiet: true,
      retry: { syncAttempts: 3, retryDelayMs: 0 },
    });
  });

  // ── signOn ─────────────────────────────────────────────────────────────

  test('signOn: returns programmer name from response', async () => {
    transport.setResponseGenerator((frame) => {
      const seq = v2RequestSeq(frame);
      return buildV2SignOnResponse(seq, 'AVRISP_MK2');
    });
    const name = await stk.signOn();
    assert.equal(name, 'AVRISP_MK2');
  });

  // ── sync ───────────────────────────────────────────────────────────────

  test('sync: throws STK500SyncError after all attempts fail', async () => {
    transport.setResponseGenerator(() => null);
    await assert.rejects(
      stk.sync(3),
      (err: unknown) => {
        assert(err instanceof STK500SyncError);
        assert.equal(err.attempts, 3);
        return true;
      }
    );
  });

  // ── DTR reset ──────────────────────────────────────────────────────────

  test('bootload: toggles DTR before sync', async () => {
    transport.setResponseGenerator(makeV2SuccessGenerator(MINI_DATA));
    await stk.bootload(MINI_HEX);
    const dtrs = transport.signalHistory.filter((s) => 'dtr' in s);
    assert(dtrs.length >= 2, 'should toggle DTR at least once');
    assert.equal(dtrs[0].dtr, false);
    assert.equal(dtrs[1].dtr, true);
  });

  // ── Signature ──────────────────────────────────────────────────────────

  test('verifySignature: throws STK500SignatureMismatchError for wrong board', async () => {
    transport.setResponseGenerator((frame) => {
      const seq = v2RequestSeq(frame);
      const cmd = v2RequestCmd(frame);
      if (cmd === 0x01) return buildV2SignOnResponse(seq);
      if (cmd === 0x1B) {
        // Return ATmega328P signature instead of ATmega2560
        const wrongSig: [number, number, number] = [0x1e, 0x95, 0x0f];
        const byteIdx = frame[10] ?? 0;
        return buildV2SignatureResponse(seq, wrongSig, byteIdx);
      }
      return buildV2OkResponse(seq, cmd);
    });

    await assert.rejects(
      (async () => {
        await stk.signOn();
        await stk.verifySignature();
      })(),
      (err: unknown) => {
        assert(err instanceof STK500SignatureMismatchError);
        assert.deepEqual(err.expected, MEGA.signature);
        assert.deepEqual(err.actual, new Uint8Array([0x1e, 0x95, 0x0f]));
        return true;
      }
    );
  });

  test('readSignature: returns all 3 signature bytes', async () => {
    transport.setResponseGenerator((frame) => {
      const seq = v2RequestSeq(frame);
      const cmd = v2RequestCmd(frame);
      if (cmd === 0x1B) {
        const byteIdx = frame[10] ?? 0;
        return buildV2SignatureResponse(seq, ATMEGA2560_SIG, byteIdx);
      }
      return buildV2OkResponse(seq, cmd);
    });
    const sig = await stk.readSignature();
    assert.deepEqual(sig, new Uint8Array(ATMEGA2560_SIG));
  });

  // ── Verify ─────────────────────────────────────────────────────────────

  test('verify: succeeds when readback matches HEX data', async () => {
    transport.setResponseGenerator(makeV2SuccessGenerator(MINI_DATA));
    await stk.bootload(MINI_HEX); // should not throw
  });

  test('verify: throws STK500VerifyError on byte mismatch', async () => {
    const corrupted = new Uint8Array([0x01, 0x02, 0xFF, 0x04]); // byte 2 wrong
    transport.setResponseGenerator(makeV2SuccessGenerator(corrupted));

    await assert.rejects(
      stk.bootload(MINI_HEX),
      (err: unknown) => {
        assert(err instanceof STK500VerifyError);
        assert.equal(err.address,  2);
        assert.equal(err.expected, 0x03);
        assert.equal(err.actual,   0xFF);
        return true;
      }
    );
  });

  // ── Full happy path ─────────────────────────────────────────────────────

  test('bootload: full sequence completes with correct progress events', async () => {
    const events: Array<{ status: string; pct: number }> = [];
    transport.setResponseGenerator(makeV2SuccessGenerator(MINI_DATA));

    await stk.bootload(MINI_HEX, (status, pct) => {
      events.push({ status, pct });
    });

    const statuses = events.map((e) => e.status);
    assert(statuses.includes('Resetting device'),         'should reset');
    assert(statuses.includes('Syncing'),                   'should sync');
    assert(statuses.includes('Verifying signature'),       'should check sig');
    assert(statuses.includes('Configuring device'),        'should send descriptor');
    assert(statuses.includes('Entering programming mode'), 'should enter prog mode');
    assert(statuses.includes('Erasing chip'),              'should erase');
    assert(statuses.includes('Uploading'),                 'should upload');
    assert(statuses.includes('Verifying'),                 'should verify');
    assert(statuses.includes('Complete'),                  'should complete');

    assert.equal(events[0].pct,                  0);
    assert.equal(events[events.length - 1].pct, 100);
  });

  // ── SET_DEVICE_DESCRIPTOR ──────────────────────────────────────────────

  test('setDeviceDescriptor: sends 53 bytes (cmd + 52-byte descriptor)', async () => {
    transport.setResponseGenerator(makeV2SuccessGenerator(MINI_DATA));
    await stk.bootload(MINI_HEX);

    // Find the SET_DEVICE_DESCRIPTOR command (cmd byte 0x04)
    // It's inside a STK500v2 frame, body starts at offset 5
    const descriptorFrame = transport.writtenBytes.find(
      (b) => b[0] === 0x1B && b[5] === 0x04
    );
    assert(descriptorFrame, 'SET_DEVICE_DESCRIPTOR frame must be sent');

    // Body size from header bytes [2..3] (big-endian)
    const bodySize = (descriptorFrame[2] << 8) | descriptorFrame[3];
    assert.equal(bodySize, 53, 'body must be 53 bytes: cmd(1) + descriptor(52)');
  });

  // ── Extended addressing (Mega 2560 > 64KB) ─────────────────────────────

  test('loadAddress: sets bit 31 for word addresses > 0xFFFF', async () => {
    transport.setResponseGenerator((frame) => {
      const seq = v2RequestSeq(frame);
      const cmd = v2RequestCmd(frame);
      return buildV2OkResponse(seq, cmd);
    });

    await stk.loadAddress(0x10000); // 128KB in words = needs extended addressing

    const loadAddressFrame = transport.writtenBytes.find(
      (b) => b[0] === 0x1B && b[5] === 0x06
    );
    assert(loadAddressFrame, 'LOAD_ADDRESS must be sent');
    // Byte 6 (body[1]) should have bit 7 set (MSByte of 0x80010000)
    assert.equal(loadAddressFrame[6] & 0x80, 0x80, 'bit 31 (MSByte bit 7) must be set');
  });
});
