import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARDS,
  detectBoardBySignature,
  boardFromFqbn,
  ARDUINO_USB_VENDOR_IDS,
} from '../../src/boards/database.js';

describe('board database', () => {
  test('contains at least 10 board definitions', () => {
    assert(Object.keys(BOARDS).length >= 10);
  });

  test('all boards have required fields', () => {
    for (const [key, board] of Object.entries(BOARDS)) {
      assert(board.name, `${key}: missing name`);
      assert(board.baudRate > 0, `${key}: invalid baudRate`);
      assert(board.signature instanceof Uint8Array, `${key}: signature must be Uint8Array`);
      assert.equal(board.signature.length, 3, `${key}: signature must be 3 bytes`);
      assert(board.pageSize > 0, `${key}: invalid pageSize`);
      assert(board.timeout > 0, `${key}: invalid timeout`);
    }
  });

  test('detectBoardBySignature finds Arduino Uno', () => {
    const sig   = new Uint8Array([0x1e, 0x95, 0x0f]);
    const board = detectBoardBySignature(sig);
    assert(board !== null, 'should find a board for ATmega328P signature');
    assert(board!.signature.every((b, i) => b === sig[i]));
  });

  test('detectBoardBySignature returns null for unknown signature', () => {
    const unknown = new Uint8Array([0xde, 0xad, 0xbe]);
    const result  = detectBoardBySignature(unknown);
    assert.equal(result, null);
  });

  test('boardFromFqbn resolves known FQBNs', () => {
    const cases: [string, string][] = [
      ['arduino:avr:uno',  'Arduino Uno'],
      ['arduino:avr:nano', 'Arduino Nano'],
      ['arduino:avr:mega', 'Arduino Mega 2560'],
    ];
    for (const [fqbn, expectedName] of cases) {
      const board = boardFromFqbn(fqbn);
      assert(board !== null, `${fqbn} should resolve`);
      assert(board!.name.includes(expectedName.split(' ')[1]),
        `${fqbn} resolved to wrong board: ${board!.name}`);
    }
  });

  test('boardFromFqbn returns null for unknown FQBN', () => {
    assert.equal(boardFromFqbn('unknown:avr:xyz'), null);
  });

  test('ARDUINO_USB_VENDOR_IDS contains Arduino LLC vendor', () => {
    assert(ARDUINO_USB_VENDOR_IDS.includes(0x2341));
    assert(ARDUINO_USB_VENDOR_IDS.includes(0x1a86)); // CH340
  });

  test('Arduino Nano old vs new bootloader have different baud rates', () => {
    const newNano = BOARDS['arduino-nano'];
    const oldNano = BOARDS['arduino-nano-old'];
    assert(newNano.baudRate !== oldNano.baudRate,
      'old and new Nano bootloaders must differ in baud rate');
  });

  test('Leonardo has resetMethod=none', () => {
    const leo = BOARDS['arduino-leonardo'];
    assert.equal(leo.resetMethod, 'none',
      'Leonardo uses native USB CDC — no DTR reset');
  });

  test('Mega 2560 has larger pageSize than Uno', () => {
    assert(BOARDS['arduino-mega2560'].pageSize > BOARDS['arduino-uno'].pageSize);
  });
});
