import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { UPDILink } from '../../src/protocol/updi/link.js';
import {
  UPDI_CS_STATUSA, UPDI_CS_CTRLA,
  NVM_STATUS, NVM_CTRLA,
  UPDI_CTRLA_GT_2,
} from '../../src/protocol/updi/constants.js';
import { MockTransport, UPDI_ACK_BYTE } from '../helpers/MockTransport.js';
import { BOARDS } from '../../src/boards/database.js';

const BOARD = BOARDS['attiny416']!;
const QUIET_LOGGER = () => {};

// ── Helpers ───────────────────────────────────────────────────────────────��───

function makeLink(transport: MockTransport): UPDILink {
  return new UPDILink(transport, BOARD, QUIET_LOGGER);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UPDILink — LDCS', () => {
  let transport: MockTransport;
  let link: UPDILink;

  beforeEach(() => {
    transport = new MockTransport();
    transport.echoEnabled = true;
    link = makeLink(transport);
  });

  test('ldcs: sends correct 2-byte instruction', async () => {
    transport.setResponseGenerator(() => new Uint8Array([0x82]));
    await link.ldcs(UPDI_CS_STATUSA); // addr = 0x00
    const sent = transport.writtenBytes[0]!;
    assert.equal(sent[0], 0x55, 'SYNC');
    assert.equal(sent[1], 0x80, 'LDCS | STATUSA (0x80 | 0x00)');
    assert.equal(sent.length, 2);
  });

  test('ldcs: returns the device response byte', async () => {
    transport.setResponseGenerator(() => new Uint8Array([0x82]));
    const val = await link.ldcs(UPDI_CS_STATUSA);
    assert.equal(val, 0x82);
  });

  test('ldcs: correctly encodes register address in lower 4 bits', async () => {
    transport.setResponseGenerator(() => new Uint8Array([0x10]));
    await link.ldcs(0x07); // ASI_KEY_STATUS
    assert.equal(transport.writtenBytes[0]![1], 0x87, 'LDCS | 0x07');
  });
});

describe('UPDILink — STCS', () => {
  let transport: MockTransport;
  let link: UPDILink;

  beforeEach(() => {
    transport = new MockTransport();
    transport.echoEnabled = true;
    link = makeLink(transport);
  });

  test('stcs: sends SYNC + opcode + value', async () => {
    transport.setResponseGenerator(() => UPDI_ACK_BYTE.slice());
    await link.stcs(UPDI_CS_CTRLA, UPDI_CTRLA_GT_2);
    const sent = transport.writtenBytes[0]!;
    assert.equal(sent[0], 0x55,            'SYNC');
    assert.equal(sent[1], 0xC2,            'STCS | CTRLA (0xC0 | 0x02)');
    assert.equal(sent[2], UPDI_CTRLA_GT_2, 'value');
    assert.equal(sent.length, 3);
  });

  test('stcs: throws on non-ACK response', async () => {
    transport.setResponseGenerator(() => new Uint8Array([0xFF]));
    await assert.rejects(
      link.stcs(UPDI_CS_CTRLA, 0x06),
      /ACK/
    );
  });
});

describe('UPDILink — LDS', () => {
  let transport: MockTransport;
  let link: UPDILink;

  beforeEach(() => {
    transport = new MockTransport();
    transport.echoEnabled = true;
    link = makeLink(transport);
  });

  test('lds: sends SYNC + 0x04 + addrL + addrH', async () => {
    transport.setResponseGenerator((data) => {
      // For address phase: return data
      if (data[0] === 0x55 && data[1] === 0x04) return new Uint8Array([0x00]);
      return null;
    });
    await link.lds(NVM_STATUS); // 0x1002
    const sent = transport.writtenBytes[0]!;
    assert.equal(sent[0], 0x55, 'SYNC');
    assert.equal(sent[1], 0x04, 'LDS 16-bit addr, 1-byte data');
    assert.equal(sent[2], 0x02, 'addrL (0x1002 & 0xFF)');
    assert.equal(sent[3], 0x10, 'addrH (0x1002 >> 8)');
  });

  test('lds: returns the response byte', async () => {
    transport.setResponseGenerator(() => new Uint8Array([0xAB]));
    const val = await link.lds(0x1234);
    assert.equal(val, 0xAB);
  });
});

describe('UPDILink — STS', () => {
  let transport: MockTransport;
  let link: UPDILink;

  beforeEach(() => {
    transport = new MockTransport();
    transport.echoEnabled = true;
    link = makeLink(transport);
  });

  test('sts: sends address phase then data phase', async () => {
    let callCount = 0;
    transport.setResponseGenerator((data) => {
      callCount++;
      if (data[0] === 0x55) return UPDI_ACK_BYTE.slice(); // addr phase ACK
      return UPDI_ACK_BYTE.slice(); // data phase ACK
    });

    await link.sts(NVM_CTRLA, 0x03); // write ERWP to NVM_CTRLA

    // First write: SYNC + 0x44 + addrL + addrH
    const write1 = transport.writtenBytes[0]!;
    assert.equal(write1[0], 0x55, 'SYNC');
    assert.equal(write1[1], 0x44, 'STS 16-bit addr, 1-byte data');
    assert.equal(write1[2], 0x00, 'addrL (0x1000 & 0xFF)');
    assert.equal(write1[3], 0x10, 'addrH');

    // Second write: the data byte
    const write2 = transport.writtenBytes[1]!;
    assert.equal(write2[0], 0x03, 'data byte = ERWP (0x03)');
    assert.equal(write2.length, 1, 'only 1 byte in data phase');
  });

  test('sts: throws if address phase ACK missing', async () => {
    transport.setResponseGenerator(() => new Uint8Array([0xFF]));
    await assert.rejects(link.sts(0x1000, 0x05), /ACK/);
  });
});

