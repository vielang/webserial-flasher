import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFrame, receiveFrame } from '../../src/protocol/stk500v2/frame.js';
import { MockTransport } from '../helpers/MockTransport.js';
import { STK500TimeoutError, STK500ProtocolError } from '../../src/core/errors.js';

const MSG_START = 0x1B;
const MSG_TOKEN = 0x0E;

// ── Helpers ───────────────────────────────────────────────────────────────

function xorAll(bytes: Uint8Array): number {
  let v = 0;
  for (const b of bytes) v ^= b;
  return v;
}

// ── encodeFrame ───────────────────────────────────────────────────────────

describe('stk500v2 encodeFrame', () => {
  test('produces correct frame structure', () => {
    const body  = [0x01]; // CMD_SIGN_ON
    const frame = encodeFrame(1, body);

    assert.equal(frame[0], MSG_START, 'MSG_START');
    assert.equal(frame[1], 1,         'sequence');
    assert.equal(frame[2], 0x00,      'sizeH = 0');
    assert.equal(frame[3], 0x01,      'sizeL = 1');
    assert.equal(frame[4], MSG_TOKEN,  'TOKEN');
    assert.equal(frame[5], 0x01,      'body[0]');
    // checksum at index 6 = XOR of bytes 0-5
    const expected_cs = frame[0] ^ frame[1] ^ frame[2] ^ frame[3] ^ frame[4] ^ frame[5];
    assert.equal(frame[6], expected_cs, 'checksum');
  });

  test('XOR checksum covers all bytes from MSG_START to last body byte', () => {
    const body  = [0x13, 0x00, 0x80, 0xC1, 0x06]; // arbitrary body
    const frame = encodeFrame(42, body);

    const headerAndBody = frame.subarray(0, frame.length - 1);
    const expectedChecksum = xorAll(headerAndBody);
    assert.equal(frame[frame.length - 1], expectedChecksum);
  });

  test('sequence number is masked to 8 bits', () => {
    const frame = encodeFrame(0x1FF, [0x01]);
    assert.equal(frame[1], 0xFF); // 0x1FF & 0xFF
  });

  test('handles multi-byte body', () => {
    const body  = [0x10, 200, 100, 25, 32, 0, 0x53, 3, 0xAC, 0x53, 0x00, 0x00];
    const frame = encodeFrame(5, body);
    assert.equal(frame.length, 6 + body.length);
    assert.equal(frame[2], 0);          // sizeH
    assert.equal(frame[3], body.length); // sizeL
    for (let i = 0; i < body.length; i++) {
      assert.equal(frame[5 + i], body[i], `body[${i}]`);
    }
  });

  test('handles Uint8Array body', () => {
    const body  = new Uint8Array([0x01, 0x02, 0x03]);
    const frame = encodeFrame(1, body);
    assert.equal(frame[3], 3);
    assert.equal(frame[5], 0x01);
    assert.equal(frame[6], 0x02);
    assert.equal(frame[7], 0x03);
  });
});

// ── receiveFrame ──────────────────────────────────────────────────────────

describe('stk500v2 receiveFrame', () => {
  test('resolves with body on valid frame', async () => {
    const transport = new MockTransport();
    const body      = [0x01, 0x00, 0x0A, 0x41, 0x56, 0x52, 0x49, 0x53, 0x50, 0x5F, 0x4D, 0x4B, 0x32];
    const frame     = encodeFrame(1, body);

    const promise = receiveFrame(transport, 500);
    transport.push(frame);

    const result = await promise;
    assert.deepEqual(result, new Uint8Array(body));
  });

  test('handles data arriving in multiple chunks', async () => {
    const transport = new MockTransport();
    const body      = [0x13, 0x00, 0x80];
    const frame     = encodeFrame(3, body);

    const promise = receiveFrame(transport, 500);
    // Push frame in three separate chunks
    transport.push(frame.subarray(0, 3));
    transport.push(frame.subarray(3, 6));
    transport.push(frame.subarray(6));

    const result = await promise;
    assert.deepEqual(result, new Uint8Array(body));
  });

  test('rejects with STK500TimeoutError when no frame arrives', async () => {
    const transport = new MockTransport();
    await assert.rejects(
      receiveFrame(transport, 30),
      (err: unknown) => {
        assert(err instanceof STK500TimeoutError);
        assert.equal(err.timeoutMs, 30);
        return true;
      }
    );
  });

  test('rejects with STK500ProtocolError on bad checksum', async () => {
    const transport = new MockTransport();
    const frame     = encodeFrame(1, [0x01]);
    frame[frame.length - 1] ^= 0xFF; // corrupt checksum

    const promise = receiveFrame(transport, 500);
    transport.push(frame);

    await assert.rejects(
      promise,
      (err: unknown) => {
        assert(err instanceof STK500ProtocolError);
        assert(err.message.includes('checksum'));
        return true;
      }
    );
  });

  test('rejects with STK500ProtocolError on wrong token byte', async () => {
    const transport = new MockTransport();
    const frame     = encodeFrame(1, [0x01]);
    frame[4] = 0xFF; // corrupt TOKEN — must recalculate checksum
    let cs = 0;
    for (let i = 0; i < frame.length - 1; i++) cs ^= frame[i];
    frame[frame.length - 1] = cs;

    const promise = receiveFrame(transport, 500);
    transport.push(frame);

    await assert.rejects(
      promise,
      (err: unknown) => {
        assert(err instanceof STK500ProtocolError);
        assert(err.message.includes('token'));
        return true;
      }
    );
  });

  test('discards garbage bytes before MSG_START', async () => {
    const transport = new MockTransport();
    const body      = [0x01, 0x00];
    const frame     = encodeFrame(2, body);
    const garbage   = new Uint8Array([0xAA, 0xBB, 0xCC]);

    const combined = new Uint8Array([...garbage, ...frame]);
    const promise = receiveFrame(transport, 500);
    transport.push(combined);

    const result = await promise;
    assert.deepEqual(result, new Uint8Array(body));
  });

  test('encodeFrame → receiveFrame round-trip preserves body', async () => {
    const transport = new MockTransport();
    const body      = [0x14, 0x00, 0xAA, 0xBB, 0xCC, 0xDD, 0x00]; // READ_FLASH response
    const frame     = encodeFrame(7, body);

    const promise = receiveFrame(transport, 500);
    transport.push(frame);

    const result = await promise;
    assert.deepEqual(result, new Uint8Array(body));
  });
});
