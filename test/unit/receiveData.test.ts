import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import receiveData from '../../src/protocol/receiveData.js';
import { MockTransport, OK } from '../helpers/MockTransport.js';
import { STK500TimeoutError } from '../../src/core/errors.js';

describe('receiveData', () => {
  let transport: MockTransport;

  beforeEach(() => {
    transport = new MockTransport();
  });

  test('receives exact response length', async () => {
    setTimeout(() => transport.push(OK), 0);
    const data = await receiveData(transport, 100, OK.length);
    assert.deepEqual(data, OK);
  });

  test('accumulates chunked response', async () => {
    setTimeout(() => transport.push(OK.subarray(0, 1)), 0);
    setTimeout(() => transport.push(OK.subarray(1, 2)), 10);
    const data = await receiveData(transport, 100, OK.length);
    assert.deepEqual(data, OK);
  });

  test('fires timeout even when INSYNC byte never arrives', async () => {
    // Push garbage that does NOT contain INSYNC (0x14)
    setTimeout(() => transport.push(new Uint8Array([0x00, 0x01, 0x02])), 0);
    await assert.rejects(
      receiveData(transport, 50, 2),
      (err: unknown) => {
        assert(err instanceof STK500TimeoutError, 'should be STK500TimeoutError');
        assert(err.timeoutMs === 50);
        return true;
      }
    );
  });

  test('fires timeout when no data arrives at all', async () => {
    await assert.rejects(
      receiveData(transport, 20, 2),
      (err: unknown) => {
        assert(err instanceof STK500TimeoutError);
        return true;
      }
    );
  });

  test('does not double-resolve after timeout fires', async () => {
    let settleCount = 0;

    // Wrap with a counting promise
    const promise = receiveData(transport, 30, 2).then(
      () => { settleCount++; },
      () => { settleCount++; }
    );

    // Push INSYNC after the timeout has fired
    setTimeout(() => transport.push(OK), 60);

    await promise;
    // Wait a bit more to see if a second settle happens
    await new Promise((r) => setTimeout(r, 80));

    assert.equal(settleCount, 1, 'promise must settle exactly once');
  });

  test('skips noise bytes before INSYNC', async () => {
    // 3 garbage bytes followed by correct response
    const noise    = new Uint8Array([0x00, 0xff, 0x30]);
    const response = new Uint8Array([0x14, 0x10]); // INSYNC + OK
    setTimeout(() => {
      transport.push(noise);
      transport.push(response);
    }, 0);
    const data = await receiveData(transport, 100, 2);
    assert.deepEqual(data, response);
  });

  test('handles response spanning multiple push calls', async () => {
    const full = new Uint8Array([0x14, 0x10, 0x1e, 0x95, 0x0f, 0x10]);
    for (let i = 0; i < full.length; i++) {
      const byte = full.subarray(i, i + 1);
      setTimeout(() => transport.push(byte), i * 2);
    }
    const data = await receiveData(transport, 200, full.length);
    assert.deepEqual(data, full);
  });
});