describe('UPDILink — setPtr', () => {
  let transport: MockTransport;
  let link: UPDILink;

  beforeEach(() => {
    transport = new MockTransport();
    transport.echoEnabled = true;
    link = makeLink(transport);
  });

  test('setPtr: sends SYNC + 0x61 + addrL + addrH', async () => {
    transport.setResponseGenerator(() => UPDI_ACK_BYTE.slice());
    await link.setPtr(0x8000);
    const sent = transport.writtenBytes[0]!;
    assert.equal(sent[0], 0x55, 'SYNC');
    assert.equal(sent[1], 0x61, 'ST ptr 16-bit (0x60 | 0x00 | 0x01)');
    assert.equal(sent[2], 0x00, 'addrL (0x8000 & 0xFF)');
    assert.equal(sent[3], 0x80, 'addrH (0x8000 >> 8)');
  });

  test('setPtr: throws on non-ACK response', async () => {
    transport.setResponseGenerator(() => new Uint8Array([0x00]));
    await assert.rejects(link.setPtr(0x8000), /ACK/);
  });
});

describe('UPDILink — stPtrInc (block write)', () => {
  let transport: MockTransport;
  let link: UPDILink;

  beforeEach(() => {
    transport = new MockTransport();
    transport.echoEnabled = true;
    link = makeLink(transport);
  });

  test('stPtrInc with 1 byte: sends only ST_PTR_INC instruction + byte', async () => {
    transport.setResponseGenerator((data) => {
      if (data[0] === 0x55 && data[1] === 0x64) return null; // no immediate ACK for instruction
      return UPDI_ACK_BYTE.slice(); // ACK for each data byte
    });

    await link.stPtrInc(new Uint8Array([0xAA]));

    // No REPEAT instruction for single byte
    // Write 0: SYNC + ST_PTR_INC instruction (0x64)
    const instr = transport.writtenBytes[0]!;
    assert.equal(instr[0], 0x55, 'SYNC');
    assert.equal(instr[1], 0x64, 'ST_PTR_INC (0x60 | 0x04)');
    // Write 1: data byte
    assert.equal(transport.writtenBytes[1]![0], 0xAA, 'data byte');
  });

  test('stPtrInc with 3 bytes: sends REPEAT(2) first', async () => {
    transport.setResponseGenerator((data) => {
      if (data[0] === 0x55) return null; // REPEAT or instruction — no ACK
      return UPDI_ACK_BYTE.slice(); // ACK per data byte
    });

    await link.stPtrInc(new Uint8Array([0x01, 0x02, 0x03]));

    // First write should be REPEAT
    const repeat = transport.writtenBytes[0]!;
    assert.equal(repeat[0], 0x55, 'SYNC');
    assert.equal(repeat[1], 0xA0, 'REPEAT instruction');
    assert.equal(repeat[2], 2,    'repeat count = length-1 = 2');
  });
});

describe('UPDILink — ldPtrInc (block read)', () => {
  let transport: MockTransport;
  let link: UPDILink;

  beforeEach(() => {
    transport = new MockTransport();
    transport.echoEnabled = true;
    link = makeLink(transport);
  });

  test('ldPtrInc: returns N device bytes after instruction', async () => {
    transport.setResponseGenerator((data) => {
      if (data[0] === 0x55 && data[1] === 0x24) {
        return new Uint8Array([0xDE, 0xAD, 0xBE]); // 3 device bytes
      }
      return null; // REPEAT gets no response
    });

    const result = await link.ldPtrInc(3);
    assert.deepEqual(result, new Uint8Array([0xDE, 0xAD, 0xBE]));
  });

  test('ldPtrInc: sends REPEAT before instruction for count > 1', async () => {
    transport.setResponseGenerator((data) => {
      if (data[0] === 0x55 && data[1] === 0x24) return new Uint8Array([0xFF, 0xFF]);
      return null;
    });

    await link.ldPtrInc(2);
    const first = transport.writtenBytes[0]!;
    assert.equal(first[1], 0xA0, 'first write should be REPEAT');
    assert.equal(first[2], 1,    'repeat count = 2-1 = 1');
  });

  test('ldPtrInc(0) returns empty array without writing anything', async () => {
    const result = await link.ldPtrInc(0);
    assert.equal(result.length, 0);
    assert.equal(transport.writtenBytes.length, 0);
  });
});
