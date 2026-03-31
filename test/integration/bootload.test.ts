import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { STK500 } from '../../src/stk500.js';
import {
  STK500SyncError,
  STK500SignatureMismatchError,
  STK500VerifyError,
} from '../../src/core/errors.js';
import {
  MockTransport,
  OK,
  ATMEGA328P_SIG_RESPONSE,
  buildPageResponse,
} from '../helpers/MockTransport.js';
import { BOARDS } from '../../src/boards/database.js';
import Constants from '../../src/core/constants.js';

// Minimal valid HEX: 4 bytes of data (fits in one page) + EOF
// Checksum: (4+0+0+0+1+2+3+4)=0x0E → 0x100-0x0E = 0xF2
const MINI_HEX = [
  ':0400000001020304F2',
  ':00000001FF',
].join('\n');

// The 4 data bytes after parsing: [0x01, 0x02, 0x03, 0x04]
const MINI_DATA = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

const UNO = BOARDS['arduino-uno'];

// ── Helpers ─────────��──────────────────────────────────────────────────────

/**
 * Build a response generator that handles the full bootload sequence
 * for a successful flash of MINI_HEX.
 */
function makeSuccessfulGenerator(
  verifyData: Uint8Array = MINI_DATA
): (cmd: Uint8Array) => Uint8Array | null {
  return (cmd: Uint8Array): Uint8Array | null => {
    const opcode = cmd[0];
    switch (opcode) {
      case Constants.Cmnd_STK_GET_SYNC:      return OK;
      case Constants.Cmnd_STK_READ_SIGN:     return ATMEGA328P_SIG_RESPONSE;
      case Constants.Cmnd_STK_SET_DEVICE:    return OK;
      case Constants.Cmnd_STK_ENTER_PROGMODE: return OK;
      case Constants.Cmnd_STK_CHIP_ERASE:    return OK;
      case Constants.Cmnd_STK_LOAD_ADDRESS:  return OK;
      case Constants.Cmnd_STK_PROG_PAGE:     return OK;
      case Constants.Cmnd_STK_READ_PAGE:     return buildPageResponse(verifyData);
      case Constants.Cmnd_STK_LEAVE_PROGMODE: return OK;
      default: return null;
    }
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('STK500 integration', () => {
  let transport: MockTransport;
  let stk: STK500;

  beforeEach(() => {
    transport = new MockTransport();
    stk = new STK500(transport, UNO, {
      quiet: true,
      retry: { syncAttempts: 3, retryDelayMs: 0 },
    });
  });

  // ── DTR reset ─────────────────────────────────────────────────────────

  test('bootload: toggles DTR before sync', async () => {
    transport.setResponseGenerator(makeSuccessfulGenerator());
    await stk.bootload(MINI_HEX);

    // Expect at least one DTR=false followed by DTR=true
    const dtrs = transport.signalHistory.filter((s) => 'dtr' in s);
    assert(dtrs.length >= 2, 'should toggle DTR at least once');
    assert.equal(dtrs[0].dtr, false);
    assert.equal(dtrs[1].dtr, true);
  });

  test('resetDevice: no setSignals called when resetMethod=none', async () => {
    const leo = BOARDS['arduino-leonardo'];
    const leoStk = new STK500(transport, leo, {
      quiet: true,
      retry: { syncAttempts: 3, retryDelayMs: 0 },
    });
    // Use Leonardo signature [0x1e, 0x95, 0x87]
    const leoSigResponse = new Uint8Array([0x14, 0x1e, 0x95, 0x87, 0x10]);
    transport.setResponseGenerator((cmd) => {
      const op = cmd[0];
      if (op === Constants.Cmnd_STK_READ_SIGN)     return leoSigResponse;
      if (op === Constants.Cmnd_STK_GET_SYNC)      return OK;
      if (op === Constants.Cmnd_STK_SET_DEVICE)    return OK;
      if (op === Constants.Cmnd_STK_ENTER_PROGMODE) return OK;
      if (op === Constants.Cmnd_STK_CHIP_ERASE)    return OK;
      if (op === Constants.Cmnd_STK_LOAD_ADDRESS)  return OK;
      if (op === Constants.Cmnd_STK_PROG_PAGE)     return OK;
      if (op === Constants.Cmnd_STK_READ_PAGE)     return buildPageResponse(MINI_DATA);
      if (op === Constants.Cmnd_STK_LEAVE_PROGMODE) return OK;
      return null;
    });
    await leoStk.bootload(MINI_HEX);
    assert.equal(transport.signalHistory.length, 0, 'Leonardo should not toggle DTR');
  });

  // ── Sync errors ────────────────────────────���──────────────────────────

  test('sync: throws STK500SyncError after all attempts fail', async () => {
    transport.setResponseGenerator(() => null); // no response ever
    await assert.rejects(
      stk.bootload(MINI_HEX),
      (err: unknown) => {
        assert(err instanceof STK500SyncError);
        assert(err.attempts === 3); // matches retry.syncAttempts
        return true;
      }
    );
  });

  // ── Signature mismatch ────��───────────────────────────────────────────

  test('verifySignature: throws STK500SignatureMismatchError for wrong board', async () => {
    // ATmega2560 signature — wrong for arduino-uno board config
    const wrongSig = new Uint8Array([0x14, 0x1e, 0x98, 0x01, 0x10]);
    transport.setResponseGenerator((cmd) => {
      if (cmd[0] === Constants.Cmnd_STK_GET_SYNC) return OK;
      if (cmd[0] === Constants.Cmnd_STK_READ_SIGN) return wrongSig;
      return OK;
    });

    await assert.rejects(
      stk.bootload(MINI_HEX),
      (err: unknown) => {
        assert(err instanceof STK500SignatureMismatchError);
        assert.deepEqual(err.expected, UNO.signature);
        assert.deepEqual(err.actual, new Uint8Array([0x1e, 0x98, 0x01]));
        return true;
      }
    );
  });

  // ── Verify ─────────��──────────────────────────────────────────────────

  test('verify: succeeds when readback matches hex data', async () => {
    transport.setResponseGenerator(makeSuccessfulGenerator(MINI_DATA));
    // Should not throw
    await stk.bootload(MINI_HEX);
  });

  test('verify: throws STK500VerifyError on byte mismatch', async () => {
    const corrupted = new Uint8Array([0x01, 0x02, 0xff, 0x04]); // byte 2 wrong
    transport.setResponseGenerator(makeSuccessfulGenerator(corrupted));

    await assert.rejects(
      stk.bootload(MINI_HEX),
      (err: unknown) => {
        assert(err instanceof STK500VerifyError);
        assert.equal(err.address, 2);
        assert.equal(err.expected, 0x03);
        assert.equal(err.actual,   0xff);
        return true;
      }
    );
  });

  // ── Full happy path ───────────────────────────────────────────────────

  test('bootload: full sequence completes successfully', async () => {
    const progressEvents: Array<{ status: string; pct: number }> = [];
    transport.setResponseGenerator(makeSuccessfulGenerator());

    await stk.bootload(MINI_HEX, (status, pct) => {
      progressEvents.push({ status, pct });
    });

    // Verify key milestones
    const statuses = progressEvents.map((e) => e.status);
    assert(statuses.includes('Resetting device'),      'should report reset');
    assert(statuses.includes('Syncing'),                'should report sync');
    assert(statuses.includes('Verifying signature'),    'should report sig check');
    assert(statuses.includes('Uploading'),              'should report upload');
    assert(statuses.includes('Verifying'),              'should report verify');
    assert(statuses.includes('Complete'),               'should report completion');

    // Progress should start at 0 and end at 100
    const first = progressEvents[0].pct;
    const last  = progressEvents[progressEvents.length - 1].pct;
    assert.equal(first, 0);
    assert.equal(last,  100);
  });

  // ── setOptions completeness ────��──────────────────────────────────────

  test('setOptions: sends exactly 21 bytes (command + 20 parameters)', async () => {
    transport.setResponseGenerator(makeSuccessfulGenerator());
    await stk.bootload(MINI_HEX);

    // Find the SET_DEVICE command in writtenBytes
    const setDeviceCmd = transport.writtenBytes.find(
      (b) => b[0] === Constants.Cmnd_STK_SET_DEVICE
    );
    assert(setDeviceCmd, 'SET_DEVICE must be sent');
    // CMD (1) + 20 params + CRC_EOP (1) = 22 bytes total
    assert.equal(setDeviceCmd.length, 22, 'SET_DEVICE must carry 20 device parameters');
  });
});
