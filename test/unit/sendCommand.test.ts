import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sendCommand from '../../src/protocol/sendCommand.js';
import { MockTransport, OK } from '../helpers/MockTransport.js';
import { STK500ProtocolError, STK500TimeoutError } from '../../src/core/errors.js';
import Constants from '../../src/core/constants.js';

describe('sendCommand', () => {
  let transport: MockTransport;

  beforeEach(() => {
    transport = new MockTransport();
    transport.setResponseGenerator(() => OK);
  });

  test('appends Sync_CRC_EOP when cmd is an array', async () => {
    await sendCommand(transport, {
      cmd:          [Constants.Cmnd_STK_GET_SYNC],
      responseData: OK,
      timeout:      100,
    });
    const sent = transport.writtenBytes[0];
    assert.equal(sent[sent.length - 1], Constants.Sync_CRC_EOP);
    assert.equal(sent[0], Constants.Cmnd_STK_GET_SYNC);
  });

  test('sends Uint8Array as-is (no CRC_EOP appended)', async () => {
    const raw = new Uint8Array([Constants.Cmnd_STK_GET_SYNC, Constants.Sync_CRC_EOP]);
    await sendCommand(transport, {
      cmd:            raw,
      responseLength: 2,
      timeout:        100,
    });
    assert.deepEqual(transport.writtenBytes[0], raw);
  });

  test('resolves with response bytes on success', async () => {
    const result = await sendCommand(transport, {
      cmd:          [Constants.Cmnd_STK_GET_SYNC],
      responseData: OK,
      timeout:      100,
    });
    assert.deepEqual(result, OK);
  });

  test('throws STK500TimeoutError on timeout', async () => {
    transport.setResponseGenerator(() => null); // no response
    await assert.rejects(
      sendCommand(transport, {
        cmd:          [Constants.Cmnd_STK_GET_SYNC],
        responseData: OK,
        timeout:      20,
      }),
      (err: unknown) => {
        assert(err instanceof STK500TimeoutError);
        return true;
      }
    );
  });

  test('throws STK500ProtocolError when responseLength overrides responseData length', async () => {
    // responseLength=4 collects 4 bytes, but responseData=OK has 2 bytes
    // → collected data.length(4) !== expected.length(2) → throws ProtocolError
    transport.setResponseGenerator(() => new Uint8Array([0x14, 0x10, 0x1e, 0x95]));
    await assert.rejects(
      sendCommand(transport, {
        cmd:            [Constants.Cmnd_STK_GET_SYNC],
        responseData:   OK,   // 2-byte expectation
        responseLength: 4,    // collect 4 — mismatch on validation
        timeout:        100,
      }),
      (err: unknown) => {
        assert(err instanceof STK500ProtocolError);
        assert((err as STK500ProtocolError).message.includes('length mismatch'));
        return true;
      }
    );
  });

  test('throws STK500ProtocolError on content mismatch', async () => {
    transport.setResponseGenerator(() => new Uint8Array([0x14, 0x11])); // 0x11 = FAILED
    await assert.rejects(
      sendCommand(transport, {
        cmd:          [Constants.Cmnd_STK_GET_SYNC],
        responseData: OK,
        timeout:      100,
      }),
      STK500ProtocolError
    );
  });

  test('accepts correct responseLength without responseData', async () => {
    const result = await sendCommand(transport, {
      cmd:            [Constants.Cmnd_STK_GET_SYNC],
      responseLength: 2,
      timeout:        100,
    });
    assert.equal(result.length, 2);
  });
});
